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

/* Both credentials are named now that transcription ladders across providers.
   Naming only Hugging Face would send someone to configure the slower host —
   and the one whose whisper models this deployment's own diagnostic reported
   as not served to the account. */
check("a missing token is named, not guessed at", route.includes("Add GROQ_API_KEY or HF_TOKEN in Vercel"), true);
check("and the faster host is named first", route.indexOf("GROQ_API_KEY") < route.indexOf("HF_TOKEN"), true);
/* A cold model on the free tier succeeds seconds later. Reporting it as a
   failure sends the user away from something that was about to work. */
check("a warming model is distinguished from a failure", route.includes("warming up"), true);
check("oversized audio is refused with a reason", route.includes("too long to send at once"), true);
check("the request is bounded", route.includes("AbortController"), true);
/* A body is now one segment of speech rather than a whole recording, so a
   request still running after twenty seconds is stuck rather than slow — and
   failing fast lets the retry happen while the person is still talking. */
check("and bounded to a segment's worth of patience, not a recording's",
  Number(/TIMEOUT_MS = ([\d_]+)/.exec(route)?.[1].replace(/_/g, "")) <= 20_000, true);

/* The route's own limit has to sit under the platform's, or it is unreachable:
   Vercel refuses a body over ~4.5 MB (4 MB on edge) before the handler runs,
   so a larger MAX_AUDIO_BYTES means the 413 above never renders and the
   failure looks like a hang. */
const maxAudioBytes = Number(/MAX_AUDIO_BYTES = ([\d_]+)/.exec(route)?.[1].replace(/_/g, ""));
check("the route's size cap is under the platform body limit", maxAudioBytes > 0 && maxAudioBytes < 4_000_000, true);

/* ── No container is negotiated any more ─────────────────────────────────────
   Most of the route above exists because MediaRecorder hands back whatever
   container the browser prefers, and "that audio format was rejected" was the
   most common way dictation failed. The client writes its own WAV now, so
   there is nothing to guess at — and WAV has to be the format the route
   reaches for first, or the guessing comes back in through the extension. */

check("WAV is what the route expects", route.includes('type.includes("wav") ? "wav"'), true);
check("and what it assumes when nothing is said", route.includes('"audio/wav"'), true);
check("the recorder writes its own header rather than asking for one",
  read("lib/ui/audio/pcm.ts").body.includes("export function encodeWav"), true);
check("at the rate the transcriber works in", read("lib/ui/audio/pcm.ts").body.includes("TARGET_SAMPLE_RATE = 16_000"), true);
/* A slice of a WebM or MP4 stream has no header and cannot be decoded, which
   is the specific technical reason the old version had to wait for the end of
   the recording before it could send anything. */
check("no MediaRecorder container is produced", stripComments(read("lib/ui/recorder.ts").source).includes("MediaRecorder"), false);

/* ── The recorder releases the microphone ────────────────────────────────────
   A live MediaStream keeps the OS recording indicator lit after recording
   ends, which looks exactly like the app listening when it is not. */

check("tracks are stopped", recorder.includes("item.stop()"), true);
check("the audio context is closed", recorder.includes("audio.close()"), true);
check("the capture node is retired, not merely disconnected", recorder.includes('postMessage("stop")'), true);
check("teardown runs on cancel as well as stop",
  (recorder.match(/releaseMicrophone\(\)/g) ?? []).length >= 3, true);
check("support is checked before use", recorder.includes("export function recordingSupported"), true);
check("a refused permission is distinguished from no microphone", recorder.includes("NotAllowedError"), true);
/* Silence is not an error worth showing, and it is now told apart from a
   failure by whether any segment was ever produced rather than by a byte
   count on a blob. */
check("silence resolves as silence rather than as a failure",
  /if \(!segments\.length\) return "";/.test(recorder), true);

/* ── Capture actually runs on iOS ────────────────────────────────────────────
   An AudioContext constructed without user activation is born suspended and
   never produces a sample, so the waveform sits flat and every recording is
   silence. getUserMedia is what spends the activation, so the context has to
   be built before it is awaited — ordering is the entire fix, and a later
   refactor that moves the construction below the await restores the bug with
   no visible symptom other than empty transcripts. */
