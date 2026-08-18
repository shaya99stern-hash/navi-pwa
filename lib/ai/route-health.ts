import { readCatalogCache, writeCatalogCache } from "./catalog";

/**
 * Which configured model ids a provider will actually answer to.
 *
 * ## The failure this closes
 *
 * The routing table names a model per route, and until now nothing on the
 * answer path checked that any of those names still exist. `providerProbes`
 * proves a *credential* works, which is the smaller half of the question:
 * a valid key pointed at a model that was renamed, retired, or never shipped
 * gets a 404, `Promise.allSettled` swallows it, and the turn silently degrades
 * to whatever answers next.
 *
 * That is deliberate behaviour for the *user* — the app promises to route
 * around failure without lecturing anyone about billing — but it also means a
 * rotten route is invisible from the inside. An audit of this table found
 * several ids that appear never to have existed. Nothing detected them, because
 * nothing was looking, and the design was such that nothing could notice.
 *
 * `checkModelRoutes` in the diagnostics could already tell, and only when
 * somebody asked it to. This makes the same knowledge available to route
 * selection, so a route known to be dead stops being chosen at all.
 *
 * ## Unknown is not dead
 *
 * The most important rule here, and the inverse of the one the spend ledger
 * follows. An unreadable ledger reads as *spent*, because over-counting is the
 * only direction that cannot overspend. An unreadable catalogue must read as
 * *fine*, because the failure directions are not symmetric: treating unknown as
 * dead would let one provider's listing endpoint having a bad afternoon disable
 * every route it serves — turning a temporary outage into a self-inflicted one,
 * on the strength of no evidence at all.
 *
 * So `modelResolves` answers `true`, `false`, or `null`, and only a hard
 * `false` is allowed to remove anything.
 */

const CACHE_KEY = "navi:route-health";
/**
 * Long, because model catalogues change on the scale of weeks and this is only
 * ever used to *remove* a route that was already going to fail. A stale entry
 * costs at most one extra fallback hop.
 */
const TTL_MS = 60 * 60 * 1_000;

type Catalogues = Record<string, string[]>;

/**
 * The ids a provider's catalogue listed, parsed from either shape the providers
 * in this app actually use.
 *
 * One parser, shared with the diagnostics that already had one — two readings
 * of the same payload is how two parts of an app come to disagree about which
 * models exist.
 */
export function catalogueModelIds(payload: unknown): Set<string> {
  const ids = new Set<string>();
  if (!payload || typeof payload !== "object") return ids;
  const record = payload as { data?: unknown; models?: unknown };

  for (const entry of Array.isArray(record.data) ? record.data : []) {
    const id = (entry as { id?: unknown })?.id;
    if (typeof id === "string" && id) ids.add(id);
  }
  for (const entry of Array.isArray(record.models) ? record.models : []) {
    const name = (entry as { name?: unknown })?.name;
    /* Google prefixes every id with `models/`; the routes hold the bare id. */
    if (typeof name === "string" && name) ids.add(name.replace(/^models\//, ""));
  }
  return ids;
}

/**
 * Remember what a provider listed.
 *
 * An empty listing is deliberately not recorded: a catalogue that returned
 * nothing proves nothing about any id, and storing it would turn "we could not
 * read it" into "none of these exist" — which is the mistake this whole file is
 * arranged to avoid.
 */
export function recordCatalogue(provider: string, ids: Set<string>): void {
  if (!ids.size) return;
  const existing = readCatalogCache<Catalogues>(CACHE_KEY)?.value ?? {};
  writeCatalogCache<Catalogues>(CACHE_KEY, { ...existing, [provider]: [...ids] }, TTL_MS);
}

/**
 * Whether this provider is known to serve this model.
 *
 * `null` means nobody has looked, the listing could not be read, or the entry
 * has gone stale — all of which are "no evidence", and none of which are
 * grounds for removing a route.
 */
export function modelResolves(provider: string, model: string): boolean | null {
  const cached = readCatalogCache<Catalogues>(CACHE_KEY);
  if (!cached?.fresh) return null;
  const listed = cached.value[provider];
  if (!listed?.length) return null;
  return listed.includes(model);
}

/** What has been learned, for diagnostics and for tests. */
export function knownCatalogues(): Catalogues {
  return readCatalogCache<Catalogues>(CACHE_KEY)?.value ?? {};
}
