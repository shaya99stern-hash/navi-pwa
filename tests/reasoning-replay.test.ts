import { readFileSync } from "node:fs";
import { withoutReasoning } from "@/lib/ai/replay";
import type { ModelMessage } from "ai";
import { join } from "node:path";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const root = process.cwd();
const readSource = (relative: string) => readFileSync(join(root, relative), "utf8").replace(/\r\n?/g, "\n");
const route = readSource("app/api/chat/route.ts");
/* The filter lives in its own module: the route imports `server-only`, so a
   test cannot load it, and a pure transformation had no business living in a
   file that cannot be exercised. */
const replay = readSource("lib/ai/replay.ts");

/* ── One reasoning reply must not break the rest of the conversation ─────────
   Production, repeatedly, on turn two:

     AI_APICallError: 'messages.2' : for 'role:assistant' the following must be
     satisfied[('messages.2' : property 'reasoning_content' is unsupported)]

   A reasoning trace from turn one is replayed on turn two, and a provider that
   does not accept the field rejects the whole request. Cross-provider fallback
   makes it near-certain rather than unlikely: the entire point of the fallback
   is that turn two may land somewhere turn one did not.

   In a typed conversation this is a red card the person can retry around. In a
   spoken one it is fatal, because a spoken conversation *is* turn two onwards —
   it listens, sends, fails, and sits there with the microphone shut. */

/* The filter that already existed, at the UI-message layer. Kept: it is the
   cheapest place to drop them, and it stops them being carried through every
   later transformation. */
check("reasoning parts are dropped from the replayed ui messages",
  /\.filter\(\(part\) => part\.type !== "reasoning"\)/.test(route), true);

/* And the one that was missing. `@ai-sdk/openai-compatible` builds an assistant
   message by walking its content parts, accumulating every `reasoning` part
   into one string, and emitting `reasoning_content` when that string is
   non-empty — so the guard belongs where the value is read, after every
   conversion, immediately before dispatch. A guard placed there cannot be
   bypassed by a transformation nobody has written yet. */
check("and again from the model messages, which is where the field is read",
  /export function withoutReasoning\(messages: ModelMessage\[\]\): ModelMessage\[\]/.test(replay), true);
check("covering both reasoning part types, not just the obvious one",
  /part\.type !== "reasoning" && part\.type !== "reasoning-file"/.test(replay), true);

/* The conversion is the single chokepoint, so the guard wraps it rather than
   sitting somewhere a later call site could miss. */
