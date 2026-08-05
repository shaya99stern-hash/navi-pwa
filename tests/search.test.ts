import { searchConversations } from "../lib/memory";
import type { StoredChat } from "../lib/ai/types";
import type { UIMessage } from "ai";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

let clock = 1_000_000;
const say = (role: "user" | "assistant", text: string): UIMessage =>
  ({ id: `m${clock++}`, role, parts: [{ type: "text", text }] }) as UIMessage;

const chat = (id: string, title: string, messages: UIMessage[], extra: Partial<StoredChat> = {}): StoredChat => ({
  id, title, preview: "", updatedAt: clock++, pinned: false, messages, ...extra
});

/* The defect: search matched only the title and a one-line preview, so anything
   said in the middle of a conversation was unfindable — which is most of what
   anyone comes back looking for. */
const deep = chat("deep", "Deployment notes", [
  say("user", "how do I fix this"),
  say("assistant", "The callback is wrong. You will see redirect_uri_mismatch until it matches exactly.")
]);
const titled = chat("titled", "redirect_uri_mismatch", [say("user", "unrelated body text")]);
const noise = chat("noise", "Groceries", [say("user", "milk and eggs")]);
const chats = [deep, titled, noise];

check("a phrase buried in a reply is found", searchConversations("redirect_uri", chats).map((m) => m.chat.id).includes("deep"), true);
check("a title match is found", searchConversations("redirect_uri", chats).map((m) => m.chat.id).includes("titled"), true);
check("unrelated chats are excluded", searchConversations("redirect_uri", chats).map((m) => m.chat.id).includes("noise"), false);
check("an empty query returns nothing", searchConversations("   ", chats), []);
check("no match returns nothing", searchConversations("kangaroo", chats), []);

/* A search box must never return a result that lacks the term — that reads as
   broken. This is the property distinguishing search from `recall`. */
const everyResultContains = (needle: string) =>
  searchConversations(needle, chats).every((match) =>
    `${match.chat.title} ${match.chat.messages.map((m: any) => m.parts.map((p: any) => p.text ?? "").join("")).join(" ")}`
      .toLowerCase().includes(needle.toLowerCase()));
check("every result actually contains the term", everyResultContains("redirect_uri"), true);

check("matching is case-insensitive", searchConversations("REDIRECT_URI", chats).length > 0, true);
check("a partial word matches while being typed", searchConversations("redir", chats).length > 0, true);

/* The snippet is what makes a result list readable without opening each one. */
const snippet = searchConversations("redirect_uri", chats).find((m) => m.chat.id === "deep")?.snippet ?? "";
check("the snippet carries the term", snippet.toLowerCase().includes("redirect_uri"), true);
check("the snippet carries surrounding context", snippet.length > "redirect_uri_mismatch".length, true);
/* Elision only where there is something to elide. The reply above is shorter
   than the snippet radius, so it starts at the beginning and needs no marker —
   asserting a leading ellipsis there tested the fixture, not the function. */
check("a short message is not elided", snippet.startsWith("…"), false);
const long = chat("long", "Long", [say("assistant", `${"filler words here ".repeat(20)}redirect_uri appears late${" and continues".repeat(20)}`)]);
const longSnippet = searchConversations("redirect_uri", [long])[0].snippet;
check("a snippet from mid-message is elided both ends", longSnippet.startsWith("…") && longSnippet.endsWith("…"), true);
check("the elided snippet still carries the term", longSnippet.includes("redirect_uri"), true);
check("the snippet is bounded", longSnippet.length < 200, true);

/* Ranking: a thread that discusses the term outranks one that mentions it once,
   and a title match is strong but must not bury a substantive thread. */
const many = chat("many", "Notes", [
  say("user", "redirect_uri again"),
  say("assistant", "redirect_uri once more"),
  say("user", "and redirect_uri a third time")
]);
const once = chat("once", "Something else", [say("user", "redirect_uri mentioned in passing")]);
const ranked = searchConversations("redirect_uri", [once, many]).map((m) => m.chat.id);
check("the thread about it ranks first", ranked[0], "many");
check("hits are counted per message", searchConversations("redirect_uri", [many])[0].hits, 3);

check("the limit is honoured", searchConversations("redirect_uri", Array.from({ length: 50 }, (_, i) => chat(`c${i}`, "t", [say("user", "redirect_uri")])), 10).length, 10);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
