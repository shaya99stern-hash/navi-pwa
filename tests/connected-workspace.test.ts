import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildToolset } from "../lib/tools/registry";
import { decideLocally } from "../lib/ai/navi-soul/router";
import { complexity } from "../lib/ai/question-difficulty";
import { pcmToWav } from "../lib/ai/voice/wav";
import { vercelApiUrl } from "../lib/vercel/api";
import { buildPublicDataTools } from "../lib/ai/public-data-tools";

async function main() {

const base = { mode: "chat" as const, policy: { web: true, code: true, artifacts: true }, signal: new AbortController().signal, clerkToken: "test", clerkUserId: "test" };
process.env.NAVI_VERCEL_TOKEN = "test-token";
process.env.NAVI_VERCEL_TEAM_ID = "team_test";
const tools = buildToolset({ ...base, request: "List my Vercel projects and GitHub repositories", githubToken: "test" });
assert.ok(tools.vercel_list_projects);
assert.ok(tools.vercel_list_deployments);
assert.ok(tools.github_list_repos);
assert.ok(buildToolset({ ...base, request: "List Vercel projects" }).vercel_list_projects);
process.env.NAVI_GITHUB_ALLOW_WRITES = "true";
assert.ok(!Object.keys(buildToolset({ ...base, request: "Read my GitHub repository", githubToken: "test" })).some(n => /create_branch|push_files|create_pull_request/.test(n)));

const artifact = buildToolset({ ...base, request: "Create an interactive calculator artifact" });
assert.ok(Object.keys(artifact).length <= 6);
assert.ok(artifact.run_javascript && artifact.load_work_playbook);
assert.equal(complexity("Build an app"), "complex");
assert.equal(complexity("Hi"), "normal");
assert.deepEqual(decideLocally("Reply with exactly: Hello Shaya."), { route: "local", response: "Hello Shaya.", kind: "command" });
assert.equal(vercelApiUrl("/v9/projects?limit=1").searchParams.get("teamId"), "team_test");
assert.throws(() => vercelApiUrl("https://example.com/"));

const pcm = new Uint8Array([0, 0, 255, 127]);
const wav = pcmToWav(pcm);
assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
assert.equal(new DataView(wav.buffer).getUint32(24, true), 24000);
assert.equal(new DataView(wav.buffer).getUint32(40, true), 4);
assert.deepEqual(wav.slice(44), pcm);
assert.throws(() => pcmToWav(new Uint8Array(3)));

const row = readFileSync("app/components/message-row.tsx", "utf8");
assert.ok(row.indexOf("const spoken = useRef") < row.indexOf("if (!text && files.length"), "failed empty stream must preserve its hooks");
const records = buildPublicDataTools({}).nyc_property_records;
const result = await records.execute!({ borough: 5, block: 1, lot: 1 }, { toolCallId: "test", messages: [], context: {} });
assert.equal((result as { status: string }).status, "unavailable");
console.log("Connected workspace regressions passed.");
}
void main().catch(error => { console.error(error); process.exit(1); });