check("every converted history passes through it",
  /const modelMessages = withoutReasoning\(await convertToModelMessages\(/.test(route), true);
/* If a second conversion is ever added, this fails and asks for the same
   treatment rather than silently reopening the hole. */
check("and there is still only one conversion to guard",
  (route.match(/await convertToModelMessages\(/g) ?? []).length, 1);

/* An assistant turn that was nothing but reasoning has nothing left to send.
   An empty assistant message is its own rejection on several providers, so it
   is dropped rather than emptied — trading one provider error for another is
   not a fix. */
check("a turn left with no content is dropped rather than sent empty",
  /return content\.length \? \[\{ \.\.\.message, content \}\] : \[\];/.test(replay), true);
/* Untouched messages are returned as-is: rebuilding every message would be a
   new object per turn for no reason, and would quietly drop any field the
   filter did not think to copy. */
check("messages with no reasoning are passed through unchanged",
  /if \(content\.length === message\.content\.length\) return \[message\];/.test(replay), true);
/* User and tool messages are not assistant messages and carry no reasoning;
   walking them would be work that can only introduce a bug. */
check("only assistant messages are examined",
  /if \(message\.role !== "assistant" \|\| !Array\.isArray\(message\.content\)\) return \[message\];/.test(replay), true);

/* ── The filter itself, exercised rather than read ──────────────────────────
   Everything above reads source. These call it, because the property that
   matters is what comes out the other side. */

const assistant = (content: unknown[]): ModelMessage =>
  ({ role: "assistant", content } as unknown as ModelMessage);
const user = (text: string): ModelMessage =>
  ({ role: "user", content: [{ type: "text", text }] } as unknown as ModelMessage);

/* The exact history that failed in production: a user turn, an assistant turn
   carrying a reasoning trace, another user turn. */
const replayed = withoutReasoning([
  user("hey how are you doing"),
  assistant([
    { type: "reasoning", text: "The user is greeting me. Keep it short." },
    { type: "text", text: "I'm doing well, thanks." }
  ]),
  user("aren't you supposed to answer with your voice")
]);

check("the conversation survives", replayed.length, 3);
const kept = replayed[1].content as Array<{ type: string; text?: string }>;
check("the answer is still there", kept.map((part) => part.text), ["I'm doing well, thanks."]);
check("and the trace that broke the provider is gone",
  kept.some((part) => part.type === "reasoning"), false);
/* The failure was a property on the outgoing message, emitted from any
   surviving reasoning part. One is enough. */
check("even when several traces are interleaved",
  (withoutReasoning([assistant([
    { type: "reasoning", text: "one" },
    { type: "text", text: "answer" },
    { type: "reasoning", text: "two" }
  ])])[0].content as Array<{ type: string }>).filter((part) => part.type === "reasoning").length, 0);
/* `reasoning-file` is a second reasoning part type with its own predicate in
   the SDK, and it reaches the same accumulator. */
check("and covering reasoning files too",
  (withoutReasoning([assistant([
    { type: "reasoning-file", data: "x", mediaType: "text/plain" },
    { type: "text", text: "answer" }
  ])])[0].content as Array<{ type: string }>).map((part) => part.type), ["text"]);

/* An assistant turn that was only reasoning has nothing left to say. Sending it
   empty trades one provider rejection for another. */
check("a turn that was only reasoning is dropped, not emptied",
  withoutReasoning([user("q"), assistant([{ type: "reasoning", text: "thinking" }]), user("q2")]).length, 2);

/* Nothing else is touched. A filter that quietly rewrites tool calls or user
   turns would be a worse bug than the one it fixes. */
const untouched: ModelMessage[] = [
  user("plain question"),
  assistant([{ type: "text", text: "plain answer" }, { type: "tool-call", toolCallId: "1", toolName: "x", input: {} }])
];
check("histories with no reasoning come back identical", withoutReasoning(untouched), untouched);
check("and by identity, not just by value", withoutReasoning(untouched)[1] === untouched[1], true);
/* String content is legal on a ModelMessage and is not an array to walk. */
check("string content is left alone",
  withoutReasoning([{ role: "assistant", content: "plain" } as unknown as ModelMessage]).length, 1);
check("an empty history is not an error", withoutReasoning([]), []);
/* User and tool messages never carry reasoning, and walking them could only
   introduce a bug. */
check("a user turn is never rewritten",
  withoutReasoning([user("keep me")])[0], user("keep me"));

/* ── The two ways a spoken reply came out silent ─────────────────────────────
   Both in the priming step, both invisible, both presenting identically: the
   app listens, thinks, and says nothing.

   `primeSpeech` spends the opening tap on the shared audio element so later
   replies are allowed to play. It muted the element and unmuted it in a
   `.finally`, and paused it in a `.then`. Neither settles before the first
   reply on a fast turn — so the reply either played at zero volume, or was
   paused by the primer landing on top of it. A paused element fires no `ended`
   event either, so the loop's `done` never resolved and the microphone never
   reopened. */

const speech = readSource("lib/ui/speech.ts");

check("the priming playback is held rather than fired and forgotten",
  /let priming: Promise<void> \| null = null;/.test(speech), true);
check("and the first real utterance waits for it",
  /if \(priming\) \{ await priming; priming = null; \}/.test(speech), true);
/* Waiting is the fix; this is the guarantee. Whatever happened before — a
   refused play, a primer that never settled — an utterance is audible. */
check("which is then made audible regardless of what the primer left behind",
  /audio\.muted = false;\n    audio\.src = url;/.test(speech), true);
/* One place unmutes, so there is exactly one moment the element becomes
   usable and exactly one thing to wait for. */
check("the primer unmutes in exactly one place",
  (speech.match(/audio\.muted = false;/g) ?? []).length, 2);

/* ── A turn that failed must not read as a turn still working ──────────────── */

const loop = readSource("lib/ui/voice-conversation.ts");
const shell = readSource("app/components/app-shell.tsx");

check("the loop is told when a request failed", /failedAt\?: number \| null;/.test(loop), true);
check("and reopens the microphone instead of waiting for a reply that is not coming",
  /setError\("That turn did not get through\. Listening again\."\);\n    relisten\(\);/.test(loop), true);
/* A timestamp rather than a flag, so two failures in a row are two events. */
check("failures are timestamped so consecutive ones are distinguishable",
  /setTurnFailedAt\(Date\.now\(\)\)/.test(shell), true);
check("reported both from the stream error and from a send that never started",
  (shell.match(/setTurnFailedAt\(Date\.now\(\)\)/g) ?? []).length, 2);
/* Re-firing on the phase change would apply the last turn's failure to the
   next turn, ending it before it began. */
check("a failure is acted on once, not again on the next phase change",
  /failedAt === handledFailureRef\.current/.test(loop), true);
check("and the phase is read from a ref, so it need not be a dependency",
  /if \(phaseRef\.current !== "thinking"\) return;/.test(loop), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
