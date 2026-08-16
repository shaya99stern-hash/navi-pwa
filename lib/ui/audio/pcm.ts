/**
 * The signal processing between a microphone and a transcriber.
 *
 * Every function here is pure and framework-free on purpose. This is the part
 * of dictation that is genuinely easy to get wrong and impossible to eyeball:
 * a resampler that aliases, a filter that loses its state between callbacks, a
 * WAV header off by four bytes — each produces audio that sounds fine to a
 * person and transcribes as gibberish, on one device, sometimes. As plain
 * functions over arrays of numbers they can be fed a sine wave in a test and
 * checked against arithmetic instead of against a phone.
 *
 * There is no model here and nothing adaptive. This layer only makes the
 * samples correct.
 */

/**
 * What the transcriber actually wants.
 *
 * Whisper resamples everything to 16 kHz before it does anything else, so
 * sending 48 kHz is three times the bytes for identical output. Speech energy
 * is effectively gone above 8 kHz, which is exactly the Nyquist limit of this
 * rate — the choice is the model's, and matching it is free accuracy and a
 * third of the upload.
 */
export const TARGET_SAMPLE_RATE = 16_000;

/** Bytes per second of the encoded format: 16 kHz × 16-bit × mono. */
export const TARGET_BYTES_PER_SECOND = TARGET_SAMPLE_RATE * 2;

/**
 * Anti-alias filter length.
 *
 * Odd, so the filter is linear phase with an integer delay of (taps - 1) / 2
 * and does not smear transients — which for speech means consonant onsets,
 * which is where a transcriber gets most of its information. Sixty-five taps
 * puts the stopband far enough down that a 12 kHz hiss cannot fold back into
 * the 4 kHz range where vowels live, and costs about a microsecond per frame.
 */
const FILTER_TAPS = 65;

/**
 * Cutoff, as a fraction of the output Nyquist frequency.
 *
 * Slightly under 1 rather than exactly at it: a windowed-sinc filter has a
 * transition band, and placing the corner exactly at Nyquist means the top of
 * the transition is already folding back. 0.9 puts the whole transition below
 * the fold at a cost of the 7.2–8 kHz band, which carries no speech.
 */
const CUTOFF_FRACTION = 0.9;

/**
 * High-pass corner for the DC blocker, in hertz.
 *
 * Below the human voice — the lowest fundamental of a deep male voice is
 * around 85 Hz — and above the two things that dominate a phone recording
 * down there: the DC offset that many microphone front-ends carry, and
 * handling noise, which is broadband but concentrated in the bottom octave.
 * Both waste headroom that automatic gain control then spends, so removing
 * them makes the speech itself louder without touching the speech.
 */
const HIGH_PASS_HZ = 80;

/** sinc(x) = sin(πx) / (πx), continuous at zero. */
function sinc(x: number): number {
  if (x === 0) return 1;
  const scaled = Math.PI * x;
  return Math.sin(scaled) / scaled;
}

/**
 * A windowed-sinc low-pass, normalised to unity gain at DC.
 *
 * The normalisation is not cosmetic. An un-normalised kernel changes the
 * signal's level as a side effect of resampling, which then moves the noise
 * floor the voice detector is calibrated against — so a device with an
 * unusual sample rate would end up with a different speech threshold than
 * every other device, for no reason anybody could have found.
 */
export function designLowPass(cutoffHz: number, sampleRate: number, taps = FILTER_TAPS): Float32Array {
  const kernel = new Float32Array(taps);
  const middle = (taps - 1) / 2;
  const normalised = cutoffHz / sampleRate;

  let sum = 0;
  for (let index = 0; index < taps; index += 1) {
    const offset = index - middle;
    /* Hann window. Tapering the ends is what turns a truncated sinc — which
       ripples badly in the stopband — into something with a usable one. */
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (taps - 1));
    const value = 2 * normalised * sinc(2 * normalised * offset) * window;
    kernel[index] = value;
    sum += value;
  }

  if (sum !== 0) {
    for (let index = 0; index < taps; index += 1) kernel[index] /= sum;
  }
  return kernel;
}

export type Resampler = {
  /** Feed input samples; returns however many output samples that produced. */
  push(input: Float32Array): Float32Array;
  /** Output samples per input sample, for sizing buffers. */
  readonly ratio: number;
};

