import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spokenText } from "@/lib/ui/voice-conversation";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const source = readFileSync(join(process.cwd(), "lib/ui/voice-conversation.ts"), "utf8");

/* ── An effect must not depend on a value it sets ────────────────────────────
   This one cost the entire feature, silently, and every symptom of it pointed
   somewhere else.

   The effect that speaks the reply listed `phase` in its dependency array and
   set `phase` in its body. So:

     1. it ran with the phase at `thinking`, set `cancelled = false`, switched
        the phase to `speaking`, and started fetching the audio;
     2. the phase it had just set was a dependency, so React tore the effect
        down and its cleanup set `cancelled = true`;
     3. it re-ran, saw a phase that was no longer `thinking`, and returned;
     4. the audio arrived, found `cancelled`, and was stopped in the same tick
        it became ready.

   Nothing played. And because the early return skipped `await handle.done`,
   `relisten` never ran either, so the microphone stayed shut with the screen
   reading "Answering" for ever.

   Read from outside, that is indistinguishable from a muted element, a missing
   credential, or a hung request — three things it was not. The rule is checked
   generally rather than on the one effect that broke, because the next one
   would break the same way and look just as much like something else. */

const effects = [...source.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[([^\]]*)\]\);/g)]
  .map((match) => ({ body: match[1], deps: match[2].split(",").map((entry) => entry.trim()).filter(Boolean) }));

check("the effects are found to check", effects.length > 3, true);

const selfCancelling = effects.filter(
  (effect) => /setPhaseBoth\(/.test(effect.body) && effect.deps.includes("phase")
);
check("no effect sets the phase and depends on it", selfCancelling.map((effect) => effect.deps), []);

/* The speaking effect specifically reads the phase from the ref, which is what
   lets it be driven by the reply arriving without tearing itself down. */
check("the speaking effect reads the phase from the ref",
  /if \(phaseRef\.current !== "thinking"\) return;\n    const reply = options\.reply;/.test(source), true);
/* And it is still driven by the reply, which is the thing that actually
   advances the loop. */
check("and is still driven by the reply arriving",
  effects.some((effect) => /speakBest\(/.test(effect.body) && effect.deps.includes("options.reply")), true);
/* The two guards that must survive: an answer that lands after the
   conversation ended is stopped rather than played to an empty room, and the
   microphone reopens only once the audio has genuinely finished. */
check("a reply arriving after the end is still stopped",
  /if \(cancelled \|\| !activeRef\.current\) \{ handle\.stop\(\); return; \}/.test(source), true);
check("and the microphone still waits for the audio to finish",
  /await handle\.done;/.test(source), true);
check("before listening again", /await handle\.done;[\s\S]{0,120}relisten\(\);/.test(source), true);

/* Effects that only *read* the phase are correct to depend on it — the level
   meter has to restart when listening starts, and the unanswered-turn timer has
   to re-arm. Narrowing the rule to "sets and depends" rather than "depends"
   keeps those working. */
check("effects that only read the phase may still depend on it",
  effects.some((effect) => !/setPhaseBoth\(/.test(effect.body) && effect.deps.includes("phase")), true);

/* ── What gets read aloud ────────────────────────────────────────────────── */

check("a code block becomes a sentence rather than punctuation",
  spokenText("Here it is:\n```js\nconst a = 1;\n```\nThat is all."),
  "Here it is: There is code on screen. That is all.");
check("markdown emphasis is not pronounced", spokenText("This is **important** and _urgent_."), "This is important and urgent.");
check("a link is read as its words, not its address",
  spokenText("See [the filing page](https://county.example.gov/filings) for detail."),
  "See the filing page for detail.");
check("an image is dropped rather than read as a label",
  spokenText("Before ![a chart](https://x.example/c.png) after."), "Before after.");
check("headings lose their hashes", spokenText("## Summary\nIt rose."), "Summary It rose.");
check("and whitespace collapses to something speakable",
  spokenText("One.\n\n\nTwo."), "One. Two.");
check("plain prose is untouched", spokenText("The rate is 4.2 percent."), "The rate is 4.2 percent.");
check("an empty answer stays empty", spokenText("   "), "");

/* ── Silence had four causes and they all looked the same ───────────────────
   `speakBest` could exit without a sound in four ways — no credential, over
   budget, no audio returned, playback refused — and every one of them
   presented identically from both sides: an app that listens, thinks, and says
   nothing. Hours went into telling them apart by inference from server logs.

   So the handle now says which voice spoke and why it was not the good one,
   and the screen says it while the reply is playing. The next report of "it
   does not talk" arrives as a fact. */

const speech = readFileSync(join(process.cwd(), "lib/ui/speech.ts"), "utf8");
const composer = readFileSync(join(process.cwd(), "app/components/composer-dock.tsx"), "utf8");

check("the handle names its engine", /engine: SpokenEngine;/.test(speech), true);
check("and why it was not the premium one", /why: string;/.test(speech), true);
/* Every exit gets its own words. A shared "could not speak" would put us back
   where we started. */
for (const reason of [
  "the premium voice is unconfigured, over its budget, or was too slow",
  "the speech service returned no audio",
  "this device refused to play the audio",
  "the speech service could not be reached"
]) {
  check(`"${reason.slice(0, 32)}…" is its own answer`, speech.includes(reason), true);
}
check("and no exit falls back without saying why", /return local\(\);/.test(speech), false);

check("the loop carries it out", /setVoice\(\{ engine: handle\.engine, why: handle\.why \}\)/.test(speech + readFileSync(join(process.cwd(), "lib/ui/voice-conversation.ts"), "utf8")), true);
check("and the screen says which voice is talking",
  /Answering in the premium voice/.test(composer), true);
check("naming the device voice as the device voice",
  /Answering in this device's voice — \$\{conversation\.voice\.why\}/.test(composer), true);
/* The case worth shouting about: no voice at all, which used to be
   indistinguishable from a working one. */
check("and saying plainly when there is no voice at all",
  /No voice available — \$\{conversation\.voice\.why\}/.test(composer), true);

/* ── The device voice must not be able to hang the loop ─────────────────────
   `speechSynthesis` can accept an utterance and never speak it — on an
   installed iOS app it is routinely dropped with no error and no event. The
   poll then waits for a start that never comes, `done` never resolves, and the
   conversation sits on "Answering" with the microphone shut. */

check("the device voice gives up rather than hanging",
  /guard = window\.setTimeout\(finish, 60_000\);/.test(speech), true);
check("and the guard is cleared when it does finish",
  /window\.clearTimeout\(guard\)/.test(speech), true);

/* `speechSynthesis` is a separate API from the audio element and iOS grants
   them separately, so priming one does nothing for the other — and the device
   voice is the one most likely to be doing the talking. */
check("the opening tap primes the device voice as well as the element",
  /new SpeechSynthesisUtterance\("ok"\)/.test(speech), true);
check("at zero volume, so priming it is not audible",
  /opener\.volume = 0;/.test(speech), true);

/* The isolated test for the whole speech path: one tap, no conversation loop,
   the gesture still on the stack. If it is silent there it is silent
   everywhere — so it reports its fallback too, and the two surfaces together
   say whether the problem is the loop or the speech. */

const row = readFileSync(join(process.cwd(), "app/components/message-row.tsx"), "utf8");
check("the read-aloud button reports a fallback too",
  /setSpokenBy\(handle\.engine === "premium" \? null : handle\.why\)/.test(row), true);
/* Only the fallbacks. Announcing the good voice on every tap would be noise on
   a button that is usually working. */
check("and says nothing when the good voice worked",
  /\{spokenBy \? \(/.test(row), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
