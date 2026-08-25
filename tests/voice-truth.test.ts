import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ttsConfigured, ttsMissing } from "@/lib/ai/voice/tts";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const root = process.cwd();
const readSource = (relative: string) => readFileSync(join(root, relative), "utf8").replace(/\r\n?/g, "\n");

/* ── The conversation this exists to prevent ─────────────────────────────────
   Asked "isn't it supposed to be using the Eleven Labs voice?", the app said:

     "Eleven Labs is configured and has its full monthly quota available. The
      voice you're hearing is still the default system voice, though — NaviOS
      uses Eleven Labs only for reading aloud long passages or documents, not
      for the chat voice itself."

   Every clause of the second sentence is invented. There is no such split.
   Asked to switch it over, the app then named `ELEVEN_LABS_VOICE_ID` and
   `ENABLE_ELEVEN_LABS_TTS` — neither of which this codebase reads, so following
   that advice would change nothing at all.

   And an inch below that answer, the app's own status line read: "Answering in
   this device's voice — this device refused to play the audio". The app knew.
   The model could not see it, so it produced something that fit. */

const KEYS = ["ELEVENLABS_API_KEY", "NAVI_TTS_VOICE_ID"];
const saved = new Map(KEYS.map((name) => [name, process.env[name]]));
const restore = () => saved.forEach((value, name) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
});
KEYS.forEach((name) => { delete process.env[name]; });

/* ── "Configured" has to mean synthesis can happen ──────────────────────────
   `ttsConfigured` checked the key alone while `synthesizeSpeech` also requires
   a voice id — so a deployment holding one and not the other reported a
   working premium voice through the tool the prompt calls authoritative, while
   every utterance fell back to the device. */

check("neither set is not configured", ttsConfigured(), false);
process.env.ELEVENLABS_API_KEY = "sk-test";
check("a key on its own is still not configured", ttsConfigured(), false);
check("and the missing half is named", ttsMissing(), ["NAVI_TTS_VOICE_ID"]);
process.env.NAVI_TTS_VOICE_ID = "voice-1";
check("both together are", ttsConfigured(), true);
check("with nothing left missing", ttsMissing(), []);
delete process.env.ELEVENLABS_API_KEY;
check("a voice id without a key is not configured either", ttsConfigured(), false);
check("and names the other half", ttsMissing(), ["ELEVENLABS_API_KEY"]);
restore();

/* ── The three states, kept apart ──────────────────────────────────────────── */

const environment = readSource("lib/ai/environment-tools.ts");

/* Not configured at all is a working deployment. Calling that a fault sends
   someone to fix something that is not broken — the assertion this replaced
   was right about that and is kept. */
check("nothing configured is not called a fault",
  /which is a working configuration and not a fault/.test(environment), true);
/* Half configured is a different thing entirely: somebody meant to turn it on
   and it has never once run. */
check("half configured is called a fault",
  /half configured, and this one IS a fault/.test(environment), true);
check("and one authority decides which state it is in",
  /if \(ttsConfigured\(\)\) \{/.test(environment), true);

/* A full allowance after weeks of speaking is not health — it is proof that
   nothing has ever succeeded. The app reported it as good news. */
check("an untouched allowance is read as evidence rather than health",
  /No characters have been spent at all/.test(environment), true);

/* ── The variables it invented ─────────────────────────────────────────────── */

const facts = readSource("lib/ai/self-description.ts");
check("the voice id variable is named where the model can read it",
  /NAVI_TTS_VOICE_ID/.test(facts), true);
check("along with the key it needs beside it",
  /`ELEVENLABS_API_KEY` \*\*and\*\* `NAVI_TTS_VOICE_ID`, both required/.test(facts), true);
/* It offered to flip a switch that does not exist. Saying outright that there
   is none is what stops the offer being made again. */
check("and it says there is no on/off switch to invent",
  /There is no switch that turns the premium voice on or off/.test(facts), true);
/* The property is that nothing *reads* them — not that the names never appear,
   since the comment explaining why they are wrong has to be able to say them.
   An assertion against the prose would have failed on its own documentation. */
const reads = (source: string) => /process\.env\.(ENABLE_ELEVEN_LABS_TTS|ELEVEN_LABS_VOICE_ID)/.test(source);
check("nothing in the app reads the invented variables",
  [facts, environment, readSource("lib/ai/voice/tts.ts")].some(reads), false);

/* The fabricated architecture, denied at the source. */
check("the premium voice is stated to speak every reply",
  /speaks \*every\* spoken reply, not a subset/.test(facts), true);
check("with no second voice to switch between",
  /Never describe them as different features or offer to switch between them/.test(facts), true);

/* ── What only the device knows ────────────────────────────────────────────── */

const shell = readSource("app/components/app-shell.tsx");
const route = readSource("app/api/chat/route.ts");

check("the device reports which voice actually spoke",
  /spokenBy: lastVoiceRef\.current \?\? undefined/.test(shell), true);
check("kept in step with the conversation that owns it",
  /lastVoiceRef\.current = conversation\.voice;/.test(shell), true);
/* It reaches a prompt, so it is held to a known vocabulary rather than passed
   through as typed — the same rule every other device-supplied field follows. */
check("the server narrows it to the engines this app produces",
  /if \(engine !== "premium" && engine !== "device" && engine !== "silent"\) return undefined;/.test(route), true);
check("and the reason is length-bounded",
  /why: typeof why === "string" \? why\.slice\(0, 200\) : ""/.test(route), true);
/* Only when there is something to explain: a premium turn needs no commentary,
   and a line sent every turn is a line the model learns to ignore. */
check("the prompt carries it only when the premium voice did not speak",
  /spokenBy && spokenBy\.engine !== "premium"/.test(route), true);
check("telling the model to say the real reason",
  /that is the reason — say it plainly/.test(route), true);
check("and forbidding the distinction it invented",
  /Do not invent a distinction between a "chat voice" and a reading-aloud voice/.test(route), true);
check("and forbidding a guessed variable name",
  /never guess one/.test(route), true);

/* ── The refusal that could not describe itself ──────────────────────────────
   Four different problems all reported "this device refused to play the audio":
   a gesture that was not held, an unplayable format, a load that interrupted
   the request, and everything else. */

const speech = readSource("lib/ui/speech.ts");
check("a permission refusal says so", /would not play audio without a fresh tap/.test(speech), true);
check("an unplayable format says so", /cannot play the audio format the voice service returned/.test(speech), true);
check("an unknown failure still carries its name",
  /this device refused to play the audio\$\{name \? ` \(\$\{name\}\)` : ""\}/.test(speech), true);
/* An abort is not a refusal: assigning `src` cancels a load already in flight
   and `play()` rejects, though the device was willing. */
check("an interrupted load is retried once rather than reported as a refusal",
  /name === "AbortError" && await ready\(audio\)/.test(speech), true);
check("but a genuine refusal is not retried into failing twice",
  /Retried only for this name: retrying a genuine refusal just\n {9}fails twice/.test(speech), true);
/* Bounded, because this sits between a person finishing a sentence and hearing
   an answer. */
check("and the wait for readiness is bounded",
  /window\.setTimeout\(\(\) => settle\(false\), 1_500\)/.test(speech), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