/**
 * Rate conversion that survives being called in pieces.
 *
 * The audio arrives in frames, and a resampler that treats each frame
 * independently produces a click at every boundary — the filter restarts with
 * an empty history, and the fractional read position resets. At 16 frames a
 * second that is sixteen clicks a second, which a transcriber hears as
 * consonants that were never spoken. So both pieces of state, the filter's
 * tail and the fractional position, persist across calls; that continuity is
 * the whole reason this is an object rather than a function.
 *
 * Two stages, in the order that matters: low-pass at the *input* rate to
 * remove everything above the output's Nyquist frequency, and only then read
 * at the output rate. Doing it the other way round — decimating first — is
 * the classic aliasing bug, and it does not sound like distortion. It sounds
 * like a different, quieter voice talking underneath.
 */
export function createResampler(inputRate: number, outputRate: number): Resampler {
  const ratio = inputRate / outputRate;

  /* Nothing to do, and nothing worth spending: a device already recording at
     the target rate is passed straight through rather than filtered by a
     kernel whose corner would sit inside the speech band. */
  if (inputRate === outputRate) {
    return { ratio: 1, push: (input) => input };
  }

  const kernel = designLowPass((Math.min(inputRate, outputRate) / 2) * CUTOFF_FRACTION, inputRate);
  const taps = kernel.length;
  /* The filter's memory: the last `taps - 1` input samples, so the first
     output of the next frame can see the end of this one. */
  const history = new Float32Array(taps - 1);
  /* Filtered samples produced but not yet read at the output rate. Never
     larger than `ratio + 1` entries. */
  let pending = new Float32Array(0);
  let position = 0;

  return {
    ratio: 1 / ratio,
    push(input) {
      if (!input.length) return new Float32Array(0);

      /* Convolve across the boundary by prefixing the previous tail, so
         sample zero of this frame is filtered with real history rather than
         with zeros. */
      const padded = new Float32Array(history.length + input.length);
      padded.set(history, 0);
      padded.set(input, history.length);

      const filtered = new Float32Array(input.length);
      for (let index = 0; index < input.length; index += 1) {
        let accumulator = 0;
        for (let tap = 0; tap < taps; tap += 1) {
          accumulator += kernel[tap] * padded[index + taps - 1 - tap];
        }
        filtered[index] = accumulator;
      }
      history.set(padded.subarray(padded.length - history.length));

      const available = new Float32Array(pending.length + filtered.length);
      available.set(pending, 0);
      available.set(filtered, pending.length);

      /* One output sample per step of `ratio` input samples, linearly
         interpolated between neighbours. The signal has already been band
         limited well under this rate, so the interpolation error sits below
         the quantisation noise of the 16-bit encoding it is headed for. */
      const capacity = Math.max(0, Math.ceil((available.length - position) / ratio) + 1);
      const output = new Float32Array(capacity);
      let produced = 0;
      while (Math.floor(position) + 1 < available.length) {
        const index = Math.floor(position);
        const fraction = position - index;
        output[produced] = available[index] * (1 - fraction) + available[index + 1] * fraction;
        produced += 1;
        position += ratio;
      }

      /**
       * Carry the read position, clamped to what actually exists.
       *
       * The last step of the loop can leave `position` past the end of the
       * buffer — with a ratio of three, reading index 1023 of 1025 samples
       * moves it to 1026. Rebasing by the raw `floor(position)` then discards
       * more than there is, and the next frame starts one sample early. Every
       * frame after that inherits the error, so what looks like a rounding
       * detail is a permanent drift: the piece-by-piece result stops matching
       * the same audio resampled in one go, and the seam is audible at every
       * frame boundary.
       */
      const consumed = Math.min(Math.floor(position), available.length);
      pending = available.slice(consumed);
      position -= consumed;

      return output.subarray(0, produced);
    }
  };
}

export type HighPass = (input: Float32Array) => Float32Array;

/**
 * A one-pole DC blocker, in place.
 *
 * y[n] = x[n] − x[n−1] + R·y[n−1]. The differencing zero sits exactly at DC
 * and the pole just inside it pulls the response back up, which is a
 * first-order high-pass with a corner at roughly (1 − R)·rate / 2π. Two
 * multiplies a sample, and it keeps its two samples of state across frames for
 * the same reason the resampler does.
 */
