import { guardContent, guardPath, guardWrite, MAX_FILES_PER_WRITE, workingBranchName } from "@/lib/ai/write-guards";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const allowed = (path: string) => guardPath(path).ok;

/* ── Workflow files ──────────────────────────────────────────────────────────
   The one place where "the user reviews it in the pull request" is not true:
   a workflow runs with the repository's own permissions when the PR *opens*,
   before anyone has read a line of it. */

for (const path of [
  ".github/workflows/ci.yml",
  ".github/workflows/deploy.yaml",
  ".github/WORKFLOWS/ci.yml",
  "nested/.github/workflows/thing.yml"
]) {
  check(`refuses ${path}`, allowed(path), false);
}
// Not every .github file is a workflow; only the ones that execute.
check("allows an issue template", allowed(".github/ISSUE_TEMPLATE/bug.md"), true);
check("allows a PR template", allowed(".github/pull_request_template.md"), true);
check("allows ordinary code", allowed("src/app/page.tsx"), true);

/* ── Environment files ───────────────────────────────────────────────────── */

for (const path of [".env", ".env.local", ".env.production", "app/.env", "config/.env.test", "prod.env"]) {
  check(`refuses ${path}`, allowed(path), false);
}
/* A file that merely mentions the word is fine — refusing `environment.ts`
   would block ordinary code, and a guard that cries wolf gets worked around. */
check("allows environment.ts", allowed("lib/environment.ts"), true);
check("allows env-docs.md", allowed("docs/env-docs.md"), true);

/* ── Key material ────────────────────────────────────────────────────────── */

for (const path of ["certs/server.pem", "id_rsa.key", "app.p12", "store.jks"]) {
  check(`refuses ${path}`, allowed(path), false);
}

/* ── Traversal ───────────────────────────────────────────────────────────── */

check("refuses an absolute path", allowed("/etc/passwd"), false);
check("refuses upward traversal", allowed("src/../../secrets"), false);

/* ── Secrets in content, whatever the filename ───────────────────────────── */

const secrets: Array<[string, string]> = [
  ["an OpenAI-style key", 'const key = "sk-abcdefghijklmnopqrstuvwxyz0123456789";'],
  ["an OpenRouter key", 'KEY = "sk-or-v1-abcdefghijklmnopqrstuvwxyz0123"'],
  ["a GitHub token", 'token: "ghp_abcdefghijklmnopqrstuvwxyz0123456789"'],
  ["a Google key", 'apiKey: "AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456"'],
  ["a Groq key", 'GROQ = "gsk_abcdefghijklmnopqrstuvwxyz0123456789"'],
  ["a Hugging Face token", 'HF = "hf_abcdefghijklmnopqrstuvwxyz0123456789"'],
  ["an AWS key", 'AKIAIOSFODNN7EXAMPLE'],
  ["a Slack token", 'xoxb-1234567890-abcdefghij'],
  ["a private key", "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----"],
  ["a JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"]
];

for (const [name, content] of secrets) {
  check(`refuses content with ${name}`, guardContent(content).ok, false);
}

/* Ordinary code must pass, or the guard is unusable and gets routed around. */
for (const ordinary of [
  'const apiKey = process.env.OPENAI_API_KEY;',
  'Set GEMINI_API_KEY in your Vercel project settings.',
  'const sk = computeSkew(values);',
  '// Replace this with your key: sk-...',
  'export const KEY_PREFIXES = ["sk-", "ghp_"];'
]) {
  check(`allows: ${ordinary.slice(0, 40)}`, guardContent(ordinary).ok, true);
}

/* ── The refusals explain themselves ─────────────────────────────────────── */

const workflow = guardPath(".github/workflows/ci.yml");
check("the workflow refusal says why", workflow.ok === false && /before anyone has reviewed/.test(workflow.reason), true);
const env = guardPath(".env");
check("the env refusal offers the alternative", env.ok === false && /Name the variables/.test(env.reason), true);
const secret = guardContent('key = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"');
check("the secret refusal offers the alternative", secret.ok === false && /placeholder/.test(secret.reason), true);

/* A model told only "no" tries a variation. A model told why stops and says so
   to the user, which is the outcome worth having. */
check("path is checked before content", guardWrite(".env", "harmless").ok, false);
check("clean writes pass both checks", guardWrite("src/index.ts", "export const a = 1;").ok, true);

/* ── Branch naming ───────────────────────────────────────────────────────── */

const branch = workingBranchName("Fix the composer inset on iOS");
check("branches carry the app's prefix", branch.startsWith("navisoul/"), true);
check("the slug is readable", branch.includes("fix-the-composer-inset-on-ios"), true);
check("a suffix makes collisions unlikely", workingBranchName("same") === workingBranchName("same"), false);
check("git accepts the name", /^[A-Za-z0-9._\/-]+$/.test(branch), true);
check("an empty intent still yields a branch", workingBranchName("").startsWith("navisoul/change-"), true);
check("punctuation does not leak in", /^navisoul\/[a-z0-9-]+$/.test(workingBranchName("!!! ???")), true);
check("a long intent is bounded", workingBranchName("x".repeat(200)).length < 60, true);

check("a write call is bounded", MAX_FILES_PER_WRITE, 20);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
