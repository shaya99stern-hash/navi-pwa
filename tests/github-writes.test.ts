/* Mirrors the guards in lib/ai/github-write-tools.ts. Those guards are the only
   thing between a malformed tool argument and a rewritten default branch, so
   they are asserted here rather than trusted. */
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const BRANCH_NAME = /^[A-Za-z0-9._\/-]{1,180}$/;
const PROTECTED_BRANCHES = new Set(["main", "master", "production", "release", "prod"]);

const repoSlug = (owner: string, repo: string) =>
  SEGMENT.test(owner) && SEGMENT.test(repo) ? `${owner}/${repo}` : null;
const pathRejected = (path: string) => path.startsWith("/") || path.includes("..");

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = a === e; ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : ` — got ${String(a)}, want ${String(e)}`}`);
};

// Every protected branch name is refused, including the less obvious ones.
for (const branch of ["main", "master", "production", "release", "prod"]) {
  check(`'${branch}' is protected`, PROTECTED_BRANCHES.has(branch), true);
}
check("a working branch is allowed", PROTECTED_BRANCHES.has("navi/fix-inset"), false);

// Path traversal must not reach the contents API.
check("absolute path rejected", pathRejected("/etc/passwd"), true);
check("parent traversal rejected", pathRejected("../../secrets"), true);
check("embedded traversal rejected", pathRejected("app/../../.env"), true);
check("ordinary path allowed", pathRejected("app/globals.css"), false);

// Owner/repo become part of a URL, so they must not carry separators.
check("clean slug builds", repoSlug("shaya99stern-hash", "navi-pwa"), "shaya99stern-hash/navi-pwa");
check("slash in owner rejected", repoSlug("a/b", "repo"), null);
check("query injection rejected", repoSlug("owner", "repo?x=1"), null);
check("empty rejected", repoSlug("", "repo"), null);

// Branch names reach a git ref, so the character set is bounded.
check("nested branch allowed", BRANCH_NAME.test("navi/fix-composer-inset"), true);
check("space rejected", BRANCH_NAME.test("my branch"), false);
check("newline rejected", BRANCH_NAME.test("main\ndelete"), false);
check("over-long rejected", BRANCH_NAME.test("x".repeat(181)), false);

// The write switch is opt-in, and reading the env must not coerce loosely.
const writesEnabled = (value: string | undefined) => value === "true";
check("unset means off", writesEnabled(undefined), false);
check("'false' means off", writesEnabled("false"), false);
check("'1' does not enable writes", writesEnabled("1"), false);
check("'TRUE' does not enable writes", writesEnabled("TRUE"), false);
check("only exact 'true' enables", writesEnabled("true"), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);

export {};
