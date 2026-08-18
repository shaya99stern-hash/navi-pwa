import { historyAnswer } from "@/lib/memory";
import type { StoredChat } from "@/lib/ai/types";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* ── Being able to look, instead of answering from what was handed over ──────
   Recall already pushes four passages into every prompt. That is background
   context: capped before the question was read, thresholded so a coincidence
   never lands, and — the part that matters here — indistinguishable from the
   inside between "the automatic pass found nothing" and "nothing was ever
   said". A model asked "when did we last talk about X" with no passage about X
   answers anyway, and the reconstruction reads exactly like a memory.

   These tests are about the difference between those two, because that is the
   whole reason the tool exists. */

const NOW = Date.UTC(2026, 7, 18, 12, 0, 0);
const day = 86_400_000;

const chat = (id: string, title: string, ageDays: number, turns: string[]): StoredChat => ({
  id,
  title,
  preview: turns[0] ?? "",
  createdAt: NOW - ageDays * day,
  updatedAt: NOW - ageDays * day,
  messages: turns.map((text, index) => ({
    id: `${id}-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    parts: [{ type: "text", text }]
  }))
} as unknown as StoredChat);

const chats: StoredChat[] = [
  chat("c1", "Artifact frame sizing", 1, [
    "the artifact keeps growing every time it renders",
    "That was a resize feedback loop: scrollHeight inside the iframe plus body padding added 32px per observation."
  ]),
  chat("c2", "Voice mode plan", 6, [
    "I want the voice mode to be one tap in the composer",
    "Half-duplex first: the microphone stays shut while the reply plays."
  ]),
  chat("c3", "County filing deadlines", 90, [
    "what is the deadline for the county filing",
    "Late submissions are rejected outright, so the whole schedule shifts."
  ])
];

/* ── A literal hit is the answer, with a date on it ───────────────────────── */

const found = historyAnswer("half-duplex", chats, "current", { now: NOW });
check("the conversation that said it is found", found.includes("Voice mode plan"), true);
check("with the words that were actually used", found.includes("microphone stays shut"), true);
/* "We talked about this" is useless without when. The whole request was to be
   able to say which conversation and roughly when. */
check("and when it was, in words", found.includes("6 days ago"), true);
check("and as a date that does not depend on the reader", found.includes("2026-08-12"), true);

/* Recency phrasing has to survive the boundaries, or "today" reads as a bug. */
check("today is said as today", historyAnswer("resize feedback", [chat("x", "T", 0, ["resize feedback loop"])], "c", { now: NOW }).includes("today"), true);
check("yesterday as yesterday", historyAnswer("resize feedback", [chat("x", "T", 1, ["resize feedback loop"])], "c", { now: NOW }).includes("yesterday"), true);
check("months once days stop being legible", historyAnswer("resize feedback", [chat("x", "T", 65, ["resize feedback loop"])], "c", { now: NOW }).includes("2 months ago"), true);
check("and years beyond that", historyAnswer("resize feedback", [chat("x", "T", 400, ["resize feedback loop"])], "c", { now: NOW }).includes("1 year ago"), true);

/* ── The failure this is built to prevent ────────────────────────────────────
   Nothing found must read as nothing found. An answer that trails off into
   "we discussed this a while back" is the invention, and it is indistinguishable
   from a real memory to the person reading it. */

const nothing = historyAnswer("kubernetes autoscaling", chats, "current", { now: NOW });
check("an empty search says so", /Nothing in the saved conversations/.test(nothing), true);
check("and forbids reconstructing one", /rather than reconstructing/.test(nothing), true);
check("naming what was searched for", nothing.includes("kubernetes autoscaling"), true);

/* ── Topical fallback is labelled as topical ─────────────────────────────────
   The ranked pass can find the conversation that was *about* something without
   containing the words. That is genuinely useful and it is a different claim,
   so the two must never be presented the same way — "you said X on the 3rd" is
   a quotation, and a topical match cannot support one. */

const near = historyAnswer("iframe height observation", chats, "current", { now: NOW });
check("a topical match is still surfaced", near.includes("Artifact frame sizing"), true);
check("but is not described as a literal one", /No conversation contains the words/.test(near), true);
check("and says so again at the end", /matched by topic, not by wording/.test(near), true);
/* The literal path must never carry that caveat, or every answer hedges. */
check("a literal hit carries no topical caveat", /matched by topic/.test(found), false);
check("and is told it may be quoted", /Quote them as what was said/.test(found), true);

/* ── The conversation you are in is searchable, and marked ─────────────────── */

const here = historyAnswer("half-duplex", chats, "c2", { now: NOW });
check("the open conversation is not hidden from search", here.includes("Voice mode plan"), true);
check("but is marked as the one you are in", here.includes("this is the conversation you are in now"), true);

/* ── Bounds ──────────────────────────────────────────────────────────────── */

check("a one-character query is refused rather than matching everything",
  historyAnswer("a", chats, "c", { now: NOW }), "A search needs at least two characters.");
check("whitespace is not a query", historyAnswer("   ", chats, "c", { now: NOW }), "A search needs at least two characters.");
check("no saved chats is not an error", /Nothing in the saved conversations/.test(historyAnswer("anything", [], "c", { now: NOW })), true);

/* A result set large enough to crowd out the question defeats the purpose. */
const many = Array.from({ length: 40 }, (_, index) => chat(`m${index}`, `Thread ${index}`, index, ["shared phrase here"]));
const capped = historyAnswer("shared phrase", many, "c", { now: NOW });
check("results are capped", (capped.match(/^### /gm) ?? []).length <= 8, true);
check("and the answer stays small enough to be read alongside the question", capped.length < 6_000, true);
check("an explicit limit is honoured",
  (historyAnswer("shared phrase", many, "c", { limit: 3, now: NOW }).match(/^### /gm) ?? []).length, 3);
/* A limit past the cap is clamped rather than obeyed, or the cap is decorative. */
check("and a limit past the ceiling is clamped",
  (historyAnswer("shared phrase", many, "c", { limit: 999, now: NOW }).match(/^### /gm) ?? []).length <= 8, true);

/* ── The wiring, read from the production files ─────────────────────────────
   A tool nobody registers, a client that ignores it, or an instruction gated
   on the wrong thing are all the same defect from the user's side: it never
   runs. This repository has shipped each of those, so the links get checked
   rather than assumed. */

const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");
const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

const declaration = read("lib/ai/history-tools.ts");
const registry = read("lib/tools/registry.ts");
const shell = read("app/components/app-shell.tsx");
const route = read("app/api/chat/route.ts");

/* The whole reason it runs on the device: the conversations are in IndexedDB
   and the edge runtime has never seen one. An `execute` here would make the
   tool answer from the server, where there is nothing to search. */
check("the tool carries no server-side execute", /execute:/.test(declaration), false);
check("and the client answers it", /toolCall\.toolName === "search_history"/.test(shell), true);
check("returning the rendered answer rather than raw matches", /output: historyAnswer\(/.test(shell), true);
/* A callback created several turns ago holding the chat list from that render
   would search a stale copy — and the newest conversation is exactly the one a
   question about "the last time" is most likely to mean. */
check("reading the chats from a ref, not from a stale render", /chatsRef\.current/.test(shell), true);
check("and which chat is open from one too", /activeIdRef\.current/.test(shell), true);

check("the group is registered", /name: "history"/.test(registry), true);
/* Always on. The turns that need it are the ones where the automatic recall
   pass came back empty, and that is not a condition anything can detect in
   advance — which is precisely why gating it on phrase-matching would fail on
   the turns it exists for. */
check("and always on, like the environment group", /name: "history",\n    tools: \(\) => buildHistoryTools\(\),\n    when: \(\) => true/.test(registry), true);
check("and actually built into the toolset", /\.\.\.buildHistoryTools\(\),/.test(registry), true);

/* Gated on the toolset rather than on a flag, so the prompt can never describe
   a capability this turn does not hold — the shape of the bug that had the app
   telling its own model it could not browse while holding a working fetcher. */
check("the instruction is gated on the tool actually being present",
  /toolNames\.includes\("search_history"\) \? historyInstruction\(\)/.test(route), true);
/* The instruction has to name the failure, not just the feature: a model that
   knows the tool exists still answers from context unless told that context's
   silence is not evidence. */
check("and tells it that an empty context is not evidence of nothing",
  /its absence is not evidence that nothing was said/.test(declaration), true);
check("and forbids the reconstruction outright",
  /Never reconstruct a plausible version of a conversation you cannot point at/.test(declaration), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
