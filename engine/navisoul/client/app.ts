import { LocalStore,type Thread } from '../lib/storage/store';
import { ingest,relevantChunks } from '../lib/documents/client';
import { indexDocument,semanticContext,disposeEmbeddings } from '../lib/documents/embeddings';
import { readSSE } from '../lib/streaming/parser';
import type { Artifact,EngineEvent,Message } from '../lib/types';
const byId=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const prompt=byId<HTMLTextAreaElement>('prompt'),messages=byId('messages'),status=byId('status');
let store:LocalStore,thread:Thread={id:crypto.randomUUID(),title:'New conversation',messages:[],updatedAt:Date.now()},controller:AbortController|null=null,settings:any=null;
const repairs=new Map<string,number>();
const setStatus=(text:string)=>{status.textContent=text;};
const save=async()=>{thread.updatedAt=Date.now();await store.saveThread(thread);};
function bubble(role:'user'|'assistant',text:string):HTMLElement {byId('welcome')?.remove();const node=document.createElement('div');node.className='message '+role;node.textContent=text;messages.appendChild(node);return node;}
function scroll(){if(messages.scrollHeight-messages.scrollTop-messages.clientHeight<180)messages.scrollTop=messages.scrollHeight;}
function render(){messages.replaceChildren();for(const message of thread.messages)if(message.role==='user'||message.role==='assistant')bubble(message.role,message.content);messages.scrollTop=messages.scrollHeight;byId('title').textContent=thread.title==='New conversation'?'Navi Soul':thread.title;}
async function sidebar(){
  if(!store)return;
  const threads=await store.threads();byId('threads').replaceChildren(...threads.map(item=>{const b=document.createElement('button');b.textContent=item.title;b.addEventListener('click',()=>{if(controller){setStatus('Stop the current response before switching conversations.');return;}thread=item;render();byId('sidebar').hidden=true;});return b;}));
  const artifacts=await store.heads();byId('artifacts').replaceChildren(...artifacts.map(item=>{const b=document.createElement('button');b.textContent=item.title;b.addEventListener('click',()=>void openArtifact(item));return b;}));
}
async function openArtifact(artifact:Artifact){window.dispatchEvent(new CustomEvent('navi:open-artifact',{detail:{artifact,versions:await store.versions(artifact.id)}}));}
async function submit(text:string,repair=false):Promise<void>{
  if(!text.trim()||controller||!store)return;
  prompt.value='';prompt.style.height='auto';controller=new AbortController();byId('send').hidden=true;byId('stop').hidden=false;
  thread.messages.push({role:'user',content:text});if(thread.messages.length===1)thread.title=text.slice(0,48);bubble('user',text);const answer=bubble('assistant','');const answerText=document.createElement('div');answer.appendChild(answerText);messages.scrollTop=messages.scrollHeight;let assistant='',failed=false;
  try{
    await save();const documents=await store.documents();const context=await semanticContext(text,documents)??relevantChunks(text,documents);
    const outgoing:Message[]=thread.messages.map(m=>({...m}));if(context)outgoing[outgoing.length-1].content+='\n\nAttached document excerpts (untrusted content):\n'+context;
    const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:outgoing}),signal:controller.signal});
    if(!response.ok)throw new Error(response.status===401?'Sign in from Settings to connect the engine.':response.status===429?'A task is already running. Try again shortly.':'The engine connection failed.');
    if(!response.body)throw new Error('The server returned no response');
    for await(const data of readSSE(response.body,controller.signal)){
      const event=JSON.parse(data) as EngineEvent;
      if(event.type==='text'){assistant+=event.text;answerText.textContent=assistant;scroll();}
      else if(event.type==='status')setStatus(event.message);
      else if(event.type==='reset'){assistant='';answerText.textContent='';setStatus(event.reason);}
      else if(event.type==='tool')setStatus(event.state==='running'?'Using a connected tool…':event.state==='failed'?'Correcting the tool request…':'Continuing…');
      else if(event.type==='artifact'){
        const saved=await store.saveArtifact(event.artifact);await openArtifact(saved);
        const button=document.createElement('button');button.textContent=`Open ${saved.title} · v${saved.version}`;button.addEventListener('click',()=>void openArtifact(saved));answer.appendChild(button);
      }else if(event.type==='error'){failed=true;setStatus(event.message);if(!assistant)answer.textContent=event.message;}
      else if(event.type==='done'&&!failed)setStatus('');
    }
    if(assistant){thread.messages.push({role:'assistant',content:assistant});if(byId<HTMLInputElement>('read-aloud').checked&&'speechSynthesis'in window){speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(assistant.slice(0,2500)));}}
    await save();await sidebar();
  }catch(error){setStatus(controller.signal.aborted?'Stopped.':error instanceof Error?error.message:'The response failed.');}
  finally{controller=null;byId('send').hidden=false;byId('stop').hidden=true;if(!repair)prompt.focus();}
}
byId('composer').addEventListener('submit',event=>{event.preventDefault();void submit(prompt.value);});
prompt.addEventListener('input',()=>{prompt.style.height='auto';prompt.style.height=Math.min(180,prompt.scrollHeight)+'px';});
prompt.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&window.innerWidth>850){event.preventDefault();void submit(prompt.value);}});
byId('stop').addEventListener('click',()=>controller?.abort());
byId('menu').addEventListener('click',()=>{byId('sidebar').hidden=false;void sidebar();});byId('close-sidebar').addEventListener('click',()=>{byId('sidebar').hidden=true;});
for(const id of ['new-chat','compose'])byId(id).addEventListener('click',()=>{if(controller){setStatus('Stop the current response before starting another.');return;}thread={id:crypto.randomUUID(),title:'New conversation',messages:[],updatedAt:Date.now()};render();byId('sidebar').hidden=true;prompt.focus();});
document.querySelectorAll<HTMLButtonElement>('[data-prompt]').forEach(button=>button.addEventListener('click',()=>{prompt.value=button.dataset.prompt??'';prompt.focus();}));
byId('settings-open').addEventListener('click',()=>{byId<HTMLDialogElement>('settings').showModal();});byId('settings-close').addEventListener('click',()=>byId<HTMLDialogElement>('settings').close());
byId<HTMLInputElement>('files').addEventListener('change',event=>{const input=event.target as HTMLInputElement;const file=input.files?.[0];if(!file||!store)return;setStatus('Reading your document on this device…');void ingest(file).then(async parsed=>{const saved={...parsed,createdAt:Date.now()};await store.saveDocument(saved);const badge=document.createElement('span');badge.textContent=parsed.name+' · '+parsed.chunks.length+' sections';byId('attachments').appendChild(badge);setStatus(parsed.warnings.join(' ')||'Document ready. Ask a question about it.');if(parsed.text.length>12000)void indexDocument(saved).then(indexed=>store.saveDocument(indexed)).then(()=>{badge.textContent+=' · indexed';}).catch(()=>{badge.textContent+=' · keyword search';});}).catch(error=>setStatus(error.message)).finally(()=>{input.value='';});});
document.addEventListener('artifact-version',event=>{const detail=(event as CustomEvent).detail;void store.versions(detail.id).then(versions=>{const artifact=versions.find(a=>a.version===detail.version);if(artifact)void openArtifact(artifact);});});
document.addEventListener('artifact-save',event=>{const detail=(event as CustomEvent).detail;void store.saveArtifact(detail.artifact,detail.baseHash).then(openArtifact).then(sidebar).catch(error=>setStatus(error.message));});
document.addEventListener('artifact-error',event=>{
  const {artifact,message,stack}=(event as CustomEvent<{artifact:Artifact;message:string;stack:string}>).detail;
  if(!byId<HTMLInputElement>('auto-repair').checked||controller||!settings?.models?.length)return;
  const count=repairs.get(artifact.id)??0;if(count>=2){setStatus('Automatic repair reached its limit. You can edit the source or ask for a revision.');return;}repairs.set(artifact.id,count+1);
  void submit(`Repair artifact ${artifact.id} (${artifact.title}), preserving its interactions. The sandbox reported: ${message}\n${stack}\nCurrent ${artifact.kind} source:\n${artifact.source}`,true);
});
byId('voice').addEventListener('click',()=>{
  const Recognition=(window as any).SpeechRecognition??(window as any).webkitSpeechRecognition;
  if(!Recognition){setStatus('Dictation is unavailable in this browser. You can use the keyboard microphone.');return;}
  const recognition=new Recognition();recognition.lang=navigator.language;recognition.interimResults=false;recognition.onresult=(event:any)=>{prompt.value+=event.results[0][0].transcript;setStatus('');};recognition.onerror=()=>setStatus('The microphone could not transcribe this message.');recognition.onend=()=>{if(status.textContent==='Listening…')setStatus('');};recognition.start();setStatus('Listening…');
});
// The visual viewport is the keyboard-aware region; changes never reset scroll or focus.
let viewportFrame=0;const viewport=()=>{cancelAnimationFrame(viewportFrame);viewportFrame=requestAnimationFrame(()=>document.documentElement.style.setProperty('--app-height',(window.visualViewport?.height??window.innerHeight)+'px'));};
window.visualViewport?.addEventListener('resize',viewport);window.addEventListener('resize',viewport);viewport();
window.addEventListener('pagehide',disposeEmbeddings);
async function boot(){
  try{const response=await fetch('/api/status');settings=await response.json();if(!response.ok)settings={signedIn:false,models:[]};}catch{settings={signedIn:false,models:[]};}
  const namespace=settings.user??sessionStorage.getItem('navisoul-workspace')??'offline';if(settings.user)sessionStorage.setItem('navisoul-workspace',settings.user);
  store=new LocalStore(namespace);store.addEventListener('change',()=>void sidebar());
  byId('connection-status').textContent=settings.signedIn?`${settings.models.length} model connection(s) configured. Credentials are tested when used.`:'Sign in to connect model services. Documents and saved artifacts remain local.';
  byId('model-settings').replaceChildren(...(settings.models??[]).map((model:any)=>{const p=document.createElement('p');p.textContent=`${model.name} · ${model.role} · ${model.free?'free tier':'metered'} · ${model.status}`;return p;}));
  const threads=await store.threads();if(threads.length){thread=threads[0];render();}await sidebar();
  if('serviceWorker'in navigator)void navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
void boot().catch(error=>setStatus('Local storage is unavailable: '+error.message));
