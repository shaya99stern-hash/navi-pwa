import { buildCapabilityTools } from "@/lib/ai/capabilities/tools";
import type { AddedCapability } from "@/lib/ai/capabilities/search";
import type { CapabilityOperation } from "@/lib/ai/capabilities/manifest";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── Two tools, however many APIs are added ──────────────────────────────────
   A tool per API spends prompt budget on schema for APIs this turn will not
   touch. A tool per operation breaks the prompt outright somewhere around the
   fortieth capability. So the manifests are an index and this is the whole
   surface over it: find the operation, then call the one that was found. */

const op = (over: Partial<CapabilityOperation> = {}): CapabilityOperation => ({
  id: "listImages", method: "GET", path: "/images", summary: "List images.", writes: false, parameters: [], ...over
});

const capability = (approvedWrites: string[] = []): AddedCapability => ({
  manifest: {
    id: "imagery", name: "Imagery", purpose: "Satellite imagery.",
    baseUrl: "https://api.example.com/v1", auth: { kind: "bearer" },
    operations: [
      op({ id: "listImages", summary: "List available satellite images." }),
      op({ id: "deleteImage", method: "DELETE", path: "/images/{id}", summary: "Delete an image.", writes: true,
           parameters: [{ name: "id", in: "path", required: true, description: "", schema: { type: "string" } }] })
    ],
    source: "openapi", discoveredAt: 0
  },
  apiKey: "secret-key",
  approvedWrites
});

const toolsFor = (capabilities: AddedCapability[]) => buildCapabilityTools({ capabilities });

/* ── The surface stays two wide, plus the one that asks ───────────────────── */

const tools = toolsFor([capability()]);
check("three tools, and no more", Object.keys(tools).sort(), ["approve_capability_write", "call_capability", "find_capability"]);
/* Ten APIs must not become ten tools. That is the property the whole index
   exists to hold. */
check("ten APIs are still the same three tools",
  Object.keys(toolsFor(Array.from({ length: 10 }, () => capability()))).length, 3);
/* Nothing added means nothing offered, rather than three tools that can only
   report their own emptiness. */
check("no APIs means no tools at all", Object.keys(toolsFor([])).length, 0);

/* The roster is in the description so the model knows what is behind the
   search without a schema per API — but it is bounded, or three hundred APIs
   put three hundred names in every prompt. */
const many = toolsFor(Array.from({ length: 40 }, () => capability()));
const description = String((many.find_capability as { description?: string }).description ?? "");
check("the connected APIs are named in the description", description.includes("Imagery"), true);
check("and the roster is bounded", description.includes("and 10 more"), true);

/* Wrapped in a main: this suite runs under tsx's CJS transform, which has no
   top-level await. */
