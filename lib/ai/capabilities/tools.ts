import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { assertFetchableUrl, readCapped } from "../web-tools";
import { buildRequest, describeRequest } from "./request";
import { describeMatches, isApproved, searchCapabilities, type AddedCapability } from "./search";

/**
 * Two tools, however many APIs have been added.
 *
 * This is the surface the whole capability engine narrows to, and the count is
 * the point. A tool per added API would spend prompt budget on schema for APIs
 * this turn will not touch; a tool per *operation* would break the prompt
 * outright somewhere around the fortieth capability. So the manifests are an
 * index (`search.ts`), and these two tools are how the model reaches it: one to
 * find the operation, one to call it.
 *
 * It is the same shape `connector-tools.ts` already uses for the connectors a
 * person types in, and the same shape my own harness uses to hold hundreds of
 * tools without carrying them all — find first, then call what was found.
 */

/** A response bigger than this crowds out the conversation that asked for it. */
const MAX_RESPONSE_BYTES = 120_000;
const MAX_RESPONSE_CHARS = 12_000;
const REQUEST_TIMEOUT_MS = 20_000;

function clip(text: string): string {
  return text.length > MAX_RESPONSE_CHARS
    ? `${text.slice(0, MAX_RESPONSE_CHARS)}\n\n[Truncated — the API returned more than ${MAX_RESPONSE_CHARS} characters.]`
    : text;
}

