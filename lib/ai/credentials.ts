/**
 * Every name this deployment will accept for a credential, in one place.
 *
 * ## The bug this exists to close
 *
 * The GitHub token was resolved in four modules, and no two of them read the
 * same set of variables:
 *
 * | Where                                                            | Accepted |
 * |------------------------------------------------------------------|----------|
 * | `isEntryConfigured`, which is what `inspect_environment` reports  | `GITHUB_PAT`, `NAVI_GITHUB_TOKEN`, `GITHUB_TOKEN` |
 * | `readGithubToken`, which gates every repository tool              | `NAVI_GITHUB_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN` |
 * | `dev-tools`                                                       | `NAVI_GITHUB_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN` |
 * | `selfUpdateToken`, which gates committing                         | `GITHUB_PAT`, `NAVI_GITHUB_TOKEN` |
 *
 * So a deployment with only `GITHUB_PAT` set — the name the Settings screen
 * offers first and the only one the service catalogue knows — reports GitHub as
 * connected, can commit to its own source, and has **no repository read tools
 * at all**, because the one resolver that gates them never looks at that
 * variable. Set only `GH_TOKEN` and it inverts: the reads work and the app says
 * GitHub is not configured.
 *
 * Neither is visible from inside. Both produce an assistant that describes its
 * own capabilities incorrectly while every individual module behaves exactly as
 * written — which is the failure this codebase keeps finding, in a new place.
 *
 * ## Ambient names, and why writing is not the same question as reading
 *
 * Unifying the four lists into one had a consequence worth stating rather than
 * discovering: `GITHUB_TOKEN` and `GH_TOKEN` are injected automatically by CI
 * platforms and agent runtimes. They were already present in this project's own
 * build environment, unset by any person. Reading a repository with a token the
 * platform handed over is unremarkable. Committing to this app's own source
 * with one is not — nobody chose to grant that, and the first anyone would know
 * is a commit.
 *
 * So there is still one list per credential, and one extra fact about two of
 * its entries: a name a platform sets by convention is evidence of a token, not
 * evidence of consent. Reads take any name. Writing to our own source takes a
 * name only a person would have set. That distinction lives here, once, in the
 * open — rather than as an accident of which module happened to be written
 * first.
 */

type CredentialSpec = {
  /** Every accepted variable name, most preferred first. */
  names: readonly string[];
  /**
   * Names that CI platforms and agent runtimes inject on their own. Their
   * presence proves a token exists; it does not prove anyone meant this app to
   * have it.
   */
  ambient: readonly string[];
};

export const CREDENTIALS = {
  github: {
    /* `GITHUB_PAT` first because it is what the Settings screen and the service
       catalogue name, so it is what a person following the app's own advice
       will have set. */
    names: ["GITHUB_PAT", "NAVI_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"],
    ambient: ["GITHUB_TOKEN", "GH_TOKEN"]
  },
  vercel: {
    names: ["NAVI_VERCEL_TOKEN", "VERCEL_API_TOKEN", "VERCEL_TOKEN"],
    ambient: []
  }
} as const satisfies Record<string, CredentialSpec>;

export type CredentialId = keyof typeof CREDENTIALS;

/** Every variable name accepted for this credential, most preferred first. */
export function credentialNames(id: CredentialId): readonly string[] {
  return CREDENTIALS[id].names;
}

/** The names a person would only have set on purpose. */
export function deliberateCredentialNames(id: CredentialId): readonly string[] {
  const { names, ambient } = CREDENTIALS[id];
  return names.filter((name) => !(ambient as readonly string[]).includes(name));
}

/**
 * The credential's value, or undefined when none of its names is set.
 *
 * `deliberate` restricts the search to names a platform does not set by itself.
 * Use it for anything that writes on the owner's behalf; leave it off for
 * reads, where a token is a token.
 *
 * Server-only, and the value never leaves the process it is read in — callers
 * pass it to an API or check it for presence. Nothing here renders it.
 */
export function readCredential(id: CredentialId, options: { deliberate?: boolean } = {}): string | undefined {
  const names = options.deliberate ? deliberateCredentialNames(id) : credentialNames(id);
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Whether any of this credential's names is set. */
export function hasCredential(id: CredentialId, options: { deliberate?: boolean } = {}): boolean {
  return Boolean(readCredential(id, options));
}

/**
 * How to name this credential to a person, without pretending the alternatives
 * do not exist.
 *
 * Saying only "set GITHUB_PAT" to someone who already has `GITHUB_TOKEN` set
 * sends them to add a second variable for a capability they already have.
 * Saying all four without an order is no advice at all.
 */
export function credentialAdvice(id: CredentialId): string {
  const [preferred, ...rest] = credentialNames(id);
  return rest.length
    ? `${preferred} (or ${rest.join(", ")}, all of which are read)`
    : preferred;
}
