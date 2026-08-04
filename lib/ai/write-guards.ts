/**
 * What a repository write is never allowed to touch.
 *
 * The existing guards stop the *wrong branch* — nothing commits to a default
 * branch, everything ships as a pull request. These stop the wrong *file*,
 * which is a different failure with a different blast radius: a bad commit on a
 * working branch is reviewed and discarded, but a workflow file or a leaked
 * credential is a problem the moment it exists in the history, reviewed or not.
 *
 * Each rule below closes a path where the pull-request review step is not
 * enough protection on its own.
 */

/**
 * A workflow file is code that runs with the repository's own permissions, and
 * it runs when the pull request is *opened*, before anyone has read it. So this
 * is the one place where "the user reviews it in GitHub" stops being true.
 */
const WORKFLOW_PATH = /(^|\/)\.github\/workflows\//i;

/**
 * Anything env-shaped. Writing one is how a real secret gets committed by an
 * assistant trying to be helpful about configuration — the file it produces
 * looks like a template right up until someone fills it in.
 */
const ENV_PATH = /(^|\/)\.?env(\.|$)|(^|\/)[^/]*\.env(\.[^/]*)?$/i;

/** Key material, which has no business being written by a model at all. */
const KEY_PATH = /\.(pem|key|p12|pfx|keystore|jks)$/i;

/**
 * Credential shapes, matched on the content rather than the filename.
 *
 * Deliberately specific: a rule broad enough to catch every possible secret
 * would refuse ordinary code, and a write tool that cries wolf gets worked
 * around. These are the prefixes that are unambiguous — a string starting
 * `sk-` or `ghp_` is not a variable name.
 */
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "an OpenAI-style key", pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: "an OpenRouter key", pattern: /\bsk-or-[A-Za-z0-9-]{20,}\b/ },
  { name: "a GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "a Google API key", pattern: /\bAIza[A-Za-z0-9_-]{30,}\b/ },
  { name: "a Groq key", pattern: /\bgsk_[A-Za-z0-9]{30,}\b/ },
  { name: "a Hugging Face token", pattern: /\bhf_[A-Za-z0-9]{30,}\b/ },
  { name: "an AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "a Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "a private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "a JSON web token", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ }
];

/** One write call may not touch more than this. */
export const MAX_FILES_PER_WRITE = 20;

export type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * Whether this path may be written at all.
 *
 * The refusals name what was refused and why. A model told only "no" tries a
 * variation; a model told "workflow files run before review" stops and says so
 * to the user, which is the outcome worth having.
 */
export function guardPath(path: string): GuardResult {
  const trimmed = path.trim();
  if (!trimmed) return { ok: false, reason: "No file path was given." };
  if (trimmed.startsWith("/") || trimmed.includes("..")) {
    return { ok: false, reason: "Paths must be repository-relative and must not traverse upward." };
  }
  if (WORKFLOW_PATH.test(trimmed)) {
    return { ok: false, reason: "Refusing to write a GitHub Actions workflow. Workflow files run with the repository's own permissions when a pull request opens, which is before anyone has reviewed them. Describe the change instead and let the user apply it." };
  }
  if (ENV_PATH.test(trimmed)) {
    return { ok: false, reason: "Refusing to write an environment file. Name the variables the user needs to set and where they go, rather than committing a file that will end up holding real values." };
  }
  if (KEY_PATH.test(trimmed)) {
    return { ok: false, reason: "Refusing to write key material into a repository." };
  }
  return { ok: true };
}

/** Whether this content may be committed. */
export function guardContent(content: string): GuardResult {
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      return { ok: false, reason: `That file contains what looks like ${name}. Refusing to commit it. Replace the value with a placeholder and tell the user which variable to set.` };
    }
  }
  return { ok: true };
}

/** Both checks, in the order that gives the most useful refusal first. */
export function guardWrite(path: string, content: string): GuardResult {
  const pathResult = guardPath(path);
  if (!pathResult.ok) return pathResult;
  return guardContent(content);
}

/**
 * The branch a write should land on.
 *
 * Generated rather than accepted from the model so the naming is consistent and
 * so a collision with an existing branch is unlikely without a round trip to
 * check. The slug keeps it readable in GitHub's branch list.
 */
export function workingBranchName(intent: string): string {
  const slug = intent
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "change";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `navisol/${slug}-${suffix}`;
}