export function buildCapabilityTools({
  capabilities,
  signal,
  onActivity = () => {}
}: {
  capabilities: AddedCapability[];
  signal?: AbortSignal;
  onActivity?: (label: string) => void;
}): ToolSet {
  if (!capabilities.length) return {};

  const byId = new Map(capabilities.map((capability) => [capability.manifest.id, capability]));
  /* Named in the descriptions so the model knows what is behind the search
     without spending a schema on each one. Bounded, because a deployment with
     three hundred APIs must not put three hundred names in every prompt. */
  const roster = capabilities.slice(0, 30).map((capability) => capability.manifest.name).join(", ");

  return {
    find_capability: tool({
      description: [
        `Search every API connected to this deployment for an operation that answers something, and get back exactly how to call it — the capability id, the operation id, the arguments it takes, and whether it changes anything.`,
        `Currently connected: ${roster}${capabilities.length > 30 ? `, and ${capabilities.length - 30} more` : ""}.`,
        "Call this before answering anything these APIs might cover, and before saying you cannot do something — the operation may exist under wording you did not expect.",
        "Search the words describing what you want done, not an endpoint name you are guessing at."
      ].join(" "),
      inputSchema: z.object({
        query: z.string().min(2).max(200).describe("What you want done, in the words that describe it. Not a guessed endpoint name.")
      }),
      execute: async ({ query }) => {
        onActivity(`Looking through connected APIs for ${query}`);
        return describeMatches(query, searchCapabilities(query, capabilities), capabilities);
      }
    }),

    call_capability: tool({
      description: [
        "Call one operation on a connected API, using the capability id and operation id that `find_capability` returned.",
        "Only ever call an operation that search actually returned. Guessing an operation id or an argument name reaches somebody else's server with a request built on a guess.",
        "Operations that change something ask the owner once before the first call; everything after that is silent."
      ].join(" "),
      inputSchema: z.object({
        capability: z.string().describe("The capability id from `find_capability`, e.g. `imagery`."),
        operation: z.string().describe("The operation id from `find_capability`, e.g. `listImages`."),
        args: z.record(z.string(), z.unknown()).optional()
          .describe("Arguments by the exact names search listed. A request body goes under the key `body`.")
      }),
      execute: async ({ capability: capabilityId, operation: operationId, args }) => {
        const capability = byId.get(capabilityId);
        /* Named rather than generic: "unknown capability" sends someone looking
           at the API, and "you have these" is answerable on the spot. */
        if (!capability) {
          return `There is no connected API with the id "${capabilityId}". Connected: ${capabilities.map((entry) => entry.manifest.id).join(", ")}. Run find_capability rather than guessing.`;
        }

        const operation = capability.manifest.operations.find((entry) => entry.id === operationId);
        if (!operation) {
          return `${capability.manifest.name} has no operation "${operationId}". Run find_capability to see what it does have; do not guess an endpoint.`;
        }

        /* The gate. Reads go straight through; a write that has not been
           approved stops here rather than at the other end, because the other
           end is where it would already have happened. */
        if (!isApproved(capability, operation)) {
          return [
            `\`${operationId}\` on ${capability.manifest.name} changes something (${operation.method} ${operation.path}) and the owner has not approved it yet.`,
            "It has not been called. Tell them plainly what it would do and what it would be called with, and ask whether to approve it — approval is remembered, so this is asked once per operation and never again.",
            "Do not look for another way around this."
          ].join("\n");
        }

        const built = buildRequest({ manifest: capability.manifest, operation, args: args ?? {}, apiKey: capability.apiKey });
        if (!built.ok) return `That call could not be built: ${built.reason}`;

        onActivity(`Calling ${capability.manifest.name}`);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const forward = () => controller.abort();
        signal?.addEventListener("abort", forward);

        try {
          /* Re-validated here even though the base URL was checked when the API
             was added, because a manifest is stored and a stored value is one
             an edit could have changed. Redirects are refused outright: no API
             operation needs one, and a public host answering 302 toward an
             internal address is the way past a hostname guard. */
          const target = assertFetchableUrl(built.request.url);
          const response = await fetch(target, {
            method: built.request.method,
            headers: built.request.headers,
            ...(built.request.body ? { body: built.request.body } : {}),
            redirect: "error",
            signal: controller.signal
          });

          const { bytes, truncated } = await readCapped(response, MAX_RESPONSE_BYTES);
          const text = new TextDecoder().decode(bytes);
          const shown = describeRequest(built.request, capability.manifest.auth);

          /* A failure is reported as a failure, with the status and the body.
             An API that answers 401 because a key expired looks identical to
             one that answers 401 because the key is wrong, and neither looks
             like anything at all if the result is swallowed — which is how a
             dead credential becomes an assistant that quietly stops using an
             API and never says why. */
          if (!response.ok) {
            return [
              `${shown} returned ${response.status} ${response.statusText}.`,
              text ? clip(text) : "It sent no body.",
              response.status === 401 || response.status === 403
                ? "That is an authentication failure: the key for this API is missing, wrong, expired, or lacks permission for this operation. Say so and name the API rather than retrying."
                : response.status === 429
                  ? "That is a rate limit. Do not retry it in this turn."
                  : ""
            ].filter(Boolean).join("\n");
          }

          return [
            `${shown} succeeded.`,
            clip(text || "It returned an empty body."),
            truncated ? "[The response was larger than the byte ceiling and was cut short.]" : ""
          ].filter(Boolean).join("\n");
        } catch (error) {
          const message = error instanceof Error ? error.message : "The request failed.";
          return `${describeRequest(built.request, capability.manifest.auth)} failed: ${message}`;
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener("abort", forward);
        }
      }
    }),

    /**
     * Approving a write, once.
     *
     * No `execute`, so it runs on the device — the same path `run_javascript`
     * and `search_history` take. That is not an implementation detail: a grant
     * has to be given by the person, and the server cannot ask them anything
     * mid-generation. The client shows the request, records the answer in the
     * owner's own preferences, and the next call finds it already approved.
     */
    approve_capability_write: tool({
      description: [
        "Ask the owner to approve one write operation, after they have said they want it.",
        "This opens a confirmation on their device; it does not call the API. Once approved, that operation never asks again — so ask for the one operation you need rather than several at once.",
        "Only call this when the owner has already been told what the operation does and has agreed to it."
      ].join(" "),
      inputSchema: z.object({
        capability: z.string().describe("The capability id."),
        operation: z.string().describe("The operation id to approve."),
        reason: z.string().max(200).describe("What it will be used for, in one line, shown to the owner.")
      })
    })
  };
}
