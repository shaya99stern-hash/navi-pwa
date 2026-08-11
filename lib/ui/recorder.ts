"use client";

/**
 * Recording audio and having it transcribed, instead of asking the browser to
 * do speech recognition.
 *
 * `webkitSpeechRecognition` is why the microphone did not work. In an
 * installed iOS PWA it is frequently absent altogether — no error, no event,
 * nothing to render — it plays a system chime the page cannot suppress, and
 * it ends sessions in ways nothing can observe. Every fix layered on top of it
 * was a fix on sand.
 *
 * MediaRecorder is available wherever getUserMedia is, makes no sound of its
 * own, and exposes the audio stream, which is what lets the composer draw a
 * real level meter rather than a lit icon. Transcription happens server-side.
 */

export type RecorderLevels = (level: number) => void;

export type RecordingSession = {
  /** Stop, transcribe, and resolve with the text. Empty string if silent. */
  stop: () => Promise<string>;
  /** Abandon the recording without transcribing it. */
  cancel: () => void;
};

/**
 * How long a single dictation may run.
 *
 * Not a stylistic cap. The request body has to cross a serverless platform
 * that refuses large uploads before the route ever runs, so a recording that
 * grows past that ceiling fails with no response the app can render — the
 * composer simply sits at "Transcribing…" until the fetch gives up. Bounding
 * the recording is what turns that silent class of failure into an outcome
 * the user can see coming, which is what the countdown in the composer is for.
 */
export const MAX_RECORDING_SECONDS = 60;

/**
 * The largest body worth sending.
 *
 * Vercel refuses request bodies above roughly 4.5 MB (4 MB on the edge
 * runtime) at the platform edge, before any handler executes — so the route's
 * own 413 can never be the thing that renders. Staying under 3.5 MB keeps the
 * decision on this side of the wire, where there is a UI to show it in.
 *
 * At the bitrates browsers actually record speech at (32–128 kbps) sixty
 * seconds lands between 240 KB and 1 MB, so this bound is not reachable by
 * normal dictation; it exists to catch the recorder that ignores the cap.
 */
export const MAX_UPLOAD_BYTES = 3_500_000;

export function recordingSupported(): boolean {
  return typeof navigator !== "undefined"
    && typeof navigator.mediaDevices?.getUserMedia === "function"
    && typeof MediaRecorder !== "undefined";
}

/** Running as an installed app rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Whether the microphone has already been granted, where the browser will say.
 *
 * Safari has historically not implemented the `microphone` permission name,
 * so `null` means "no answer available", not "denied" — the caller must treat
 * it as unknown and let getUserMedia be the judge. Guessing "denied" here
 * would put a dead-button warning in front of a microphone that works.
 */
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

/**
 * What this device will actually record, reported rather than assumed.
 *
 * `MediaRecorder.isTypeSupported` returning true does not mean the recorder
 * produces that container, and it does not mean the transcription service
 * accepts what it produces. Those three can disagree, and every previous
 * attempt at this bug guessed which one was lying. Logged once per session so
 * a device that fails leaves evidence behind instead of a shrug.
 */
export function describeRecordingSupport(): Record<string, unknown> {
  const candidates = ["audio/mp4", "audio/mpeg", "audio/ogg;codecs=opus", "audio/ogg", "audio/webm;codecs=opus", "audio/webm"];
  return {
    standalone: isStandalone(),
    recordingSupported: recordingSupported(),
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    isTypeSupported: Object.fromEntries(candidates.map((type) => [
      type,
      typeof MediaRecorder === "undefined" ? "no MediaRecorder" : MediaRecorder.isTypeSupported?.(type) === true
    ])),
    chosen: typeof MediaRecorder === "undefined" ? null : preferredMimeType() ?? "browser default"
  };
}

/**
 * The first container this browser will record *that transcription accepts*.
 *
 * Order matters and was wrong. WebM/Opus came first because it is the best
 * supported recording format on the web — and the transcription endpoint
 * rejects it outright: `Content type "audio/webm; codecs=opus" not
 * supported`. Recording in the format the recorder prefers rather than the
 * one the consumer accepts made every transcription fail at the last step.
 *
 * MP4/AAC first: Safari records it natively, Whisper accepts it everywhere,
 * and it is the format an iPhone would have produced anyway. WebM stays last
 * as a genuine fallback for a browser that supports nothing else — the
 * multipart path handles it where the raw-bytes path cannot.
 */
