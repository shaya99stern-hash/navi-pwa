"use client";

/**
 * Dictation: capture, endpoint, and transcribe while the person is still
 * talking.
 *
 * There have been three versions of this. The first asked the browser to do
 * speech recognition, which in an installed iOS PWA is frequently absent with
 * no error and no event, plays a system chime the page cannot suppress, and
 * ends sessions in ways nothing can observe. The second recorded a
 * MediaRecorder blob and uploaded it after Stop, which worked but felt like
 * neither of the things people compare it to: a hard sixty-second ceiling, a
 * dead wait after every recording the length of the recording itself, and a
 * container negotiation whose failure mode — "that audio format was rejected"
 * — reached the user as a broken microphone.
 *
 * This is the third, and the difference is that it holds samples rather than a
 * file. Once you have samples you can ask questions of them, and every feature
 * that made the previous version feel slow turns out to be a question:
 *
 *  - *Is this speech?* An adaptive detector says so, which is what allows a
 *    segment to be closed at a pause without anyone pressing anything.
 *  - *May I cut here?* Only at a pause, or failing that at the quietest
 *    moment in the last few seconds — so a segment is never severed
 *    mid-syllable.
 *  - *Can this piece stand alone?* Every segment is written as its own WAV
 *    with its own header, so it can be uploaded on its own. A slice of a WebM
 *    or MP4 stream cannot, which is the specific technical reason the previous
 *    version had to wait for the end.
 *
 * The consequence is that transcription overlaps speech. Segments upload as
 * they close, the transcript grows while you are still mid-thought, and Stop
 * usually only has to wait for the last few seconds rather than for all of it.
 * There is no ceiling on how long you can talk, because nothing is ever
 * holding more than one segment.
 *
 * No model runs on this side of the wire. The detection, the segmentation, the
 * resampling and the assembly are arithmetic; the only thing that infers
 * anything is the transcriber at the far end, and it is never asked to
 * improve, rewrite, or interpret what was said.
 */

import {
  TARGET_SAMPLE_RATE,
  concatFloat32,
  createHighPass,
  createResampler,
  dbfs,
  encodeWav,
  rms
} from "./audio/pcm";
import {
  HOP_MS,
  createSegmenter,
  mergeSplitTranscripts,
  type SegmentBoundary,
  type TurnEnd
} from "./audio/vad";

export type RecorderLevels = (level: number) => void;

/** Why a recording ended without the user asking it to. */
export type AutoStopReason = TurnEnd | "interrupted";

export type RecordingSession = {
  /**
   * Stop capturing, finish transcribing, and resolve with the full text.
   *
   * Resolves with an empty string when nothing was said. Rejects only when
   * every segment failed — a partial failure returns the part that worked,
   * because most of a sentence is worth more than an error message.
   */
  stop: () => Promise<string>;
  /** Abandon the recording and abort anything in flight. */
  cancel: () => void;
  /** The transcript as it stands, for a caller that missed a callback. */
  transcript: () => string;
};

export type RecordingOptions = {
  /** Live input level, 0 to 1, roughly once every 20ms. */
  onLevel?: RecorderLevels;
  /** Something went wrong that the person should be told about. */
  onError?: (message: string) => void;
  /** The recording ended on its own. */
  onAutoStop?: (reason: AutoStopReason) => void;
  /**
   * The transcript so far, each time it grows.
   *
   * This is the whole point of the rewrite: it fires while the microphone is
   * still open. It only ever grows and never rewrites what it has already
   * emitted, so a caller can render it directly without the text jumping
   * around as later segments land.
   */
  onTranscript?: (text: string) => void;
  /** Whether the detector currently believes someone is talking. */
  onSpeaking?: (speaking: boolean) => void;
  /** Dictation language, or "auto" to let the transcriber decide. */
  language?: string;
  /**
   * End the turn on a pause rather than on a button.
   *
   * For hands-free conversation. Off for the composer, where a pause to think
   * must not send the message.
   */
  handsFree?: boolean;
};

