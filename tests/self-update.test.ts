import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSelfUpdateTools, isProtectedPath, safeRepoPath } from "@/lib/ai/self-update-tools";
import { buildToolset, wantsSelfUpdate, type ToolsetContext } from "@/lib/tools/registry";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── Path safety ─────────────────────────────────────────────────────────── */

check("an ordinary path is accepted", safeRepoPath("app/components/composer-dock.tsx"), "app/components/composer-dock.tsx");
check("a leading slash is trimmed", safeRepoPath("/app/page.tsx"), "app/page.tsx");
check("traversal is refused", safeRepoPath("../../etc/passwd"), null);
check("a nested traversal is refused", safeRepoPath("app/../../secrets"), null);
check("a backslash is refused", safeRepoPath("app\\page.tsx"), null);
check("an empty segment is refused", safeRepoPath("app//page.tsx"), null);
check("a query smuggle is refused", safeRepoPath("app/page.tsx?ref=main"), null);
check("an empty path is refused", safeRepoPath("   "), null);

/* ── Protected paths ─────────────────────────────────────────────────────────
   A model that can rewrite CI or the security guards can disable its own
   supervision in the same commit that introduces a problem. */

check("workflows are protected", isProtectedPath(".github/workflows/ci.yml"), true);
check("the security layer is protected", isProtectedPath("lib/security/artifacts.ts"), true);
check("the auth layer is protected", isProtectedPath("lib/auth/api.ts"), true);
check("the write guards are protected", isProtectedPath("lib/ai/write-guards.ts"), true);
check("this module protects itself", isProtectedPath("lib/ai/self-update-tools.ts"), true);
check("the build manifest is protected", isProtectedPath("package.json"), true);
check("the lockfile is protected", isProtectedPath("package-lock.json"), true);
check("ordinary source is editable", isProtectedPath("app/components/composer-dock.tsx"), false);
check("ordinary lib code is editable", isProtectedPath("lib/ai/providers.ts"), false);

/* ── Availability ────────────────────────────────────────────────────────────
   The tool exists only when the deployment carries the token that exists for
   exactly this purpose. Offering it without one reproduces the original bug:
   a confident claim to have committed, with nothing behind it. */

delete process.env.GITHUB_PAT;
delete process.env.NAVI_GITHUB_TOKEN;
check("no token, no tools", Object.keys(buildSelfUpdateTools({})).length, 0);

process.env.GITHUB_PAT = "test-token";
const tools = buildSelfUpdateTools({});
check("a token yields the read tool", "read_own_source" in tools, true);
check("a token yields the list tool", "list_own_source" in tools, true);
check("a token yields the commit tool", "commit_own_source" in tools, true);

/* ── Routing ─────────────────────────────────────────────────────────────── */

check("a repo request wants self-update", wantsSelfUpdate("can you edit your own code"), true);
check("an app-change request wants it", wantsSelfUpdate("add a button to this app"), true);
check("a deploy request wants it", wantsSelfUpdate("commit and deploy that"), true);
check("an unrelated request does not", wantsSelfUpdate("what is the capital of France"), false);

const context = (overrides: Partial<ToolsetContext>): ToolsetContext => ({
  mode: "chat",
  policy: { web: false, code: false, artifacts: true },
  signal: new AbortController().signal,
  ...overrides
});

check("code mode offers self-editing", "commit_own_source" in buildToolset(context({ mode: "code" })), true);
check("chat mode offers it when asked about the app", "commit_own_source" in buildToolset(context({ request: "change this app" })), true);
check("an unrelated chat turn does not", "commit_own_source" in buildToolset(context({ request: "write me a poem" })), false);

/* ── The contract the model is held to ───────────────────────────────────── */

const source = readFileSync(join(process.cwd(), "lib/ai/self-update-tools.ts"), "utf8");
check("the commit tool insists on reading first", source.includes("ALWAYS call read_own_source"), true);
check("a rejected commit must be reported honestly", source.includes("rather than claiming the edit landed"), true);
check("a successful commit is stated as real", source.includes("This really happened"), true);
/* Edge has no Buffer, and atob/btoa mangle UTF-8 — an em dash would corrupt. */
check("base64 is utf-8 safe", source.includes("TextEncoder") && source.includes("TextDecoder"), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
