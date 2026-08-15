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

export const MAX_RECORDING_SECONDS = 60;
export const MAX_UPLOAD_BYTES = 3_500_000;

export function recordingSupported(): boolean {
  return typeof navigator !== "undefined"
    && typeof navigator.mediaDevices?.getUserMedia === "function"
    && typeof MediaRecorder !== "undefined";
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

function preferredMimeType(): string | undefined {
  const candidates = ["audio/mp4", "audio/mpeg", "audio/ogg;codecs=opus", "audio/ogg", "audio/webm;codecs=opus", "audio/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type));
}

/**
 * Start recording. Iterates silently through fallback audio formats before throwing.
 */
export async function startRecording({ onLevel, onError, onAutoStop, language }: {
  onLevel?: RecorderLevels;
  onError?: (message: string) => void;
  onAutoStop?: () => void;
  language?: string;
} = {}): Promise<RecordingSession> {
  if (!recordingSupported()) throw new Error("This browser cannot record audio.");

  let audio: AudioContext | undefined;
  if (onLevel) {
    try {
      const Ctor = window.AudioContext
        ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) audio = new Ctor();
    } catch {
      /* Level metering decoration failure must not break recording */
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
    throw new Error(denied
      ? isStandalone()
        ? "Microphone access was refused. iOS does not remember this for an installed app — reopen NaviOS from the home screen and allow it when asked, or open the site in Safari once to grant it."
        : "Microphone access was refused. Allow it for this site in your browser settings."
      : "No microphone is available.");
  }

  // SILENT FALLBACK LOOP FOR MEDIA RECORDER FORMATS
  const candidates = ["audio/mp4", "audio/mpeg", "audio/ogg;codecs=opus", "audio/ogg", "audio/webm;codecs=opus", "audio/webm"];
  let recorder: MediaRecorder | null = null;
  let activeMimeType: string | undefined = undefined;

  for (const candidate of candidates) {
    if (candidate && MediaRecorder.isTypeSupported && !MediaRecorder.isTypeSupported(candidate)) {
      continue; 
    }
    try {
      recorder = new MediaRecorder(stream, candidate ? { mimeType: candidate } : undefined);
      activeMimeType = candidate;
      break; 
    } catch {
      // Try next format silently without showing error message
    }
  }

  // Last resort absolute default fallback
  if (!recorder) {
    try {
      recorder = new MediaRecorder(stream);
      activeMimeType = undefined;
    } catch (err) {
      for (const t of stream.getTracks()) t.stop();
      void audio?.close().catch(() => {});
      throw new Error("Audio format was rejected and no fallback formats worked.");
    }
  }

  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.onerror = () => onError?.("Recording stopped unexpectedly.");

  let raf = 0;
  if (onLevel && audio) {
    try {
      if (audio.state === "suspended") void audio.resume().catch(() => {});
      const source = audio.createMediaStreamSource(stream);
      const analyser = audio.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const value of data) peak = Math.max(peak, Math.abs(value - 128));
        onLevel(Math.min(1, peak / 96));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch {
      /* Level metering decoration */
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

  capTimer = window.setTimeout(() => {
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      onAutoStop?.();
    }
  }, MAX_RECORDING_SECONDS * 1_000);

  return {
    async stop() {
      if (recorder && recorder.state !== "inactive") {
        await new Promise<void>((resolve) => { 
          if (recorder) recorder.onstop = () => resolve(); 
          recorder?.stop(); 
        });
      }
      teardown();

      const blob = new Blob(chunks, { type: recorder?.mimeType || activeMimeType || "audio/webm" });
      if (blob.size < 1_200) return "";
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
        if (data?.detail) console.error("Navi Soul transcription detail:", data.detail, "sent as", data.sentAs ?? blob.type);
        throw new Error(data?.error || "That recording could not be transcribed.");
      }
      return data.text;
    },
    cancel() {
      if (recorder && recorder.state !== "inactive") recorder.stop();
      teardown();
    }
  };
}

export type MicCheck = { step: string; ok: boolean; detail: string };

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