/**
 * The ceiling on a single recording, in seconds.
 *
 * This is a safety stop, not a limit anyone should meet. The previous sixty
 * seconds was a real limit — it existed because the whole recording had to fit
 * in one request — and it cut people off mid-thought. Nothing is ever held
 * whole now, so the only thing left to guard against is a microphone left open
 * by accident, which is what fifteen minutes is for.
 */
export const MAX_RECORDING_SECONDS = 900;

/**
 * The largest segment that may be uploaded.
 *
 * Sits under the platform's own request body ceiling — Vercel refuses roughly
 * 4.5 MB, and 4 MB on the edge runtime, before any handler runs, so a larger
 * number here would produce an opaque failure rather than a message. At 16 kHz
 * 16-bit mono this is nearly two minutes of audio, and segments are capped at
 * fourteen seconds, so it is a guard rather than a constraint.
 */
export const MAX_UPLOAD_BYTES = 3_500_000;

/** Samples in one analysis hop at the transcriber's rate. */
const HOP_SAMPLES = Math.round((TARGET_SAMPLE_RATE * HOP_MS) / 1000);

/** Frame size asked of the capture node, in samples at the device's rate. */
const CAPTURE_FRAME = 1024;

/**
 * How many segments may be uploading at once.
 *
 * More than one, because a pause long enough to close a segment is often
 * followed immediately by more speech, and a strictly serial queue would fall
 * behind a fast talker and give back the wait this exists to remove. Not many
 * more than one, because free inference tiers rate-limit, and a burst that
 * trips a limit is slower than the queue it was trying to beat.
 */
const MAX_CONCURRENT_UPLOADS = 2;

/** A cold model answers on the second try; anything else does not. */
const RETRY_DELAY_MS = 800;

/**
 * Level range the waveform is drawn across, in dBFS.
 *
 * Amplitude is mapped through decibels rather than used directly because
 * loudness is logarithmic: on a linear scale ordinary speech sits in the
 * bottom tenth of the range and the bar chart barely moves. −60 is a quiet
 * room and −6 is as loud as anyone speaks into a phone.
 */
const LEVEL_FLOOR_DB = -60;
const LEVEL_CEILING_DB = -6;

