import type { Artifact, Message } from '../types';
import { contentHash } from '../sandbox/runtime';
export type Thread = { id: string; title: string; messages: Message[]; updatedAt: number };
export type StoredDocument = { hash: string; name: string; text: string; chunks: { text: string; page?: number; vector?: number[] }[]; createdAt: number };
const request = <T>(value: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
const completed = (tx: IDBTransaction): Promise<void> => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted')); });

export class LocalStore extends EventTarget {
  private db: Promise<IDBDatabase>;
  constructor(namespace: string) {
    super();
    this.db = new Promise((resolve, reject) => {
      const open = indexedDB.open(`navisoul:${namespace}`, 1);
      open.onupgradeneeded = () => { const db = open.result; db.createObjectStore('threads', { keyPath: 'id' }); db.createObjectStore('documents', { keyPath: 'hash' }); const artifacts = db.createObjectStore('artifacts', { keyPath: ['id', 'version'] }); artifacts.createIndex('id', 'id'); db.createObjectStore('heads', { keyPath: 'id' }); };
      open.onsuccess = () => { open.result.onversionchange = () => open.result.close(); resolve(open.result); }; open.onerror = () => reject(open.error); open.onblocked = () => reject(new Error('Close older Navi tabs to upgrade storage'));
    });
  }
  async saveThread(thread: Thread): Promise<void> { const db = await this.db; const tx = db.transaction('threads', 'readwrite'); const done = completed(tx); tx.objectStore('threads').put(thread); await done; this.dispatchEvent(new Event('change')); }
  async threads(): Promise<Thread[]> { const db = await this.db; return (await request(db.transaction('threads').objectStore('threads').getAll()) as Thread[]).sort((a,b)=>b.updatedAt-a.updatedAt); }
  async saveDocument(document: StoredDocument): Promise<void> { const db=await this.db; const tx=db.transaction('documents','readwrite'); const done=completed(tx); tx.objectStore('documents').put(document); await done; this.dispatchEvent(new Event('change')); }
  async documents(): Promise<StoredDocument[]> { const db=await this.db; return request(db.transaction('documents').objectStore('documents').getAll()); }
  async versions(id: string): Promise<Artifact[]> { const db=await this.db; return request(db.transaction('artifacts').objectStore('artifacts').index('id').getAll(id)); }
  async heads(): Promise<Artifact[]> { const db=await this.db; return request(db.transaction('heads').objectStore('heads').getAll()); }
  async saveArtifact(artifact: Artifact, expectedHash?: string): Promise<Artifact> {
    if (artifact.hash !== await contentHash(artifact.kind+'\0'+artifact.source)) throw new Error('Artifact content hash does not match');
    const db=await this.db; const tx=db.transaction(['artifacts','heads'],'readwrite'); const done=completed(tx); void done.catch(()=>{});
    const heads=tx.objectStore('heads'); const head=await request(heads.get(artifact.id)) as Artifact|undefined;
    if (expectedHash && head?.hash !== expectedHash) { tx.abort(); throw new Error('The artifact changed while this edit was being prepared'); }
    if (head?.hash === artifact.hash) { await done; return head; }
    const next={...artifact,version:(head?.version??0)+1,parentHash:head?.hash,createdAt:Date.now()};
    tx.objectStore('artifacts').put(next); heads.put(next); await done; this.dispatchEvent(new Event('change')); return next;
  }
  async close(): Promise<void> { (await this.db).close(); }
}

/** Strict single-file unified diff: mismatched context rejects the entire update. */
export function applyUnifiedDiff(source: string, patch: string): string {
  const lines=source.split('\n'), chunks=patch.replace(/\r\n/g,'\n').split('\n'); const output:string[]=[]; let cursor=0, i=0, hunks=0;
  while(i<chunks.length) {
    const match=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(chunks[i++]); if(!match) continue;
    const start=Number(match[1])-(Number(match[2]??1)===0?0:1); if(start<cursor||start>lines.length) throw new Error('Patch hunk is out of order');
    output.push(...lines.slice(cursor,start)); cursor=start; let oldCount=0,newCount=0; hunks++;
    while(i<chunks.length&&!chunks[i].startsWith('@@')) {
      const line=chunks[i]; if(line.startsWith('--- ')||line.startsWith('+++ ')) throw new Error('Only a single artifact can be patched');
      if(line==='\\ No newline at end of file'){i++;continue;}
      if(!line && i===chunks.length-1){i++;break;}
      if(line[0]===' '||line[0]==='-') { if(lines[cursor]!==line.slice(1)) throw new Error('Patch context does not match the saved artifact'); if(line[0]===' ') {output.push(lines[cursor]);newCount++;} cursor++;oldCount++; }
      else if(line[0]==='+'){output.push(line.slice(1));newCount++;} else throw new Error('Malformed patch line'); i++;
    }
    if(oldCount!==Number(match[2]??1)||newCount!==Number(match[4]??1)) throw new Error('Patch hunk counts do not match');
  }
  if(!hunks) throw new Error('No patch hunks found'); return [...output,...lines.slice(cursor)].join('\n');
}
