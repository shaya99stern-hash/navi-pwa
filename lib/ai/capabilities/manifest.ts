/**
 * What Navi Soul knows about an API somebody added.
 *
 * ## Why this shape exists
 *
 * Every capability in this app is otherwise known at build time. The service
 * catalogue is a literal, the tool groups are a literal, and `CustomConnectorKind`
 * is four strings — so adding a satellite imagery API, or a county records API,
 * or any of the thousands a person might want, means someone writes code first.
 *
 * One path already escapes that, and it is worth being precise about why: MCP
 * servers work because they *describe themselves*. `tools/list` returns names,
 * descriptions and JSON Schemas, and `mcp-tools.ts` turns those straight into
 * callable tools with no adapter code at all. The description is the whole
 * mechanism.
 *
 * A manifest is that description, for APIs that were never going to speak MCP.
 * Where it comes from varies — an OpenAPI document, the API's own docs read by
 * a model, or probing — but once it exists, nothing downstream cares which.
 *
 * ## Discovered once, not re-derived per turn
 *
 * Discovery is slow and can be wrong. Doing it on every turn would spend a
 * request budget re-learning something that did not change, and would make the
 * same API behave differently on Tuesday. So discovery runs when the API is
 * added, the result is stored, and every later turn reads the stored answer —
 * which is also what makes it correctable: a manifest that got something wrong
 * is an object to edit, not a black box to re-roll.
 */

/** How a request proves who it is. */
export type CapabilityAuth =
  | { kind: "none" }
  /** `Authorization: Bearer <key>`, by far the most common. */
  | { kind: "bearer" }
  /** A named header, e.g. `X-API-Key: <key>`. */
  | { kind: "header"; name: string; prefix?: string }
  /** A query parameter, e.g. `?api_key=<key>`. Common, and worse. */
  | { kind: "query"; name: string };

export type CapabilityParameter = {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  description: string;
  /** JSON Schema, passed through so the model sees the real types. */
  schema: Record<string, unknown>;
};

export type CapabilityOperation = {
  /**
   * Stable within a manifest, and used to build the tool name.
   *
   * Taken from `operationId` when the spec has one, because that is the name
   * the API's own authors chose and the one their docs use. Derived from the
   * method and path when it does not.
   */
  id: string;
  method: HttpMethod;
  /** Path template as written in the spec, e.g. `/v1/images/{id}`. */
  path: string;
  summary: string;
  /**
   * Whether calling this changes something.
   *
   * Decided by the method, which is the only signal that is reliable across
   * every API: a `GET` that mutates is a broken API, and a `POST` that does not
   * is merely a wasteful one. This drives the approval gate, so it errs toward
   * calling something a write rather than away from it.
   */
  writes: boolean;
  parameters: CapabilityParameter[];
  /** JSON Schema for the request body, when the operation takes one. */
  body?: Record<string, unknown>;
};

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Methods that only read. Everything else is treated as a write. */
export const READ_METHODS: readonly HttpMethod[] = ["GET"];

export type CapabilityManifest = {
  id: string;
  name: string;
  /** What this API is for, in the words the assistant should use. */
  purpose: string;
  /** Absolute origin plus any base path, with no trailing slash. */
  baseUrl: string;
  auth: CapabilityAuth;
  operations: CapabilityOperation[];
  /**
   * Where the description came from.
   *
   * Kept because the three are not equally trustworthy and an answer should be
   * able to say which it is standing on. A spec is the API's own statement
   * about itself; a model reading docs is an inference; a probe is a guess that
   * happened to work once.
   */
  source: "openapi" | "documentation" | "probe" | "manual";
  discoveredAt: number;
};

/**
 * The ceiling on operations kept from one API.
 *
 * Large public specs run to hundreds of operations, and a manifest is not a
 * mirror of the spec — it is what this app can usefully hold and choose
 * between. The selection that matters happens later, when a turn picks the few
 * operations that bear on the question; this only stops one API from filling
 * the store on its own.
 */
export const MAX_OPERATIONS = 120;

/** Whether calling this operation could change something. */
export function isWrite(method: HttpMethod): boolean {
  return !READ_METHODS.includes(method);
}
