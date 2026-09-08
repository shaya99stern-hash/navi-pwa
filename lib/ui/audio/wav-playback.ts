let context: AudioContext | null = null;
if (typeof window !== "undefined") window.addEventListener("pagehide", () => {
  if (context && context.state !== "closed") void context.close().catch(() => {});
  context = null;
});

export function decodeMonoWav(bytes: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(bytes);
  const text = (offset: number, length: number) => String.fromCharCode(...new Uint8Array(bytes, offset, length));
  if (view.byteLength < 44 || text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") throw new Error("Premium audio is not a WAV file");
  let rate = 0, data = -1, length = 0;
  for (let offset = 12; offset + 8 <= view.byteLength;) {
    const size = view.getUint32(offset + 4, true), start = offset + 8;
    if (size > view.byteLength - start) throw new Error("Premium WAV is incomplete");
    if (text(offset, 4) === "fmt ") {
      if (size < 16 || view.getUint16(start, true) !== 1 || view.getUint16(start + 2, true) !== 1 || view.getUint16(start + 14, true) !== 16) throw new Error("Premium WAV must be mono 16-bit PCM");
      rate = view.getUint32(start + 4, true);
    }
    if (text(offset, 4) === "data") { data = start; length = size; }
    offset = start + size + (size % 2);
  }
  if (data < 0 || !length || length % 2 || rate < 8000 || rate > 96000) throw new Error("Premium WAV contains invalid samples");
  const samples = new Float32Array(length / 2);
  for (let index = 0; index < samples.length; index++) samples[index] = view.getInt16(data + index * 2, true) / 32768;
  return { samples, sampleRate: rate };
}

export function primePremiumAudio(): void {
  try {
    const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!context || context.state === "closed") context = new Constructor();
    void context.resume().catch(() => {});
    const silence = context.createBufferSource();
    silence.buffer = context.createBuffer(1, 1, context.sampleRate);
    silence.connect(context.destination); silence.onended = () => silence.disconnect(); silence.start();
  } catch { /* HTML audio and the device voice remain available. */ }
}

export async function playPremiumWav(blob: Blob): Promise<{ stop: () => void; done: Promise<void> }> {
  const decoded = decodeMonoWav(await blob.arrayBuffer());
  if (!context || context.state === "closed") primePremiumAudio();
  if (!context) throw new Error("Web Audio is unavailable");
  const active = context;
  if (active.state !== "running") throw new Error("Audio playback needs a new tap");
  const buffer = active.createBuffer(1, decoded.samples.length, decoded.sampleRate);
  buffer.getChannelData(0).set(decoded.samples);
  const source = active.createBufferSource(); source.buffer = buffer; source.connect(active.destination);
  let settle = () => {}, finished = false;
  const done = new Promise<void>(resolve => { settle = resolve; });
  const finish = () => { if (finished) return; finished = true; clearTimeout(timer); source.disconnect(); settle(); };
  const stop = () => { try { source.stop(); } catch {} finish(); };
  const timer = setTimeout(stop, Math.ceil(buffer.duration * 1000) + 2000);
  source.onended = finish;
  try { source.start(); } catch (error) { finish(); throw error; }
  return { stop, done };
}
