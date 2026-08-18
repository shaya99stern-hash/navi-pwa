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

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