function preferredMimeType(): string | undefined {
  const candidates = ["audio/mp4", "audio/mpeg", "audio/ogg;codecs=opus", "audio/ogg", "audio/webm;codecs=opus", "audio/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type));
}

/**
 * Start recording. Rejects if the microphone is unavailable or refused, so the
 * caller can say which of those happened rather than showing a dead button.
 */
export async function startRecording({ onLevel, onError, onAutoStop, language }: {
  onLevel?: RecorderLevels;
  onError?: (message: string) => void;
  /** Fired when the duration cap stops the recording on its own. */
  onAutoStop?: () => void;
  /* The user's dictation-language preference, passed straight through. Voice
     mode has offered this picker all along and nothing ever sent it anywhere,
     so it changed a stored value and nothing else. `auto` means no hint. */
  language?: string;
} = {}): Promise<RecordingSession> {
  if (!recordingSupported()) throw new Error("This browser cannot record audio.");

  /**
   * The AudioContext is constructed *before* the getUserMedia await, and this
   * ordering is the whole fix for the dead level meter.
   *
   * On iOS an AudioContext created without transient user activation is born
   * `suspended` and never runs. `getUserMedia` is what spends the activation:
   * it takes hundreds of milliseconds and may raise a permission sheet, so a
   * context constructed after it is always too late. The analyser then read a
   * flat 128 forever, the level stayed 0, and the composer drew a motionless
   * row of dots for the entire recording — which is precisely what "the
   * microphone doesn't hear me" looks like from the outside. The audio was
   * being captured correctly the whole time; only the meter was dead.
   *
   * Constructing it here, still inside the activation the tap granted, starts
   * it `running`. The source is attached once the stream arrives.
   */
  let audio: AudioContext | undefined;
  if (onLevel) {
    try {
      const Ctor = window.AudioContext
        ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) audio = new Ctor();
    } catch {
      /* Level metering is decoration. Losing it must not lose the recording. */
    }
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch (error) {
    void audio?.close().catch(() => {});
    const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
    /* An installed iOS app has no per-site permission pane to send anyone to,
       so the browser-settings advice is wrong there and reads as the app
       blaming the user for a setting that does not exist. */
    throw new Error(denied
      ? isStandalone()
        ? "Microphone access was refused. iOS does not remember this for an installed app — reopen NaviOS from the home screen and allow it when asked, or open the site in Safari once to grant it."
        : "Microphone access was refused. Allow it for this site in your browser settings."
      : "No microphone is available.");
  }

  const mimeType = preferredMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.onerror = () => onError?.("Recording stopped unexpectedly.");

  /* A live level, so the composer can show that speech is being picked up.
     Everything here is torn down with the stream; an AudioContext left running
     holds the microphone indicator on after recording ends. */
  let raf = 0;
  if (onLevel && audio) {
    try {
      /* Belt and braces for the case above: a context that still came back
         suspended is asked to run. This resolves on its own where the
         construction happened in time, and is the only recovery where it did
         not — a suspended context produces silence, not an error. */
      if (audio.state === "suspended") void audio.resume().catch(() => {});
      const source = audio.createMediaStreamSource(stream);
      const analyser = audio.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        /* Peak deviation from silence, normalised. Cheaper than RMS and reads
           the same once it is a few pixels of bar height. */
        let peak = 0;
        for (const value of data) peak = Math.max(peak, Math.abs(value - 128));
        onLevel(Math.min(1, peak / 96));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch {
      /* Level metering is decoration. Losing it must not lose the recording. */
    }
  }

  let capTimer = 0;
  const teardown = () => {
    if (raf) cancelAnimationFrame(raf);
    if (capTimer) window.clearTimeout(capTimer);
    void audio?.close().catch(() => {});
    for (const track of stream.getTracks()) track.stop();
  };

  recorder.start();

  /* The cap enforces itself rather than trusting the UI to do it. The composer
     shows the countdown, but a backgrounded tab does not run its timers
     reliably and the ceiling has to hold regardless of what is on screen. */
  capTimer = window.setTimeout(() => {
    if (recorder.state !== "inactive") {
      recorder.stop();
      onAutoStop?.();
    }
  }, MAX_RECORDING_SECONDS * 1_000);

  return {
    async stop() {
      /* `onstop` only ever fires for a recorder that was running. Waiting on it
         unconditionally is what turned an already-stopped recorder into a
         permanent hang: the promise had nothing left to resolve it, so the
         composer sat at "Transcribing…" forever with no error and no way back.
         A recorder reaches `inactive` on its own whenever iOS interrupts the
         audio session — a call, Siri, another app taking the microphone — so
         this is a state the app reaches in ordinary use, not a corner case. */
      if (recorder.state !== "inactive") {
        await new Promise<void>((resolve) => { recorder.onstop = () => resolve(); recorder.stop(); });
      }
      teardown();

      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      // Below this it is a stray tap, not speech, and the API would 400.
      if (blob.size < 1_200) return "";
      /* Refused here, with a sentence, rather than at the platform edge, where
         the rejection never reaches the handler and so never reaches the user. */
      if (blob.size > MAX_UPLOAD_BYTES) {
        throw new Error("That recording is too large to send. Record a shorter message.");
      }

      const hint = language && language !== "auto" ? `?language=${encodeURIComponent(language)}` : "";
      const response = await fetch(`/api/voice/transcribe${hint}`, {
        method: "POST",
        headers: { "Content-Type": blob.type },
        body: blob
      });
      const data = (await response.json().catch(() => null)) as { text?: string; error?: string; detail?: string; sentAs?: string } | null;
      if (!response.ok || typeof data?.text !== "string") {
        /* The full per-model detail goes to the console rather than the
           composer: the footer needs one readable sentence, but a failure
           nobody can inspect is one that gets reported as "still broken"
           with nothing to act on. */
        if (data?.detail) console.error("Navi Soul transcription detail:", data.detail, "sent as", data.sentAs ?? blob.type);
        throw new Error(data?.error || "That recording could not be transcribed.");
      }
      return data.text;
    },
    cancel() {
      if (recorder.state !== "inactive") recorder.stop();
      teardown();
    }
  };
}

export type MicCheck = { step: string; ok: boolean; detail: string };

/**
 * Run the whole dictation pipeline once and report which step fails.
 *
 * Three rounds of this bug have been diagnosed by reading source and guessing,
 * and the guesses were wrong twice: first the transcription container, then
 * the suspended AudioContext. Both were real defects; neither was the whole
 * story, because "the mic doesn't work" describes six different failures and
 * the app never said which one it hit.
 *
 * So this stops guessing. It exercises permission, capture, *actual measured
 * signal*, encoding, and the network round trip in order, and names the first
 * thing that breaks along with what it really returned. The signal check
 * matters most: a recorder can produce a perfectly valid file of silence, and
 * from the outside that is indistinguishable from a recorder that never
 * started — which is exactly the "records but hears nothing" report.
 */
export async function diagnoseMicrophone(onProgress?: (step: string) => void): Promise<MicCheck[]> {
  const checks: MicCheck[] = [];
  const note = (step: string, ok: boolean, detail: string) => {
    checks.push({ step, ok, detail });
    return ok;
  };

  onProgress?.("Checking support");
  if (!note("Browser support", recordingSupported(), recordingSupported()
    ? `${isStandalone() ? "Installed app" : "Browser tab"} · getUserMedia and MediaRecorder present`
    : "This browser cannot record audio at all.")) return checks;

  const permission = await microphonePermission();
  note("Permission", permission !== "denied", permission === null
    ? "This browser will not report permission state; getUserMedia decides."
    : `Reported as “${permission}”.`);

  onProgress?.("Opening the microphone");
  let audio: AudioContext | undefined;
  try {
    const Ctor = window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) audio = new Ctor();
  } catch { /* measured below */ }

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

  note("Audio context", audio?.state === "running",
    audio ? `State “${audio.state}”. A suspended context produces silence and a flat waveform.` : "Could not be created; the level meter cannot run.");

  onProgress?.("Listening for two seconds — please speak");
  let peak = 0;
  if (audio) {
    try {
      if (audio.state === "suspended") await audio.resume().catch(() => {});
      const analyser = audio.createAnalyser();
      analyser.fftSize = 256;
      audio.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const until = Date.now() + 2_000;
      while (Date.now() < until) {
        analyser.getByteTimeDomainData(data);
        for (const value of data) peak = Math.max(peak, Math.abs(value - 128));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } catch { /* reported by the check below */ }
  }
  /* 4 of 128 is the floor of real room noise. Below it the stream is silent,
     whatever the file size says. */
  note("Signal", peak > 4, peak > 4
    ? `Picked up sound (peak ${Math.round((peak / 128) * 100)}%).`
    : `Heard nothing (peak ${Math.round((peak / 128) * 100)}%). The microphone opened but no audio is reaching the app.`);

  onProgress?.("Recording a sample");
  const mimeType = preferredMimeType();
  let blob: Blob;
  try {
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    recorder.stop();
    await stopped;
    blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
    note("Encoding", blob.size > 1_200, `${blob.size.toLocaleString()} bytes as ${blob.type || "unknown type"}.`);
  } catch (error) {
    note("Encoding", false, error instanceof Error ? error.message : "The recorder failed.");
    for (const t of stream.getTracks()) t.stop();
    void audio?.close().catch(() => {});
    return checks;
  } finally {
    for (const t of stream.getTracks()) t.stop();
    void audio?.close().catch(() => {});
  }

  onProgress?.("Sending it for transcription");
  try {
    const response = await fetch("/api/voice/transcribe", {
      method: "POST",
      headers: { "Content-Type": blob.type },
      body: blob
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
