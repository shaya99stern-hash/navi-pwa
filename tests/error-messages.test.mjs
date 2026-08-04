import { readFileSync } from 'node:fs';

/* Mirrors streamError in app/api/chat/route.ts. The invariant under test is
   that no provider text reaches the user: a provider echoed its own retirement
   notice into a chat bubble, naming a third party and telling the user nothing
   they could act on. */
const src = readFileSync('app/api/chat/route.ts', 'utf8');
const body = src.slice(src.indexOf('function streamError'), src.indexOf('\n}\n', src.indexOf('function streamError')) + 2)
  .replace(/: unknown/g, '').replace(/: string/g, '');
const streamError = new Function(`${body}; return streamError;`)();

let pass = 0, fail = 0;
const check = (n, a, e) => { const ok = a === e; ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : `\n   got: ${a}`}`); };

// The exact string that reached production.
const retirement = new Error("GitHub Models is temporarily unavailable as part of a scheduled retirement brownout.");
const out = streamError(retirement);
check('the retirement notice is not echoed', out.includes('retirement'), false);
check('no provider is named', /github|openai|gemini|groq|deepseek|hugging|cerebras|mistral|anthropic/i.test(out), false);

// Every branch must be generic, whatever the provider said.
const cases = [
  new Error('GitHub Models 404: model not found'),
  new Error('Gemini returned 403: API keys with referer restrictions'),
  new Error('groq/compound: tool calling is not supported with this model'),
  new Error('DeepSeek rate limit exceeded, retry-after 60'),
  new Error('Cerebras timeout after 30000ms'),
  new Error('unknown'),
  'a bare string failure'
];
for (const value of cases) {
  const message = streamError(value);
  const named = /github|openai|gemini|groq|deepseek|hugging|cerebras|mistral|anthropic|compound/i.test(message);
  if (named) { fail++; console.log(`FAIL  provider leaked for: ${value}\n   got: ${message}`); }
}
check('no branch leaks a provider name', true, true);

// Still useful, not just safe: a credential failure must point somewhere.
check('a 403 points at configuration', streamError(new Error('403 Forbidden')).includes('Settings'), true);
check('a 401 points at configuration', streamError(new Error('401 unauthorized api key')).includes('Settings'), true);
check('a timeout suggests lowering effort', streamError(new Error('request timeout')).includes('effort'), true);
// One message, one voice.
check('every message names NaviSol', cases.every((c) => streamError(c).includes('NaviSol')), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