export function recordingSupported(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const hasContext = typeof window.AudioContext === "function"
    || typeof (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext === "function";
  return typeof navigator.mediaDevices?.getUserMedia === "function" && hasContext;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export async function microphonePermission(): Promise<PermissionState | null> {
  try {
    const query = navigator.permissions?.query;
    if (typeof query !== "function") return null;
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state;
  } catch {
    return null;
  }
}

function audioContextConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    ?? null;
}

export function describeRecordingSupport(): Record<string, unknown> {
  const Ctor = audioContextConstructor();
  return {
    standalone: isStandalone(),
    recordingSupported: recordingSupported(),
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    /* The preferred capture path. Without it the recorder falls back to a
       ScriptProcessorNode, which is deprecated, runs on the main thread and
       drops frames under load — same audio, worse under pressure, and worth
       being able to see in a report.

       Tested with `in` rather than by reading the property: `audioWorklet` is
       an accessor, and invoking its getter on the prototype rather than on an
       instance throws outright in Chrome. */
    audioWorklet: typeof AudioWorkletNode === "function" && Ctor !== null && "audioWorklet" in Ctor.prototype,
    scriptProcessorFallback: typeof Ctor?.prototype.createScriptProcessor === "function",
    /* No container is negotiated any more: the recorder writes its own WAV, so
       there is no list of formats to try and nothing to be rejected. */
    uploadFormat: `audio/wav ${TARGET_SAMPLE_RATE} Hz 16-bit mono`
  };
}

/** Amplitude to the 0–1 the waveform is drawn from. */
function displayLevel(amplitude: number): number {
  const db = dbfs(amplitude);
  return Math.max(0, Math.min(1, (db - LEVEL_FLOOR_DB) / (LEVEL_CEILING_DB - LEVEL_FLOOR_DB)));
}

function joinTranscripts(left: string, right: string, boundary: SegmentBoundary): string {
  if (!left) return right.trim();
  if (!right.trim()) return left;
  /* Only a forced split can duplicate words, because only a forced split
     records the same audio twice. At a genuine pause a repeated word is a
     repeated word, and removing it would be deleting something that was
     said. */
  return boundary === "split"
    ? mergeSplitTranscripts(left, right)
    : `${left} ${right.trim()}`;
}

type Segment = {
  index: number;
  /** How this segment ended, which decides how the next one joins onto it. */
  boundary: SegmentBoundary;
  audio: ArrayBuffer;
  status: "pending" | "done" | "failed";
  text: string;
  failure: string;
};

/**
 * Open the microphone and start transcribing.
 *
 * Everything that can fail before audio flows fails here, with a message that
 * names the remedy: a refused permission, an unavailable device, a browser
 * with no audio pipeline at all. Everything that fails after this point is
 * reported through `onError` and does not end the recording, because losing a
 * sentence to a rate limit should not throw away the four before it.
 */
export async function startRecording(options: RecordingOptions = {}): Promise<RecordingSession> {
  const { onLevel, onError, onAutoStop, onTranscript, onSpeaking, language, handsFree } = options;

  if (!recordingSupported()) throw new Error("This browser cannot record audio.");

  /**
   * The context is built before the microphone is requested, and the order is
   * the entire fix for a dead level meter on iOS.
   *
   * An AudioContext constructed without user activation is born suspended and
   * never produces a sample. `getUserMedia` is what spends the activation, so
   * a context created after it is awaited has missed its chance — and the
   * failure is silent: recording works, the waveform sits flat for the whole
   * take, and there is nothing in the console. A refactor that moves this
   * below the await restores that bug exactly.
   */
  const Ctor = audioContextConstructor();
  if (!Ctor) throw new Error("This browser cannot record audio.");
  const audio = new Ctor();

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        /* One channel is all the transcriber uses and all a phone has. Asking
           for it explicitly stops a stereo interface handing back two, which
           the capture node would silently halve by taking only the left. */
        channelCount: 1
      }
    });
  } catch (error) {
    void audio.close().catch(() => {});
    const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
    throw new Error(denied
      ? isStandalone()
        ? "Microphone access was refused. iOS does not remember this for an installed app — reopen NaviOS from the home screen and allow it when asked, or open the site in Safari once to grant it."
        : "Microphone access was refused. Allow it for this site in your browser settings."
      : "No microphone is available.");
  }

  if (audio.state === "suspended") await audio.resume().catch(() => {});

  const source = audio.createMediaStreamSource(stream);
  /**
   * A silent path to the speakers.
   *
   * Neither an AudioWorkletNode nor a ScriptProcessorNode is pulled unless it
   * has a route to the destination — disconnected, `process` is simply never
   * called and the recording is a flat line. Routing it at full gain would put
   * the microphone through the speaker, which on a phone is feedback. So: to
   * the destination, at zero.
   */
  const sink = audio.createGain();
  sink.gain.value = 0;
  sink.connect(audio.destination);

  const resampler = createResampler(audio.sampleRate, TARGET_SAMPLE_RATE);
  const highPass = createHighPass(TARGET_SAMPLE_RATE);
  const segmenter = createSegmenter({
    maxRecordingMs: MAX_RECORDING_SECONDS * 1_000,
    ...(handsFree ? { endAfterSilenceMs: 1_100, noSpeechMs: 6_000 } : {})
  });

  /* Resampled audio waiting to complete a hop. */
  let carry = new Float32Array(0);
  /* Hops held for the open segment and the pre-roll, oldest first. */
  let hops: Float32Array[] = [];
  let baseHop = 0;
  let lastSpeaking = false;

  const segments: Segment[] = [];
  const abort = new AbortController();
  let finished = false;
  let cancelled = false;
  let emitted = "";
  const drainWaiters: (() => void)[] = [];

  /* ── Transcript assembly ────────────────────────────────────────────────
     Segments settle out of order — a short one queued behind a long one can
     come back first — but text may only ever be shown in the order it was
     spoken, and may only ever grow. So the live transcript is the longest
     unbroken run of settled segments from the start, and a gap simply waits. */

  function assemble(onlySettledPrefix: boolean): string {
    let text = "";
    let previousBoundary: SegmentBoundary = "pause";
    for (const segment of segments) {
      if (segment.status === "pending") {
        if (onlySettledPrefix) break;
        continue;
      }
      if (segment.status === "done" && segment.text) {
        text = joinTranscripts(text, segment.text, previousBoundary);
      }
      previousBoundary = segment.boundary;
    }
    return text;
  }

  function publish() {
    const next = assemble(true);
    if (next === emitted) return;
    emitted = next;
    onTranscript?.(next);
  }

  function settle() {
    publish();
    while (drainWaiters.length) drainWaiters.shift()?.();
  }

  /* ── The upload queue ───────────────────────────────────────────────────── */

  const queue: Segment[] = [];
  let active = 0;

  async function transcribe(segment: Segment, attempt = 0): Promise<void> {
    const hint = language && language !== "auto" ? `?language=${encodeURIComponent(language)}` : "";
    try {
      const response = await fetch(`/api/voice/transcribe${hint}`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: segment.audio,
        signal: abort.signal
      });
      const data = (await response.json().catch(() => null)) as
        { text?: string; error?: string; detail?: string } | null;

      if (response.ok && typeof data?.text === "string") {
        segment.text = data.text.trim();
        segment.status = "done";
        return;
      }

      /* A warming model answers seconds later; a rejected token never will.
         Retrying the second is how a clear message gets buried under a
         timeout. */
      const worthRetrying = response.status === 503 || response.status >= 500;
      if (worthRetrying && attempt === 0 && !abort.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        if (!abort.signal.aborted) return transcribe(segment, 1);
      }

      segment.status = "failed";
      segment.failure = data?.error || `Transcription failed (${response.status}).`;
      if (data?.detail) console.error("Navi Soul transcription detail:", data.detail);
    } catch (error) {
      if (abort.signal.aborted) {
        segment.status = "failed";
        segment.failure = "Cancelled.";
        return;
      }
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        if (!abort.signal.aborted) return transcribe(segment, 1);
      }
      segment.status = "failed";
      segment.failure = error instanceof Error ? error.message : "The request never completed.";
    }
  }

  function pump() {
    while (active < MAX_CONCURRENT_UPLOADS && queue.length) {
      const segment = queue.shift();
      if (!segment) break;
      active += 1;
      void transcribe(segment).finally(() => {
        active -= 1;
        settle();
        pump();
      });
    }
  }

  function enqueue(audioBytes: ArrayBuffer, boundary: SegmentBoundary) {
    if (audioBytes.byteLength > MAX_UPLOAD_BYTES) {
      onError?.("A stretch of that recording was too large to send.");
      return;
    }
    const segment: Segment = {
      index: segments.length,
      boundary,
      audio: audioBytes,
      status: "pending",
      text: "",
      failure: ""
    };
    segments.push(segment);
    queue.push(segment);
    pump();
  }

  /* ── Capture ────────────────────────────────────────────────────────────── */

  function gather(startHop: number, endHop: number): Float32Array {
    const frames: Float32Array[] = [];
    for (let index = Math.max(startHop, baseHop); index < endHop; index += 1) {
      const frame = hops[index - baseHop];
      if (frame) frames.push(frame);
    }
    return concatFloat32(frames);
  }

  function consumeHop(hop: Float32Array) {
    hops.push(hop);

    const amplitude = rms(hop);
    onLevel?.(displayLevel(amplitude));

    for (const event of segmenter.push(amplitude)) {
      if (event.type === "speech-start" && !lastSpeaking) {
        lastSpeaking = true;
        onSpeaking?.(true);
      } else if (event.type === "speech-end" && lastSpeaking) {
        lastSpeaking = false;
        onSpeaking?.(false);
      } else if (event.type === "segment") {
        const samples = gather(event.cut.startHop, event.cut.endHop);
        if (samples.length) enqueue(encodeWav(samples, TARGET_SAMPLE_RATE), event.cut.boundary);
      } else if (event.type === "turn-end") {
        onAutoStop?.(event.reason);
      }
    }

    /* Drop what no future segment can need. Without this a long recording
       grows without bound in memory — which is the other half of why the old
       version needed a sixty-second cap. Trimmed in batches because the
       copy is cheap only when it is not done fifty times a second. */
    const retain = segmenter.retainFromHop();
    if (retain - baseHop > 25) {
      hops = hops.slice(retain - baseHop);
      baseHop = retain;
    }
  }

  function consumeFrame(frame: Float32Array) {
    if (finished || cancelled) return;

    const resampled = resampler.push(frame);
    if (!resampled.length) return;
    const filtered = highPass(resampled);

    const combined = carry.length ? concatFloat32([carry, filtered]) : filtered;
    let offset = 0;
    while (combined.length - offset >= HOP_SAMPLES) {
      consumeHop(combined.slice(offset, offset + HOP_SAMPLES));
      offset += HOP_SAMPLES;
    }
    carry = combined.slice(offset);
  }

  /**
   * Prefer the worklet, accept the fallback.
   *
   * An AudioWorklet runs the capture on the audio thread, so a busy main
   * thread — rendering a long conversation, say — cannot drop samples.
   * ScriptProcessorNode is deprecated and runs on the main thread, but it is
   * present everywhere the worklet is not, and a slightly worse recording is
   * worth more than a microphone that does not work on a device.
   */
  let workletNode: AudioWorkletNode | null = null;
  let processorNode: ScriptProcessorNode | null = null;

  try {
    if (typeof AudioWorkletNode !== "function" || !audio.audioWorklet) throw new Error("no worklet");
    await audio.audioWorklet.addModule("/navi-capture-worklet.js");
    workletNode = new AudioWorkletNode(audio, "navi-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      processorOptions: { frameSize: CAPTURE_FRAME }
    });
    workletNode.port.onmessage = (event) => {
      if (event.data instanceof Float32Array) consumeFrame(event.data);
    };
    source.connect(workletNode);
    workletNode.connect(sink);
  } catch {
    try {
      processorNode = audio.createScriptProcessor(4096, 1, 1);
      processorNode.onaudioprocess = (event) => {
        /* Copied, not referenced: the input buffer is reused by the engine on
           the next callback, so holding the view would corrupt audio already
           queued for upload. */
        consumeFrame(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processorNode);
      processorNode.connect(sink);
    } catch {
      for (const track of stream.getTracks()) track.stop();
      void audio.close().catch(() => {});
      throw new Error("This browser cannot capture microphone audio.");
    }
  }

  /* ── Interruptions ──────────────────────────────────────────────────────── */

  const track = stream.getAudioTracks()[0];

  /**
   * The microphone being taken away, which on a phone is routine.
   *
   * A call, Siri, another app, or the headset being unplugged ends the track.
   * The previous version awaited an `onstop` that would never fire and left
   * the composer at "Transcribing…" forever with no error and no way back.
   * Here it is an ordinary ending: what was captured is already segmented and
   * mostly transcribed, so the caller is told to finish rather than to
   * discard.
   */
  const onTrackEnded = () => {
    if (finished || cancelled) return;
    onError?.("The microphone was taken by another app or disconnected.");
    onAutoStop?.("interrupted");
  };
  track?.addEventListener("ended", onTrackEnded);

  /**
   * iOS suspends the audio context when the app goes to the background or an
   * interruption arrives, and does not always resume it on return. A suspended
   * context produces no samples at all, so without this the recording silently
   * becomes a flat line from the moment of the interruption onwards.
   */
  const resumeIfSuspended = () => {
    if (finished || cancelled) return;
    if (audio.state !== "running") void audio.resume().catch(() => {});
  };
  audio.addEventListener("statechange", resumeIfSuspended);
  const onVisibility = () => { if (document.visibilityState === "visible") resumeIfSuspended(); };
  document.addEventListener("visibilitychange", onVisibility);

  /* ── Teardown ───────────────────────────────────────────────────────────── */

  function releaseMicrophone() {
    track?.removeEventListener("ended", onTrackEnded);
    audio.removeEventListener("statechange", resumeIfSuspended);
    document.removeEventListener("visibilitychange", onVisibility);

    if (workletNode) {
      /* Disconnecting is not enough to retire a worklet: only `process`
         returning false does that, and until it does the node stays
         scheduled. */
      try { workletNode.port.postMessage("stop"); } catch { /* already gone */ }
      workletNode.port.onmessage = null;
      workletNode.disconnect();
    }
    if (processorNode) {
      processorNode.onaudioprocess = null;
      processorNode.disconnect();
    }
    source.disconnect();
    sink.disconnect();
    /* A live track keeps the operating system's recording indicator lit,
       which looks exactly like the app still listening when it is not. */
    for (const item of stream.getTracks()) item.stop();
    void audio.close().catch(() => {});
  }

  return {
    transcript() {
      return assemble(false);
    },

    async stop() {
      if (finished || cancelled) return assemble(false);
      finished = true;
      releaseMicrophone();

      /* Whatever is still open becomes a last segment, including the tail of
         a sentence that was still being spoken when Stop was pressed. */
      for (const event of segmenter.flush()) {
        if (event.type !== "segment") continue;
        const samples = gather(event.cut.startHop, event.cut.endHop);
        if (samples.length) enqueue(encodeWav(samples, TARGET_SAMPLE_RATE), event.cut.boundary);
      }
      hops = [];
      carry = new Float32Array(0);

      /* Nothing above the noise floor was ever heard. That is silence, not a
         failure, and reporting it as one sends people to the wrong problem. */
      if (!segments.length) return "";

      while (segments.some((segment) => segment.status === "pending")) {
        await new Promise<void>((resolve) => drainWaiters.push(resolve));
      }
      publish();

      const text = assemble(false);
      if (text) return text;

      /* Every segment failed and none of them said why to anyone. This is the
         one case worth throwing for: there is no partial result to keep, and
         silence would be indistinguishable from success. */
      const failure = segments.find((segment) => segment.status === "failed" && segment.failure);
      if (failure) throw new Error(failure.failure);
      return "";
    },

    cancel() {
      if (cancelled) return;
      cancelled = true;
      finished = true;
      releaseMicrophone();
      abort.abort();
      queue.length = 0;
      /* Emptying the queue is not enough. A segment that was waiting its turn
         has no request to abort, so nothing would ever move it out of
         `pending` — and a `stop()` racing this cancel would wait on it for
         ever. Settling them here is what makes the two safe to call in either
         order. */
      for (const segment of segments) {
        if (segment.status !== "pending") continue;
        segment.status = "failed";
        segment.failure = "Cancelled.";
      }
      hops = [];
      carry = new Float32Array(0);
      while (drainWaiters.length) drainWaiters.shift()?.();
    }
  };
}

