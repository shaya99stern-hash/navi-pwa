import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compactChatForCloud, mergeCloudChats } from "@/lib/memory/cloud-sync";
import type { StoredChat } from "@/lib/ai/types";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const chat = (id: string, updatedAt: number, title = id): StoredChat => ({
  id, title, preview: "", updatedAt, pinned: false,
  messages: [{ id: `${id}-m`, role: "user", parts: [{ type: "text", text: "hi" }] } as unknown as StoredChat["messages"][number]]
});

/* ── Merge semantics ─────────────────────────────────────────────────────────
   The rule that must never regress: merging can only ever add or refresh a
   conversation. It must not delete one, whichever side is missing it. */

const merged = mergeCloudChats(
  [chat("a", 200, "local-newer"), chat("b", 50, "local-older"), chat("only-local", 10)],
  [chat("a", 100, "cloud-older"), chat("b", 150, "cloud-newer"), chat("only-cloud", 10)]
);
const byId = new Map(merged.map((entry) => [entry.id, entry]));

check("both sides' unique chats survive", merged.length, 4);
check("the newer local copy wins", byId.get("a")?.title, "local-newer");
check("the newer cloud copy wins", byId.get("b")?.title, "cloud-newer");
check("a local-only chat is never deleted", byId.has("only-local"), true);
check("a cloud-only chat appears", byId.has("only-cloud"), true);

const tie = mergeCloudChats([chat("t", 100, "local")], [chat("t", 100, "cloud")]);
check("a timestamp tie keeps the local copy", tie[0]?.title, "local");

/* ── Compaction ──────────────────────────────────────────────────────────────
   Photos embedded as data URLs must not ride along into a jsonb row, and the
   original message object must not be mutated. */

const bigUrl = `data:image/jpeg;base64,${"A".repeat(150_000)}`;
const withPhoto: StoredChat = {
  ...chat("p", 1),
  messages: [{
    id: "m1", role: "user",
    parts: [
      { type: "text", text: "look at this" },
      { type: "file", mediaType: "image/jpeg", url: bigUrl },
      { type: "file", mediaType: "image/png", url: "data:image/png;base64,tiny" }
    ]
  } as unknown as StoredChat["messages"][number]]
};

const compacted = compactChatForCloud(withPhoto);
const parts = (compacted.messages[0] as unknown as { parts: Array<{ url?: string; text?: string }> }).parts;
check("a huge data url is dropped from the mirror", parts[1].url, "data:,omitted-from-sync");
check("a small data url survives", parts[2].url, "data:image/png;base64,tiny");
check("text parts are untouched", parts[0].text, "look at this");
const originalParts = (withPhoto.messages[0] as unknown as { parts: Array<{ url?: string }> }).parts;
check("the original chat is not mutated", originalParts[1].url === bigUrl, true);

/* ── A refusal is a settled answer, not a reason to keep asking ──────────── */

/* Local preferences were the only input to whether the mirror wrote, so a
   deployment with no Supabase and a signed-out visitor each produced a doomed
   PUT every few seconds for as long as the app was open — every one of them
   `keepalive`, drawing on a small per-page budget shared with requests that
   matter. Every failure here is silent by design, so nothing ever surfaced it. */
const syncSource = readFileSync(join(process.cwd(), "lib/memory/cloud-sync.ts"), "utf8");

check("503 and 401 stop the mirror", /response\.status === 503 \|\| response\.status === 401/.test(syncSource), true);
check("a transient failure does not", /catch\(\(\) => \{\}\)/.test(syncSource), true);
check("every write path checks before sending", (syncSource.match(/cloudSyncActive\(\)/g) ?? []).length >= 4, true);
check("the second write rechecks after the first", syncSource.includes("if (preferences && !refused)"), true);
/* Otherwise "sign in and it will sync" would be true only after a reload. */
check("a working pull revives it", /if \(!chatsBody\.configured\) return null;\s*\n[\s\S]{0,400}refused = false;/.test(syncSource), true);
check("the mirror reports its own state", syncSource.includes("export function cloudSyncActive"), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
