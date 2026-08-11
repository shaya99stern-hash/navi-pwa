import { existsSync } from "node:fs";
import { join } from "node:path";
import { read, stripComments } from "./source.mjs";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const recorder = read("lib/ui/recorder.ts").body;
const routeSource = read("app/api/voice/transcribe/route.ts");
const route = routeSource.body;
/* Comments mention the retired host to explain why it is not used, so the
   absence check reads code with comments stripped. */
const routeCode = stripComments(routeSource.source);
const composer = read("app/components/composer-dock.tsx");
const code = stripComments(composer.body);

/* ── The transcription endpoint has to be the live one ───────────────────────
   The legacy api-inference.huggingface.co host is retired and answers 404.
   Pointing at it would have made every transcription fail while looking to
   the user like a bad recording — the failure would have been blamed on the
   microphone, which is what this whole change set exists to fix. */

check("the router host is used", route.includes("router.huggingface.co/hf-inference/models"), true);
check("the retired host is not", routeCode.includes("api-inference.huggingface.co"), false);
/* Model ids contain a slash, so each segment is encoded separately or the
   path breaks. This matches how image and audio generation build theirs. */
check("the model id is encoded per segment", route.includes('split("/").map(encodeURIComponent).join("/")'), true);
check("generation uses the same host", read("lib/ai/audio-generation.ts").body.includes("router.huggingface.co/hf-inference/models"), true);

/* ── The route is honest about why it failed ─────────────────────────────── */

check("a missing token is named, not guessed at", route.includes("Add HF_TOKEN in Vercel"), true);
/* A cold model on the free tier succeeds seconds later. Reporting it as a
   failure sends the user away from something that was about to work. */
check("a warming model is distinguished from a failure", route.includes("warming up"), true);
check("oversized audio is refused with a reason", route.includes("under a minute"), true);
check("the request is bounded", route.includes("AbortController"), true);

/* The route's own limit has to sit under the platform's, or it is unreachable:
   Vercel refuses a body over ~4.5 MB (4 MB on edge) before the handler runs,
   so a larger MAX_AUDIO_BYTES means the 413 above never renders and the
   failure looks like a hang. */
const maxAudioBytes = Number(/MAX_AUDIO_BYTES = ([\d_]+)/.exec(route)?.[1].replace(/_/g, ""));
check("the route's size cap is under the platform body limit", maxAudioBytes > 0 && maxAudioBytes < 4_000_000, true);

/* ── The recorder releases the microphone ────────────────────────────────────
   A live MediaStream keeps the OS recording indicator lit after recording
   ends, which looks exactly like the app listening when it is not. */

check("tracks are stopped", recorder.includes("track.stop()"), true);
check("the audio context is closed", recorder.includes("audio?.close()"), true);
check("the analyser loop is cancelled", recorder.includes("cancelAnimationFrame"), true);
check("teardown runs on cancel as well as stop", (recorder.match(/teardown\(\)/g) ?? []).length >= 2, true);

/* Safari does not support webm; without a fallback the recorder throws on
   construction and the button appears broken on exactly one platform. */
check("a container fallback exists for Safari", recorder.includes("audio/mp4"), true);
check("support is checked before use", recorder.includes("export function recordingSupported"), true);
check("a refused permission is distinguished from no microphone", recorder.includes("NotAllowedError"), true);
/* A stray tap produces a tiny blob the API would reject; silence is not an
   error worth showing. */
check("silent recordings are not sent", recorder.includes("blob.size < 1_200"), true);

/* ── The level meter actually runs on iOS ────────────────────────────────────
   An AudioContext constructed without user activation is born suspended and
   never produces samples, so the analyser reads a flat 128, the level stays 0,
   and the composer draws a motionless row of dots for the whole recording.
   getUserMedia is what spends the activation, so the context has to be built
   before it is awaited — ordering is the entire fix, and a later refactor that
   moves the construction below the await silently restores the dead meter. */
