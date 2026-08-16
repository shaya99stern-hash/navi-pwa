/**
 * Raw microphone samples, on the audio thread.
 *
 * The recorder used to be a MediaRecorder, which hands back an encoded
 * container — WebM on Chrome, MP4 on Safari, Ogg on Firefox — and nothing
 * else. Three consequences followed from that one fact, and all three were
 * felt as "the microphone is broken":
 *
 *  - The container had to be negotiated with the transcriber, so a rejected
 *    MIME type surfaced to the user as a failed recording.
 *  - A container cannot be cut. Only the first chunk of a fragmented MP4 or
 *    WebM stream carries the header, so the obvious way to transcribe while
 *    someone is still speaking — slice the stream, upload the pieces — cannot
 *    be done with it. Which is why the whole recording had to finish before
 *    any of it could be sent, and why the wait after Stop existed at all.
 *  - There was no signal to reason about. Speech detection, silence trimming
 *    and segment boundaries all need samples, and MediaRecorder never exposes
 *    them.
 *
 * This node exists to hand the main thread the samples themselves. Everything
 * that matters downstream — resampling, the noise floor, endpointing, where a
 * segment is allowed to be cut, the WAV bytes that get uploaded — is then
 * ordinary code operating on numbers rather than a negotiation with a codec.
 *
 * It does exactly one thing beyond that: batching. `process` is called every
 * 128 samples, which at 48 kHz is 375 messages a second per channel. Nothing
 * downstream wants that granularity, and the postMessage traffic alone is
 * enough to show up on a phone. Frames are accumulated to the size the caller
 * asks for and transferred rather than copied.
 */

const DEFAULT_FRAME = 1024;

class NaviCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const requested = Number(options?.processorOptions?.frameSize);
    this.frame = new Float32Array(Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_FRAME);
    this.filled = 0;
    this.running = true;
    /* The only way to stop a worklet node is to have `process` return false;
       disconnecting it leaves it alive and scheduled. */
    this.port.onmessage = (event) => {
      if (event.data === "stop") this.running = false;
    };
  }

  process(inputs) {
    if (!this.running) return false;

    const channel = inputs[0]?.[0];
    /* No input this quantum is normal rather than exceptional — it happens
       between the node being connected and the stream being routed to it, and
       again whenever the OS hands the microphone to something else. Returning
       false here would silently retire the node and the recording would end
       with no error anywhere. */
    if (!channel) return true;

    const frame = this.frame;
    const size = frame.length;
    for (let index = 0; index < channel.length; index += 1) {
      frame[this.filled] = channel[index];
      this.filled += 1;
      if (this.filled === size) {
        /* Transferred, not copied: `frame` is reused for the next batch, so
           the message has to own its buffer. */
        const batch = frame.slice();
        this.port.postMessage(batch, [batch.buffer]);
        this.filled = 0;
      }
    }

    return true;
  }
}

registerProcessor("navi-capture", NaviCaptureProcessor);
