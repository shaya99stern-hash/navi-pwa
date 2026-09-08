import type { ParsedDocument } from '../workers/document-parser';
import type { StoredDocument } from '../storage/store';
export function ingest(file: File, signal?: AbortSignal): Promise<ParsedDocument> {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('../workers/document-parser.ts',import.meta.url),{type:'module'});const id=crypto.randomUUID();
    const cleanup=()=>{clearTimeout(timer);worker.terminate();signal?.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();reject(new Error('Document parsing stopped'));};
    const timer=setTimeout(()=>{cleanup();reject(new Error('Document parsing exceeded 60 seconds'));},60_000);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
    worker.onmessage=event=>{if(event.data.id!==id)return;cleanup();if(event.data.ok)resolve(event.data.result);else reject(new Error(event.data.error));};
    worker.onerror=()=>{cleanup();reject(new Error('The document worker could not start on this browser'));};
    void file.arrayBuffer().then(buffer=>{worker.postMessage({id,name:file.name,buffer,renderPages:true},[buffer]);},error=>{cleanup();reject(error);});
  });
}

/** Bounded lexical retrieval remains available offline, including before embedding weights are loaded. */
export function relevantChunks(query: string, documents: StoredDocument[], budget = 12_000): string {
  const terms=new Set(query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)??[]);
  const ranked=documents.flatMap(document=>document.chunks.map((chunk,index)=>({document,chunk,index,score:[...terms].reduce((score,word)=>score+(chunk.text.toLowerCase().includes(word)?Math.log(1+word.length):0),0)}))).sort((a,b)=>b.score-a.score);
  let result='';for(const item of ranked){const entry=`\n[Document: ${item.document.name}; ${item.chunk.page?'page '+item.chunk.page:'chunk '+(item.index+1)}]\n${item.chunk.text}\n`;if(result.length+entry.length>budget)continue;result+=entry;if(result.length>budget-1000)break;}return result;
}
