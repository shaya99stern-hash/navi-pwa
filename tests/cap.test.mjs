import { readFileSync } from 'node:fs';
const src = readFileSync('app/api/chat/route.ts','utf8');
const line = src.split('\n').find(l => l.startsWith('const CAPABILITY_REQUEST'));
const re = eval(line.slice(line.indexOf('=')+1).replace(/;$/,''));
let pass=0,fail=0;
const check=(t,e)=>{const g=re.test(t);const ok=g===e;ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${e?'YES':'no '}  "${t}"`)};
console.log('--- should offer a capability ---');
[ 'add this capability to your skills',
  'can you learn this skill',
  'remember this method for future conversations',
  'save this as a playbook',
  'install a skill for writing invoices',
  'find a skill for hebrew dates and save it',
  'teach you a workflow for code review',
  'create a capability for triaging bugs',
  'from now on always use this format, remember it',
].forEach(t=>check(t,true));
console.log('\n--- ordinary requests must NOT ---');
[ 'hi',
  'what skills do you have',
  'can you fix this bug',
  'write me a poem',
  'add error handling to this function',
  'create a react component',
  'i need a method to sort this array',
  'remember when we talked about the api',
].forEach(t=>check(t,false));
console.log(`\n${pass}/${pass+fail} passed`);
process.exit(fail?1:0);
