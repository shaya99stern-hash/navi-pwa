export type ParseEvent = { type: 'text' | 'thought' | 'action' | 'artifact'; value: string; done: boolean; attributes?: Record<string, string> } | { type: 'error'; value: string; done: true };
type Mode = 'text' | 'thought' | 'action' | 'artifact';
const starts = ['<thought', '<action', '<artifact', '```navi-artifact'];

/** Incremental framing, independent of network chunk boundaries. Thought bodies are discarded. */
export class StreamParser {
  private pending = '';
  private mode: Mode = 'text';
  private closing = '';
  private attributes: Record<string, string> = {};
  private bodyBytes = 0;
  private failed = false;
  constructor(private readonly maxBodyBytes = 180_000) {}

  push(chunk: string): ParseEvent[] {
    if (this.failed) return [];
    this.pending += chunk;
    const events: ParseEvent[] = [];
    while (this.pending.length) {
      if (this.mode === 'text') {
        let earliest = -1, marker = '';
        for (const start of starts) { const i = this.pending.indexOf(start); if (i >= 0 && (earliest < 0 || i < earliest)) { earliest = i; marker = start; } }
        if (earliest < 0) {
          const keep = this.ambiguousSuffix(this.pending, starts);
          const value = this.pending.slice(0, this.pending.length - keep);
          if (value) events.push({ type: 'text', value, done: false });
          this.pending = this.pending.slice(this.pending.length - keep); break;
        }
        if (earliest > 0) { events.push({ type: 'text', value: this.pending.slice(0, earliest), done: false }); this.pending = this.pending.slice(earliest); }
        const delimiter = marker.startsWith('```') ? '\n' : '>';
        const end = this.pending.indexOf(delimiter);
        if (end < 0) { if (this.pending.length > 2048) return this.fail('An opening tag exceeded the size limit.'); break; }
        const header = this.pending.slice(0, end + 1);
        this.attributes = {};
        for (const attr of header.matchAll(/([a-zA-Z][\w-]*)\s*=\s*(["'])(.*?)\2/g)) this.attributes[attr[1]] = attr[3];
        this.mode = marker.includes('artifact') ? 'artifact' : marker === '<thought' ? 'thought' : 'action';
        this.closing = marker.startsWith('```') ? '```' : `</${this.mode}>`;
        this.bodyBytes = 0;
        this.pending = this.pending.slice(end + 1);
        events.push({ type: this.mode, value: '', done: false, attributes: this.attributes });
      } else {
        const end = this.pending.indexOf(this.closing);
        const keep = end < 0 ? this.ambiguousSuffix(this.pending, [this.closing]) : 0;
        const value = end < 0 ? this.pending.slice(0, this.pending.length - keep) : this.pending.slice(0, end);
        this.bodyBytes += new TextEncoder().encode(value).byteLength;
        if (this.bodyBytes > this.maxBodyBytes) return [...events, ...this.fail('A structured block exceeded the size limit.')];
        if (this.mode !== 'thought' && (value || end >= 0)) events.push({ type: this.mode, value, done: end >= 0, attributes: this.attributes });
        if (end < 0) { this.pending = this.pending.slice(this.pending.length - keep); break; }
        this.pending = this.pending.slice(end + this.closing.length); this.mode = 'text'; this.closing = '';
      }
    }
    return events;
  }

  finish(): ParseEvent[] {
    if (this.failed) return [];
    if (this.mode !== 'text') return this.fail(`The ${this.mode} block was interrupted before its closing delimiter.`);
    const pending = this.pending; this.pending = '';
    if (starts.some(start => start.startsWith(pending)) && pending.startsWith('<')) return this.fail('An opening tag was interrupted.');
    return pending ? [{ type: 'text', value: pending, done: true }] : [];
  }
  private ambiguousSuffix(value: string, candidates: string[]): number {
    for (let n = Math.min(value.length, Math.max(...candidates.map(c => c.length))); n > 0; n--) if (candidates.some(c => c.startsWith(value.slice(-n)))) return n;
    return 0;
  }
  private fail(value: string): ParseEvent[] { this.failed = true; this.pending = ''; return [{ type: 'error', value, done: true }]; }
}

/** SSE decoder handles CRLF, UTF-8 boundaries and multiple data lines. */
export async function* readSSE(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = stream.getReader(); const decoder = new TextDecoder(); let buffer = '';
  const abort = () => { void reader.cancel(signal?.reason); }; signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted(); const { value, done } = await reader.read(); buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 1_000_000) throw new Error('SSE frame exceeded the size limit');
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (data) yield data;
      }
      if (done) { signal?.throwIfAborted(); break; }
    }
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