export function createHighPass(sampleRate: number, cutoffHz = HIGH_PASS_HZ): HighPass {
  const coefficient = Math.max(0, Math.min(0.9999, 1 - (2 * Math.PI * cutoffHz) / sampleRate));
  let lastInput = 0;
  let lastOutput = 0;

  return (input) => {
    const output = new Float32Array(input.length);
    for (let index = 0; index < input.length; index += 1) {
      const sample = input[index];
      const filtered = sample - lastInput + coefficient * lastOutput;
      lastInput = sample;
      lastOutput = filtered;
      output[index] = filtered;
    }
    return output;
  };
}

/** Root mean square of a frame, which is loudness rather than peak. */
export function rms(frame: Float32Array, start = 0, end = frame.length): number {
  if (end <= start) return 0;
  let total = 0;
  for (let index = start; index < end; index += 1) total += frame[index] * frame[index];
  return Math.sqrt(total / (end - start));
}

/**
 * Amplitude as decibels below full scale.
 *
 * The voice detector works in dB and not in linear amplitude because hearing
 * and speech dynamics are logarithmic: the gap between a whisper and a shout
 * is a factor of a thousand linear and a tidy 60 dB here. A threshold
 * expressed as "ten above the room" is a sentence; expressed linearly it is a
 * multiplier that means something different in every room.
 */
export function dbfs(amplitude: number): number {
  return 20 * Math.log10(Math.max(amplitude, 1e-7));
}

/** Join frames into one buffer, for assembling a segment before encoding. */
export function concatFloat32(frames: Float32Array[]): Float32Array {
  let total = 0;
  for (const frame of frames) total += frame.length;
  const joined = new Float32Array(total);
  let offset = 0;
  for (const frame of frames) {
    joined.set(frame, offset);
    offset += frame.length;
  }
  return joined;
}

/**
 * Float samples to signed 16-bit, clamped.
 *
 * The asymmetric scale is deliberate: two's complement runs −32768 to +32767,
 * so scaling both directions by 32767 wastes a step below zero and scaling
 * both by 32768 wraps the loudest positive sample to full-scale negative — a
 * click on exactly the loudest moment of the recording.
 */
export function float32ToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    out[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return out;
}

/** Byte length of the RIFF header this module writes. */
export const WAV_HEADER_BYTES = 44;

/**
 * A WAV file, written by hand.
 *
 * This is the change that removes an entire class of failure rather than
 * working around it. The old recorder asked the browser for a container and
 * got a different one on every platform, then asked the transcriber to accept
 * whichever it got — and "that audio format was rejected" was the single most
 * common way dictation failed. Nobody is asked anything here: the header is
 * forty-four known bytes and the payload is little-endian 16-bit PCM, which is
 * the one encoding every speech API accepts and none of them negotiates over.
 *
 * It also makes a recording divisible. A WebM or MP4 stream carries its
 * header only in the first chunk, so a slice of one is undecodable and
 * transcribing while someone is still talking is impossible. Every WAV here
 * is complete on its own, which is what lets the words arrive while the
 * sentence is still being spoken.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const pcm = float32ToInt16(samples);
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + pcm.length * 2);
  const view = new DataView(buffer);

  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };

  ascii(0, "RIFF");
  /* Everything after this field, which is the file length minus the eight
     bytes of "RIFF" and this number itself. */
  view.setUint32(4, 36 + pcm.length * 2, true);
  ascii(8, "WAVE");

  ascii(12, "fmt ");
  view.setUint32(16, 16, true);            // PCM format chunks are 16 bytes
  view.setUint16(20, 1, true);             // 1 = uncompressed PCM
  view.setUint16(22, 1, true);             // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate: rate × channels × 2
  view.setUint16(32, 2, true);              // block align: channels × 2
  view.setUint16(34, 16, true);             // bits per sample

  ascii(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let index = 0; index < pcm.length; index += 1) {
    view.setInt16(WAV_HEADER_BYTES + index * 2, pcm[index], true);
  }

  return buffer;
}

/** Seconds of audio in a sample count, at the target rate. */
export function secondsOf(sampleCount: number, sampleRate = TARGET_SAMPLE_RATE): number {
  return sampleCount / sampleRate;
}
