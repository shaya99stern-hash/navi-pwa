import { parse } from 'acorn';
import { transform } from 'sucrase';
import type { Artifact, ArtifactKind } from '../types';
const kinds = new Set<ArtifactKind>(['html', 'react', 'vue', 'svg', 'mermaid', 'latex', 'markdown']);
export async function contentHash(content: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))), b => b.toString(16).padStart(2, '0')).join('');
}
export async function validateArtifact(input: Record<string, unknown>): Promise<Artifact> {
  let source = String(input.source ?? ''); let kind = String(input.kind ?? 'html') as ArtifactKind;
  // A fenced block may carry metadata on its first line instead of tag attributes.
  if (source.trimStart().startsWith('{') && source.includes('\n---\n')) {
    const cut = source.indexOf('\n---\n'); const metadata = JSON.parse(source.slice(0, cut)); input = { ...input, ...metadata }; source = source.slice(cut + 5); kind = String(input.kind ?? 'html') as ArtifactKind;
  }
  if (!kinds.has(kind)) throw new Error('Unsupported artifact kind');
  if (new TextEncoder().encode(source).byteLength > 180_000 || !source.trim()) throw new Error('Artifact content is empty or exceeds 180 KB');
  if (kind === 'html' || kind === 'svg') {
    const open = source.match(/<script\b[^>]*>/gi) ?? [], close = source.match(/<\/script\s*>/gi) ?? [];
    if (open.length !== close.length) throw new Error('A script was cut off');
    for (const script of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (/\bsrc\s*=/.test(script[1])) throw new Error('Remote scripts are unavailable');
      if (!/application\/(?:ld\+)?json/.test(script[1])) parse(script[2], { ecmaVersion: 'latest', sourceType: /type=["']module/.test(script[1]) ? 'module' : 'script' });
    }
  } else if (kind === 'react' || kind === 'vue') compileComponent(source);
  const id = typeof input.id === 'string' && /^[\w-]{1,80}$/.test(input.id) ? input.id : crypto.randomUUID();
  return { id, title: String(input.title ?? 'Untitled artifact').slice(0, 120), source, kind, version: 1, hash: await contentHash(kind + '\0' + source), createdAt: Date.now() };
}

export function compileComponent(source: string): string {
  const result = transform(source, { transforms: ['typescript', 'jsx', 'imports'], jsxRuntime: 'classic', production: true }).code;
  const tree = parse(result, { ecmaVersion: 'latest', sourceType: 'script' });
  // Check every require call, including user-authored ones, before the isolated runtime receives it.
  const stack: unknown[] = [tree];
  while (stack.length) {
    const node = stack.pop(); if (!node || typeof node !== 'object') continue;
    const n = node as Record<string, any>;
    if (n.type === 'CallExpression' && n.callee?.name === 'require' && (n.arguments?.length !== 1 || !['react', 'react-dom/client', 'vue'].includes(n.arguments[0]?.value))) throw new Error('Only React, ReactDOM and Vue imports are bundled');
    for (const value of Object.values(n)) if (Array.isArray(value)) stack.push(...value); else if (value && typeof value === 'object') stack.push(value);
  }
  return result;
}

export type RuntimeError = { type: 'sandbox:error'; nonce: string; message: string; stack?: string };
const safeScript = (value: string) => value.replace(/<\/script/gi, '<\\/script');
const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
export async function sandboxDocument(artifact: Artifact, nonce: string): Promise<string> {
  let bundle = '', content = artifact.source, start = '';
  if (artifact.kind === 'react') {
    bundle = (await import('./generated/react.js?raw')).default;
    start = `window.React=NaviReact.React;const exports={};const require=n=>n==='react'?NaviReact.React:NaviReact.ReactDOM;${compileComponent(content)};NaviReact.ReactDOM.createRoot(document.getElementById('root')).render(NaviReact.React.createElement(exports.default));`;
    content = '<div id="root"></div>';
  } else if (artifact.kind === 'vue') {
    bundle = (await import('./generated/vue.js?raw')).default;
    start = `const exports={};const require=()=>NaviVue;${compileComponent(content)};NaviVue.createApp(exports.default).mount('#root');`;
    content = '<div id="root"></div>';
  } else if (artifact.kind === 'mermaid') {
    bundle = (await import('./generated/mermaid.js?raw')).default;
    start = `NaviMermaid.default.initialize({startOnLoad:false,securityLevel:'strict'});NaviMermaid.default.render('diagram',${json(content)}).then(result=>{document.getElementById('root').innerHTML=result.svg}).catch(e=>{throw e});`;
    content = '<div id="root"></div>';
  } else if (artifact.kind === 'latex') {
    bundle = (await import('./generated/katex.js?raw')).default;
    const css = (await import('katex/dist/katex.min.css?raw')).default;
    start = `NaviKatex.render(${json(content)},document.getElementById('root'),{throwOnError:true,trust:false,output:'mathml',displayMode:true});`;
    content = `<style>${css}</style><div id="root"></div>`;
  } else if (artifact.kind === 'markdown') { start = `document.getElementById('root').textContent=${json(content)};`; content = '<pre id="root"></pre>'; }
  const bridge = `(()=>{const send=(type,detail)=>parent.postMessage({type,nonce:${json(nonce)},...detail},'*');let errors=0;const failure=e=>{if(errors++<3)send('sandbox:error',{message:String(e.message||e.reason||'Runtime error').slice(0,600),stack:String(e.error?.stack||e.reason?.stack||'').slice(0,1800)})};addEventListener('error',failure);addEventListener('unhandledrejection',failure);addEventListener('load',()=>send('sandbox:ready',{}));addEventListener('keydown',e=>{if(e.key==='Escape')send('sandbox:escape',{})});})();`;
  // Vue's template compiler needs eval only inside this opaque, network-disabled document.
  const evalPolicy = artifact.kind === 'vue' ? " 'unsafe-eval'" : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline' blob:${evalPolicy};style-src 'unsafe-inline';img-src data: blob:;font-src data:;connect-src 'none';worker-src blob:;form-action 'none';base-uri 'none'"><style>:root{color-scheme:dark;--navi-bg:#151719;--navi-fg:#f5f2ed;--navi-muted:#aaa;--navi-accent:#dbb883}body{margin:0;padding:18px;background:var(--navi-bg);color:var(--navi-fg);font:15px system-ui}*{box-sizing:border-box}button,input,select,textarea{font:inherit;min-height:44px}button{cursor:pointer}pre{white-space:pre-wrap}img,svg,canvas{max-width:100%}</style><script>${bridge}</script>${bundle ? `<script>${safeScript(bundle)}</script>` : ''}</head><body>${content}${start ? `<script>${safeScript(start)}</script>` : ''}</body></html>`;
}

/** A worker is killable; generated code never runs in the app's own global scope. */
export async function runIsolatedJavaScript(source: string, timeoutMs = 2000): Promise<unknown> {
  if(source.length>50_000)throw new Error('Program exceeds 50 KB');
  const workerSource = `self.onmessage=async()=>{try{const result=await(async()=>{${source}\n})();self.postMessage({ok:true,result})}catch(e){self.postMessage({ok:false,error:String(e)})}}`;
  const nonce=crypto.randomUUID();const frame=document.createElement('iframe');frame.hidden=true;frame.sandbox.add('allow-scripts');
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer);window.removeEventListener('message',receive);frame.remove(); };
    const receive=(event:MessageEvent)=>{if(event.source!==frame.contentWindow||event.data?.nonce!==nonce)return;cleanup();if(event.data.ok)resolve(event.data.result);else reject(new Error(String(event.data.error)));};
    const timer = setTimeout(() => { cleanup(); reject(new Error('Execution timed out')); }, Math.min(5000, timeoutMs));
    window.addEventListener('message',receive);
    frame.srcdoc=`<meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';worker-src blob:;connect-src 'none'"><script>const url=URL.createObjectURL(new Blob([${json(workerSource)}],{type:'text/javascript'}));const worker=new Worker(url);worker.onmessage=e=>{parent.postMessage({...e.data,nonce:${json(nonce)}},'*');worker.terminate();URL.revokeObjectURL(url)};worker.onerror=()=>parent.postMessage({ok:false,error:'Execution worker failed',nonce:${json(nonce)}},'*');worker.postMessage({});</script>`;
    document.body.appendChild(frame);
  });
}
