import type { StoredDocument } from '../storage/store';
let worker:Worker|null=null;
const pending=new Map<string,{resolve:(vectors:number[][])=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
export function embed(texts:string[],timeoutMs=90_000):Promise<number[][]>{
  if(!worker){worker=new Worker(new URL('../workers/embeddings.ts',import.meta.url),{type:'module'});worker.onmessage=event=>{if('progress'in event.data)return;const entry=pending.get(event.data.id);if(!entry)return;pending.delete(event.data.id);clearTimeout(entry.timer);if(event.data.ok)entry.resolve(event.data.vectors);else entry.reject(new Error(event.data.error));};worker.onerror=()=>disposeEmbeddings();}
  const id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Local semantic indexing timed out'));if(!pending.size){worker?.terminate();worker=null;}},timeoutMs);pending.set(id,{resolve,reject,timer});worker!.postMessage({id,texts});});
}
export function disposeEmbeddings(){worker?.terminate();worker=null;for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(new Error('Local embedding worker stopped'));}pending.clear();}
export async function indexDocument(document:StoredDocument):Promise<StoredDocument>{
  const chunks=document.chunks.map(chunk=>({...chunk}));
  for(let i=0;i<chunks.length;i+=128){const vectors=await embed(chunks.slice(i,i+128).map(chunk=>chunk.text));vectors.forEach((vector,index)=>{chunks[i+index].vector=vector;});}
  return {...document,chunks};
}
export async function semanticContext(query:string,documents:StoredDocument[],budget=12000):Promise<string|null>{
  const chunks=documents.flatMap(document=>document.chunks.filter(chunk=>chunk.vector?.length===384).map(chunk=>({document,chunk})));if(!chunks.length)return null;
  try{const [vector]=await embed([query.slice(0,2000)],2500);const ranked=chunks.map(item=>({...item,score:item.chunk.vector!.reduce((sum,value,index)=>sum+value*vector[index],0)})).sort((a,b)=>b.score-a.score);let output='';for(const item of ranked){const text=`\n[${item.document.name}${item.chunk.page?'; page '+item.chunk.page:''}]\n${item.chunk.text}\n`;if(output.length+text.length<=budget)output+=text;}return output;}catch{return null;}
}
