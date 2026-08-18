import { MAX_OPERATIONS, type CapabilityAuth, type CapabilityOperation, type HttpMethod } from "./manifest";
import type { AddedCapability } from "./search";

/**
 * Capabilities as they arrive from the device, treated as input rather than as
 * state.
 *
 * A manifest is discovered on the device, stored in the owner's preferences,
 * and sent with each request — the same path a custom connector's credential
 * already takes, and for the same reason: the key stays theirs and the server
 * holds nothing. The consequence is that everything here crosses the wire as
 * JSON somebody could have edited, so none of it is trusted on arrival.
 *
 * It is worth being plain about what the risk actually is. The owner is not
 * attacking their own app. But a stored value is one a bug can corrupt and a
 * sync can mangle, and the fields being validated are the ones that become an
 * outbound HTTP request from this server: the host it goes to, the method, the
 * path. A manifest with a rewritten `baseUrl` is a request this server makes on
 * somebody else's instruction, which is the shape the URL guards exist for.
 *
 * So: https only, bounded everywhere, unknown methods dropped, and a hard cap
 * on how much one request may carry.
 */

/** Enough for a real deployment, far below what would bloat a request. */
const MAX_CAPABILITIES = 40;
const MAX_NAME = 80;
const MAX_PURPOSE = 300;
const MAX_SUMMARY = 300;
const MAX_PARAMETERS = 40;
const MAX_KEY = 500;
/** A body schema past this is not describing something a model will fill in. */
const MAX_BODY_CHARS = 4_000;

const METHODS = new Set<HttpMethod>(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseAuth(value: unknown): CapabilityAuth {
  const auth = object(value);
  const kind = text(auth?.kind, 16);
  if (kind === "bearer") return { kind: "bearer" };
  if (kind === "header") {
    const name = text(auth?.name, 64).trim();
    /* A header name is put verbatim into an outbound request, so it is held to
       what a header name may actually contain. */
    if (!/^[A-Za-z0-9-]+$/.test(name)) return { kind: "none" };
    const prefix = text(auth?.prefix, 16).trim();
    return prefix ? { kind: "header", name, prefix } : { kind: "header", name };
  }
  if (kind === "query") {
    const name = text(auth?.name, 64).trim();
    if (!name) return { kind: "none" };
    return { kind: "query", name };
  }
  return { kind: "none" };
}

function parseOperation(value: unknown): CapabilityOperation | null {
  const raw = object(value);
  if (!raw) return null;

  const id = text(raw.id, 60).trim();
  const method = text(raw.method, 10).toUpperCase() as HttpMethod;
  const path = text(raw.path, 300).trim();
  if (!id || !METHODS.has(method) || !path.startsWith("/")) return null;

  const parameters = (Array.isArray(raw.parameters) ? raw.parameters : [])
    .map((entry) => {
      const parameter = object(entry);
      const name = text(parameter?.name, 64).trim();
      const location = text(parameter?.in, 16);
      if (!name) return null;
      if (location !== "path" && location !== "query" && location !== "header") return null;
      return {
        name,
        in: location as "path" | "query" | "header",
        required: parameter?.required === true,
        description: text(parameter?.description, MAX_SUMMARY),
        schema: object(parameter?.schema) ?? {}
      };
    })
    .filter((parameter): parameter is NonNullable<typeof parameter> => parameter !== null)
    .slice(0, MAX_PARAMETERS);

  const body = object(raw.body);
  return {
    id,
    method,
    path,
    summary: text(raw.summary, MAX_SUMMARY) || `${method} ${path}`,
    /* Recomputed from the method rather than taken from the payload. This flag
       decides whether the approval gate applies, so accepting it as sent would
       let a corrupted manifest mark a DELETE as a read and walk straight past
       the one check that exists to stop it. */
    writes: method !== "GET",
    parameters,
    ...(body && JSON.stringify(body).length <= MAX_BODY_CHARS ? { body } : {})
  };
}

/** Capabilities the request may actually use, or none. */
export function parseCapabilities(value: unknown): AddedCapability[] {
  if (!Array.isArray(value)) return [];

  const out: AddedCapability[] = [];
  const seen = new Set<string>();

  for (const entry of value.slice(0, MAX_CAPABILITIES)) {
    const added = object(entry);
    const manifest = object(added?.manifest);
    if (!manifest) continue;

    const id = text(manifest.id, 60).trim();
    const baseUrl = text(manifest.baseUrl, 500).trim();
    /* https only, checked here as well as at the call. Two capabilities sharing
       an id would make `call_capability` address an ambiguous one, and the
       later would silently shadow the earlier. */
    if (!id || seen.has(id) || !baseUrl.startsWith("https://")) continue;

    const operations = (Array.isArray(manifest.operations) ? manifest.operations : [])
      .map(parseOperation)
      .filter((operation): operation is CapabilityOperation => operation !== null)
      .slice(0, MAX_OPERATIONS);
    /* An API with nothing callable is not a capability, and offering it would
       put a name in the roster that no search can ever satisfy. */
    if (!operations.length) continue;

    const ids = new Set(operations.map((operation) => operation.id));
    seen.add(id);
    out.push({
      manifest: {
        id,
        name: text(manifest.name, MAX_NAME) || id,
        purpose: text(manifest.purpose, MAX_PURPOSE),
        baseUrl,
        auth: parseAuth(manifest.auth),
        operations,
        source: (["openapi", "documentation", "probe", "manual"] as const)
          .find((kind) => kind === manifest.source) ?? "manual",
        discoveredAt: typeof manifest.discoveredAt === "number" ? manifest.discoveredAt : 0
      },
      apiKey: text(added?.apiKey, MAX_KEY),
      /* Approvals for operations this manifest does not have are dropped rather
         than carried. An approval that outlives the operation it was given for
         is a grant nobody can see and nobody remembers making. */
      approvedWrites: (Array.isArray(added?.approvedWrites) ? added.approvedWrites : [])
        .filter((name: unknown): name is string => typeof name === "string" && ids.has(name))
        .slice(0, MAX_OPERATIONS)
    });
  }

  return out;
}