async function main() {
  /* ── Calling something that was not found is refused, by name ─────────────── */

  const call = (tools.call_capability as { execute: (input: unknown, options: unknown) => Promise<string> }).execute;
  const invoke = (input: Record<string, unknown>) => call(input, {} as never);

  check("an unknown capability is refused",
    (await invoke({ capability: "nope", operation: "x" })).includes('no connected API with the id "nope"'), true);
  /* Naming what is connected turns a dead end into a next step. */
  check("and names what is connected instead",
    (await invoke({ capability: "nope", operation: "x" })).includes("Connected: imagery"), true);
  check("an unknown operation is refused too",
    (await invoke({ capability: "imagery", operation: "nope" })).includes('has no operation "nope"'), true);
  /* The failure this prevents: a guessed endpoint reaches somebody else's server
     as a real request, and a 404 from a guess reads exactly like a 404 from a
     resource that is gone. */
  check("and both say not to guess",
    (await invoke({ capability: "imagery", operation: "nope" })).includes("do not guess an endpoint"), true);

  /* ── The gate stops the write here, not at the other end ────────────────────
     The other end is where it would already have happened. */

  const blocked = await invoke({ capability: "imagery", operation: "deleteImage", args: { id: "a" } });
  check("an unapproved write is not sent", blocked.includes("has not been called"), true);
  check("and says what it would have done", blocked.includes("DELETE /images/{id}"), true);
  check("and asks for approval rather than refusing outright",
    blocked.includes("ask whether to approve it"), true);
  /* Approval is remembered, and saying so is what stops it reading as a
     permanent refusal the model should route around. */
  check("and says the asking happens once", blocked.includes("asked once per operation"), true);
  check("and forbids looking for a way around it",
    blocked.includes("Do not look for another way around this"), true);

  /* A read is never gated. If every call asked, the gate would be noise and
     would be clicked through. */
  const realFetch = globalThis.fetch;
  let seen: { url: string; method: string; headers: Record<string, string> } | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen = {
      url: String(input),
      method: String(init?.method),
      headers: (init?.headers ?? {}) as Record<string, string>
    };
    return new Response(JSON.stringify({ images: ["a", "b"] }), { status: 200 });
  }) as typeof fetch;

  const read = await invoke({ capability: "imagery", operation: "listImages" });
  check("a read goes straight through", read.includes("succeeded"), true);
  check("and its body comes back", read.includes('"images"'), true);
  check("built against the manifest's base url",
    (seen as unknown as { url: string } | null)?.url, "https://api.example.com/v1/images");
  check("with the key where the spec said",
    (seen as unknown as { headers: Record<string, string> } | null)?.headers.Authorization, "Bearer secret-key");

  /* An approved write goes through without asking again. */
  const approvedTools = toolsFor([capability(["deleteImage"])]);
  const approvedCall = (approvedTools.call_capability as { execute: (i: unknown, o: unknown) => Promise<string> }).execute;
  const wrote = await approvedCall({ capability: "imagery", operation: "deleteImage", args: { id: "a" } }, {} as never);
  check("an approved write is actually sent", wrote.includes("succeeded"), true);
  check("with the method the operation declared",
    (seen as unknown as { method: string } | null)?.method, "DELETE");

  /* ── A failing API is reported as failing ────────────────────────────────────
     A dead credential that gets swallowed becomes an assistant that quietly
     stops using an API and never says why. */

  globalThis.fetch = (async () => new Response("no", { status: 401, statusText: "Unauthorized" })) as typeof fetch;
  const denied = await invoke({ capability: "imagery", operation: "listImages" });
  check("a 401 is reported with its status", denied.includes("401"), true);
  check("and named as an authentication problem", denied.includes("authentication failure"), true);
  check("and says not to retry it", denied.includes("rather than retrying"), true);

  globalThis.fetch = (async () => new Response("slow down", { status: 429, statusText: "Too Many Requests" })) as typeof fetch;
  check("a rate limit says not to retry in this turn",
    (await invoke({ capability: "imagery", operation: "listImages" })).includes("Do not retry it in this turn"), true);

  /* The key must not be echoed into a result that gets stored in a conversation. */
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
  const queryKeyTools = buildCapabilityTools({
    capabilities: [{
      ...capability(),
      manifest: { ...capability().manifest, auth: { kind: "query", name: "api_key" } }
    }]
  });
  const queryCall = (queryKeyTools.call_capability as { execute: (i: unknown, o: unknown) => Promise<string> }).execute;
  const echoed = await queryCall({ capability: "imagery", operation: "listImages" }, {} as never);
  check("a key in the query string is not echoed into the result", echoed.includes("secret-key"), false);

  globalThis.fetch = realFetch;

  /* ── The approval tool runs on the device, because a grant is the owner's ──── */

  check("approval carries no server-side execute", "execute" in (tools.approve_capability_write as object), false);
  check("and takes a reason to show them",
    Boolean((tools.approve_capability_write as { inputSchema?: unknown }).inputSchema), true);
  /* Search says whether a call will ask *before* it is made, so a read can be
     chosen instead of walking into a confirmation. */
  check("find_capability does have one, because searching is local",
    "execute" in (tools.find_capability as object), true);

  const found = await (tools.find_capability as { execute: (i: unknown, o: unknown) => Promise<string> })
    .execute({ query: "satellite images" }, {} as never);
  check("searching returns callable detail", found.includes("imagery.listImages"), true);
  check("and marks which one would ask", found.includes("has not been approved yet"), true);
}

void main().then(() => {
  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
});
