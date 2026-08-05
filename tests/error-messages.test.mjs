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
/* The spec's rule, replacing an earlier one of mine that required every error
   to say "NaviSol". It does not need to: the user knows who they are talking
   to, and the words are better spent on the next step. What matters is that no
   error apologises — an apology is not information, and repeated it reads as
   evasion — and that every one of them says what to do. */
const APOLOGY = /\b(sorry|apolog|unfortunately|regret)\b/i;
check('no message apologises', cases.some((c) => APOLOGY.test(streamError(c))), false);
check('every message says what to do next', cases.every((c) => /\b(retry|add one|lower the effort)\b/i.test(streamError(c))), true);

/* A misconfigured deployment is a permanent state, not an outage. Calling it
   "temporarily unavailable" cost a real debugging session: the chat card offers
   a Try again button, the button cannot succeed, and the app reads as flaky
   rather than as missing a credential. The wording has to say which it is. */
const authApi = readFileSync('lib/auth/api.ts', 'utf8');
const authMessages = [...authApi.matchAll(/error: "([^"]+)"/g)].map((match) => match[1]);
check('the auth route has messages to check', authMessages.length > 0, true);
check(
  'a missing credential is not described as temporary',
  authMessages.some((message) => /\b(temporarily|try again|for now|right now)\b/i.test(message)),
  false
);
check(
  'a missing credential names the deployment as the cause',
  authMessages.some((message) => /not configured on this deployment/i.test(message)),
  true
);
/* The server log has to name which half is absent — with both halves silently
   optional, the difference between "no Clerk" and "half a Clerk" is otherwise
   invisible from outside. */
check('the gap is logged, not just returned', authApi.includes('describeClerkConfigGap()'), true);
check('no message apologises there either', authMessages.some((m) => APOLOGY.test(m)), false);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