const contextAt = recorder.indexOf("new Ctor()");
const getUserMediaAt = recorder.indexOf("await navigator.mediaDevices.getUserMedia");
check("the audio context is created before getUserMedia is awaited",
  contextAt > 0 && getUserMediaAt > 0 && contextAt < getUserMediaAt, true);
check("a suspended context is resumed anyway", recorder.includes("audio.resume()"), true);
/* iOS suspends the context on an interruption or a trip to the background and
   does not always resume it, which silently turns the rest of the recording
   into a flat line. */
check("and again whenever it is suspended later", recorder.includes('audio.addEventListener("statechange"'), true);
check("including on return from the background", recorder.includes('"visibilitychange"'), true);
/* A node with no route to the destination is never pulled, so `process` is
   never called and the recording is empty — but routing it at full gain puts
   the microphone through the speaker. */
check("the capture node has a silent path to the destination", /sink\.gain\.value = 0/.test(recorder), true);

/* ── An interrupted recording ends rather than hangs ─────────────────────────
   A call, Siri, another app, or an unplugged headset ends the track. The old
   version awaited an `onstop` that would never fire and left the composer at
   "Transcribing…" for ever, with no error and no way back. Everything up to
   the interruption has already been transcribed, so this finishes rather than
   discards. */
check("losing the microphone is an ending, not a hang", /onAutoStop\?\.\("interrupted"\)/.test(recorder), true);
check("and it is reported", recorder.includes("was taken by another app"), true);

/* ── The recording is bounded on the device that makes it ────────────────────
   Sixty seconds was a real limit that cut people off mid-thought, and it
   existed only because a whole recording had to fit in one request. Nothing is
   held whole now, so what remains is a safety stop for a microphone left open
   by accident. */
check("recording has a safety ceiling", /MAX_RECORDING_SECONDS = 900/.test(recorder), true);
check("but not a felt one", /MAX_RECORDING_SECONDS = 60;/.test(recorder), false);
check("the ceiling enforces itself rather than trusting the UI",
  /maxRecordingMs: MAX_RECORDING_SECONDS \* 1_000/.test(recorder), true);
check("an oversized body is refused before it is sent", recorder.includes("audioBytes.byteLength > MAX_UPLOAD_BYTES"), true);

/* ── Words arrive while they are still being spoken ──────────────────────────
   The whole reason for the rewrite. Segments upload as they close, so the
   wait after Stop is the last sentence rather than the whole recording. */
check("segments upload while the microphone is still open", /function enqueue\(/.test(recorder), true);
check("more than one at a time, so a fast talker is not queued behind himself",
  /MAX_CONCURRENT_UPLOADS = 2/.test(recorder), true);
/* Segments settle out of order — a short one queued behind a long one comes
   back first — but text may only be shown in the order it was spoken, and may
   only ever grow, or it rewrites itself under the reader. */
check("the live transcript is the settled prefix, so it only ever grows",
  /if \(onlySettledPrefix\) break;/.test(recorder), true);
check("and is only emitted when it changed", /if \(next === emitted\) return;/.test(recorder), true);
/* Losing one sentence to a rate limit must not throw away the four before
   it. */
check("a partial failure keeps the part that worked", /const text = assemble\(false\);\n {6}if \(text\) return text;/.test(recorder), true);
/* A segment that never started has no request to abort, so nothing would move
   it out of `pending` and a `stop()` racing a `cancel()` would wait for ever. */
check("cancelling settles segments that never started", /segment\.status = "failed";\n {8}segment\.failure = "Cancelled\.";/.test(recorder), true);
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

check("the spacer yields while recording", code.includes("{listening || talking ? null : <span className=\"min-w-0 flex-1\" />}"), true);
check("the plus button yields", /\{listening \|\| talking \? null : \(\s*<button[\s\S]{0,200}Add photos/.test(code), true);
check("the research switch yields", /\{listening \|\| talking \? null : \(\s*<button[\s\S]{0,200}role="switch"/.test(code), true);
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
