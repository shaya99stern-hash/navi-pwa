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

export function recordingSupported(): boolean {
  return typeof navigator !== "undefined"
    && typeof navigator.mediaDevices?.getUserMedia === "function"
    && typeof MediaRecorder !== "undefined";
}

/** The first container this browser will actually record. Safari differs. */
function preferredMimeType(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type));
}

/**
 * Start recording. Rejects if the microphone is unavailable or refused, so the
 * caller can say which of those happened rather than showing a dead button.
 */
export async function startRecording({ onLevel, onError }: {
  onLevel?: RecorderLevels;
  onError?: (message: string) => void;
} = {}): Promise<RecordingSession> {
  if (!recordingSupported()) throw new Error("This browser cannot record audio.");

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch (error) {
    const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
    throw new Error(denied
      ? "Microphone access was refused. Allow it for this app in your browser settings."
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
  let audio: AudioContext | undefined;
  let raf = 0;
  if (onLevel) {
    try {
      audio = new AudioContext();
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

  const teardown = () => {
    if (raf) cancelAnimationFrame(raf);
    void audio?.close().catch(() => {});
    for (const track of stream.getTracks()) track.stop();
  };

  recorder.start();

  return {
    async stop() {
      const finished = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
      if (recorder.state !== "inactive") recorder.stop();
      await finished;
      teardown();

      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      // Below this it is a stray tap, not speech, and the API would 400.
      if (blob.size < 1_200) return "";

      const response = await fetch("/api/voice/transcribe", {
        method: "POST",
        headers: { "Content-Type": blob.type },
        body: blob
      });
      const data = (await response.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (!response.ok || typeof data?.text !== "string") {
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