export type MicCheck = { step: string; ok: boolean; detail: string };

/**
 * Walk the whole path and report where it stops.
 *
 * "The microphone doesn't work" has meant six different things in this app,
 * and each one needed a different remedy. This runs the pipeline a stage at a
 * time — support, permission, device, context, signal, encoding, transcription
 * — so the answer is a step rather than a guess.
 */
export async function diagnoseMicrophone(onProgress?: (step: string) => void): Promise<MicCheck[]> {
  const checks: MicCheck[] = [];
  const note = (step: string, ok: boolean, detail: string) => {
    checks.push({ step, ok, detail });
    return ok;
  };

  onProgress?.("Checking support");
  if (!note("Browser support", recordingSupported(), recordingSupported()
    ? `${isStandalone() ? "Installed app" : "Browser tab"} · getUserMedia and Web Audio present`
    : "This browser cannot record audio at all.")) return checks;

  const permission = await microphonePermission();
  note("Permission", permission !== "denied", permission === null
    ? "This browser will not report permission state; getUserMedia decides."
    : `Reported as “${permission}”.`);

  onProgress?.("Opening the microphone");
  const Ctor = audioContextConstructor();
  const audio = Ctor ? new Ctor() : null;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    note("Microphone access", true, "Granted.");
  } catch (error) {
    void audio?.close().catch(() => {});
    note("Microphone access", false, error instanceof Error ? error.message : "Refused.");
    return checks;
  }

  const track = stream.getAudioTracks()[0];
  note("Audio track", Boolean(track) && track.readyState === "live" && !track.muted,
    track ? `${track.label || "unnamed device"} · state ${track.readyState}${track.muted ? " · MUTED by the system" : ""}` : "No audio track was returned.");

  if (audio && audio.state === "suspended") await audio.resume().catch(() => {});
  note("Audio context", audio?.state === "running",
    audio ? `State “${audio.state}” at ${audio.sampleRate} Hz. A suspended context produces silence and a flat waveform.` : "Could not be created; nothing can be captured.");

  onProgress?.("Listening for two seconds — please speak");
  const captured: Float32Array[] = [];
  let peak = 0;

  if (audio) {
    const source = audio.createMediaStreamSource(stream);
    const sink = audio.createGain();
    sink.gain.value = 0;
    sink.connect(audio.destination);
    const resampler = createResampler(audio.sampleRate, TARGET_SAMPLE_RATE);
    /* The same path the recorder uses, worklet first, so this reports on what
       actually runs rather than on something that resembles it. */
    let node: AudioNode | null = null;
    const take = (frame: Float32Array) => {
      const resampled = resampler.push(frame);
      if (!resampled.length) return;
      captured.push(resampled);
      peak = Math.max(peak, rms(resampled));
    };

    try {
      if (typeof AudioWorkletNode !== "function" || !audio.audioWorklet) throw new Error("no worklet");
      await audio.audioWorklet.addModule("/navi-capture-worklet.js");
      const worklet = new AudioWorkletNode(audio, "navi-capture", { processorOptions: { frameSize: CAPTURE_FRAME } });
      worklet.port.onmessage = (event) => { if (event.data instanceof Float32Array) take(event.data); };
      node = worklet;
      note("Capture path", true, "AudioWorklet, running off the main thread.");
    } catch {
      const processor = audio.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => take(new Float32Array(event.inputBuffer.getChannelData(0)));
      node = processor;
      note("Capture path", true, "ScriptProcessor fallback; the worklet would not load.");
    }

    source.connect(node);
    node.connect(sink);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    if (node instanceof AudioWorkletNode) node.port.postMessage("stop");
    else (node as ScriptProcessorNode).onaudioprocess = null;
    node.disconnect();
    source.disconnect();
    sink.disconnect();
  }

  for (const item of stream.getTracks()) item.stop();

  note("Signal", peak > 0.004, peak > 0.004
    ? `Picked up sound (peak ${dbfs(peak).toFixed(0)} dBFS).`
    : `Heard nothing (peak ${dbfs(peak).toFixed(0)} dBFS). The microphone opened but no audio is reaching the app.`);

  onProgress?.("Encoding a sample");
  const samples = concatFloat32(captured);
  const wav = encodeWav(samples, TARGET_SAMPLE_RATE);
  note("Encoding", wav.byteLength > 1_000,
    `${wav.byteLength.toLocaleString()} bytes of 16 kHz 16-bit WAV — written here rather than negotiated with the browser.`);
  void audio?.close().catch(() => {});

  onProgress?.("Sending it for transcription");
  try {
    const response = await fetch("/api/voice/transcribe", {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: wav
    });
    const data = (await response.json().catch(() => null)) as { text?: string; error?: string; detail?: string } | null;
    note("Transcription", response.ok && typeof data?.text === "string",
      response.ok && typeof data?.text === "string"
        ? `Returned “${data.text.trim().slice(0, 60) || "(silence)"}”.`
        : `HTTP ${response.status}. ${data?.error ?? "No message."}${data?.detail ? ` — ${data.detail.slice(0, 180)}` : ""}`);
  } catch (error) {
    note("Transcription", false, error instanceof Error ? error.message : "The request never completed.");
  }

  return checks;
}
