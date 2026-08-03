import { readFileSync } from 'node:fs';
const src = readFileSync('app/api/chat/route.ts', 'utf8');
const start = src.indexOf('/* Operations that only make sense');
const end = src.indexOf('\n}\n', src.indexOf('function imageGenerationIntent')) + 2;
const body = src.slice(start, end)
  .replace(/function imageGenerationIntent\(text: string, hasImageAttachment: boolean\): boolean/, 'function imageGenerationIntent(text, hasImageAttachment)')
  .replace(/: RegExp/g, '');
const fn = new Function(`${body}; return imageGenerationIntent;`)();

let pass = 0, fail = 0;
const check = (label, text, hasImg, expected) => {
  const got = fn(text, hasImg);
  const ok = got === expected; ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: "${text}"${ok ? '' : ` — got ${got}, want ${expected}`}`);
};

console.log('--- SCREENSHOT + QUESTION → must NOT be an image edit ---');
for (const t of [
  'can you fix this',
  "what's wrong here, can you fix it",
  'how do i make this work',
  'help me correct this code',
  'can you add error handling to this',
  'why does this error keep happening',
  'what does this screenshot say',
  'read the error in this screenshot',
  'explain what is happening here',
  'is this the right approach',
  'review this and tell me what to change',
  "i don't understand this error",
  'check this for me',
  'look at this and make it better',
  "don't change anything, just tell me what's wrong"
]) check('analysis', t, true, false);

console.log('\n--- REAL EDIT REQUESTS → must STILL be an image edit ---');
for (const t of [
  'remove the background',
  'make the background white',
  'brighten this',
  'crop this to a square',
  'upscale this',
  'retouch the skin',
  'change the sky to sunset',
  'fix the lighting in this photo',
  "swap the date but don't change the numbers",
  'make it look professional, keep the face the same',
  'recolor the logo to blue',
  'blur the background'
]) check('edit', t, true, true);

console.log('\n--- GENERATION (no attachment) → unchanged ---');
check('generate', 'make me a picture of a fox', false, true);
check('generate', 'draw me a castle', false, true);
check('chat', 'how do i fix this bug', false, false);
check('chat', 'remove the background noise from my life', false, false);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
