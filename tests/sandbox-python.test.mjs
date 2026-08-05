import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const root = process.cwd();
const vm = readFileSync(join(root, "lib/execution/vercel-sandbox.ts"), "utf8");
const codeRoute = readFileSync(join(root, "app/api/tools/code/route.ts"), "utf8");
const chatRoute = readFileSync(join(root, "app/api/chat/route.ts"), "utf8");
const tools = readFileSync(join(root, "lib/ai/execution-tools.ts"), "utf8");
const registry = readFileSync(join(root, "lib/tools/registry.ts"), "utf8");

/* ── The runtime split ───────────────────────────────────────────────────────
   The whole reason it exists: the chat route is Edge for time to first token,
   and the sandbox SDK only runs on Node. Importing the sandbox into the chat
   route fails at build time with an error that reads like a missing dependency
   rather than a runtime mismatch. */

check("the chat route is still edge", /export const runtime = "edge"/.test(chatRoute), true);
check("the code route is node", /export const runtime = "nodejs"/.test(codeRoute), true);
check("the chat route never imports the sandbox", /vercel-sandbox|@vercel\/sandbox/.test(chatRoute), false);
check("the sandbox module is server-only", vm.includes('import "server-only"'), true);
check("the code route owns the sandbox import", codeRoute.includes("@/lib/execution/vercel-sandbox"), true);
// The tool reaches the route over HTTP rather than importing it.
check("the tool calls the route over http", tools.includes('new URL("/api/tools/code", origin)'), true);
check("the tool does not import the sandbox", /@vercel\/sandbox|vercel-sandbox/.test(tools), false);

/* Forwarded so the Node route sees the same signed-in user, rather than
   becoming an unauthenticated way to spend someone else's allowance. */
check("the caller's cookie is forwarded", tools.includes("Cookie: cookie"), true);
check("the chat route supplies the cookie", chatRoute.includes('request.headers.get("cookie")'), true);
check("the registry threads the origin", registry.includes("buildExecutionTools({ origin, cookie })"), true);

/* ── Each engine takes the work it is better at ──────────────────────────── */

/* JavaScript stays on the device. A microVM takes seconds to create and a
   worker takes milliseconds; routing a quick snippet check through the server
   pays a startup cost on the common case to serve the rare one. */
check("javascript has no server-side execute", /run_javascript: tool\(\{[\s\S]{0,900}execute:/.test(tools), false);
check("python does have one", /run_python: tool\(\{[\s\S]{0,1400}execute:/.test(tools), true);
check("the route refuses javascript", codeRoute.includes('This endpoint runs Python'), true);
check("the prompt says when to prefer each", /prefer `run_javascript` for a quick check/.test(tools), true);

/* ── Nothing the sandbox runs may reach the network ──────────────────────── */

/* Verified against the package's own type definitions, which declare
   NetworkPolicy as "allow-all" | "deny-all" | {...}. Not guessed. */
check("the network policy denies everything", vm.includes('networkPolicy: "deny-all"'), true);
check("the code does not run as root", vm.includes("sudo: false"), true);
check("there is a hard wall clock", /SANDBOX_TIMEOUT_MS = 30_000/.test(vm), true);
check("the timeout is passed to the sandbox", /timeout: SANDBOX_TIMEOUT_MS/.test(vm), true);
check("output is truncated", vm.includes("MAX_OUTPUT_CHARS"), true);
check("the source size is bounded", codeRoute.includes("MAX_SOURCE_BYTES"), true);

/* A sandbox left to expire on its own keeps counting against the concurrency
   limit, which is ten — enough to lock out every other request. */
check("the sandbox is stopped explicitly", /finally \{[\s\S]{0,400}sandbox\?\.stop\(\)/.test(vm), true);

/* ── The ceiling ─────────────────────────────────────────────────────────── */

check("creations are counted", vm.includes("recordCreation()"), true);
check("the ceiling is checked before creating", vm.indexOf("await sandboxAllowed()") < vm.indexOf("Sandbox.create("), true);
check("it stops at ninety percent", /DISABLE_AT = 0\.9/.test(vm), true);
check("the free allotment is the tier's", /MONTHLY_CREATIONS = 5_000/.test(vm), true);

/* Fails *closed*, unlike the search ceiling. Sandboxes bill on active CPU past
   the free allotment, so an unreadable counter here could cost money where an
   unreadable search counter only costs a worse answer. */
check("an unreadable counter fails closed", /catch\(\(\) => allowance\(\)\)/.test(vm), true);

/* ── Failure has one shape ───────────────────────────────────────────────── */

/* Never throws, for the same reason the browser sandbox never rejects: the
   repair loop should handle one shape — the code was wrong — not two. */
check("the verdict is the first line", vm.includes('result.ok ? "The code ran successfully." : "The code failed."'), true);
check("infrastructure failure reads as a failed run", vm.includes('return fail("The sandbox could not run that.")'), true);
check("a timeout explains itself", /did not finish — check for a loop that never ends/.test(vm), true);
check("the trace can read the verdict", vm.includes('"The code failed."'), true);
// The tool's own error paths use the same first line, so the UI reads them too.
check("an unreachable route still reads as a failed run", (tools.match(/The code failed\.\\n\\nError:/g) ?? []).length >= 3, true);

/* ── The dependency is real and pinned ───────────────────────────────────── */

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
check("the sandbox sdk is a dependency", Boolean(pkg.dependencies["@vercel/sandbox"]), true);
/* Pinned exactly, not caret-ranged. The API surface here was verified against
   this version's own type definitions; a minor bump could move it, and the
   failure would appear at runtime in a sandbox nobody is watching. */
check("it is pinned exactly", /^\d+\.\d+\.\d+$/.test(pkg.dependencies["@vercel/sandbox"]), true);

export {};

/* ---- Credentials ------------------------------------------------------
 * `Sandbox.create` accepts credentials one of exactly two ways: all three of
 * token, teamId and projectId, or the VERCEL_OIDC_TOKEN variable Vercel
 * injects at runtime. This module passed none, leaving only the OIDC path —
 * and OIDC is not on by default, so Python execution would have failed on any
 * project without it, reporting an OIDC context error rather than a missing
 * credential. */
const sandboxSource = readFileSync(join(process.cwd(), "lib/execution/vercel-sandbox.ts"), "utf8");

check("credentials are passed to create", /\.\.\.\(sandboxCredentials\(\) \?\? \{\}\)/.test(sandboxSource), true);
check("the token has aliases", sandboxSource.includes("NAVI_VERCEL_TOKEN"), true);
check("the team is read", sandboxSource.includes("VERCEL_TEAM_ID"), true);
check("the project is read", sandboxSource.includes("VERCEL_PROJECT_ID"), true);
/* All three or none. The SDK throws on an incomplete set, and that throw would
   be reported as the sandbox being unavailable rather than as a setup mistake. */
check("a partial set yields nothing", /token && teamId && projectId \? \{ token, teamId, projectId \} : undefined/.test(sandboxSource), true);
/* OIDC remains valid, so a project that has it keeps working unconfigured. */
check("OIDC still counts as configured", /VERCEL_OIDC_TOKEN/.test(sandboxSource), true);
check("the gap is named for the log", sandboxSource.includes("describeSandboxConfigGap"), true);
check("the route logs the gap before trying", readFileSync(join(process.cwd(), "app/api/tools/code/route.ts"), "utf8").includes("describeSandboxConfigGap()"), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