const contextAt = recorder.indexOf("new Ctor()");
const getUserMediaAt = recorder.indexOf("await navigator.mediaDevices.getUserMedia");
check("the audio context is created before getUserMedia is awaited",
  contextAt > 0 && getUserMediaAt > 0 && contextAt < getUserMediaAt, true);
check("a suspended context is resumed anyway", recorder.includes("audio.resume()"), true);

/* ── Stopping an already-stopped recorder must not hang ──────────────────────
   `onstop` only fires for a recorder that was running. iOS stops one on its
   own whenever the audio session is interrupted — a call, Siri, another app
   taking the microphone — and awaiting a promise nothing will resolve left the
   composer at "Transcribing…" forever, with no error and no way back. */
check("stop() only waits when the recorder is running",
  recorder.includes('if (recorder.state !== "inactive") {\n        await new Promise'), true);

/* ── The recording is bounded on the device that makes it ────────────────── */
check("recording has a duration cap", recorder.includes("MAX_RECORDING_SECONDS = 60"), true);
check("the cap enforces itself rather than trusting the UI", recorder.includes("onAutoStop?.()"), true);
check("an oversized body is refused before it is sent", recorder.includes("blob.size > MAX_UPLOAD_BYTES"), true);
/* The client's ceiling must also sit under the platform's body limit. */
const maxUploadBytes = Number(/MAX_UPLOAD_BYTES = ([\d_]+)/.exec(recorder)?.[1].replace(/_/g, ""));
check("the client upload cap is under the platform body limit",
  maxUploadBytes > 0 && maxUploadBytes < 4_000_000, true);

/* An installed iOS app has no per-site permission pane, so the generic
   "allow it in your browser settings" advice is wrong there. */
check("a refused permission reads differently in an installed app", recorder.includes("isStandalone()"), true);

/* ── The composer surrenders the row while recording ─────────────────────────
   The bar and the leftover flex spacer both claimed flex-1, so the waveform
   rendered at half width beside controls nobody can reach one-handed. */

check("the spacer yields while recording", code.includes("{listening ? null : <span className=\"min-w-0 flex-1\" />}"), true);
check("the plus button yields", /\{listening \? null : \(\s*<button[\s\S]{0,200}Add photos/.test(code), true);
check("the research switch yields", /\{listening \? null : \(\s*<button[\s\S]{0,200}role="switch"/.test(code), true);
check("the waveform bar claims the row", code.includes("flex min-w-0 flex-1 items-center gap-2 rounded-full"), true);

/* ── Dead modules stay dead ──────────────────────────────────────────────────
   Both created a Supabase client at module load with non-null assertions and
   no per-user scoping. Nothing imported them, but a model reading the
   repository would have found them and copied the pattern. */

check("the unscoped client is gone", existsSync(join(process.cwd(), "lib/supabase.ts")), false);
check("the unscoped tools are gone", existsSync(join(process.cwd(), "lib/ai/supabase-tools.ts")), false);

/* ── The crash course teaches, rather than instructing ───────────────────── */

const craft = read("lib/ai/code-craft.ts").body;
check("the course is substantial", craft.split(/\s+/).filter(Boolean).length > 1200, true);
check("it shows wrong and right side by side", craft.includes("// Wrong") && craft.includes("// Right"), true);
check("it covers stale closures", craft.includes("State is a snapshot"), true);
check("it covers effect cleanup", craft.includes("must unsubscribe"), true);
check("it covers discriminated unions", craft.includes("Model states as unions"), true);
check("it covers the runtime split", craft.includes("Buffer") && craft.includes("Edge: fast to start"), true);
check("it covers the pointer-event trap", craft.includes("a tap starts and immediately ends it"), true);
check("it lists the bugs that actually shipped", craft.includes("shipped here"), true);
check("it is gated on the commit tool", read("app/api/chat/route.ts").body.includes('needsCodeCraft(toolNames.includes("commit_own_source"))'), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
