/// <reference lib="webworker" />
import { extractOffice } from '../documents/office';
export type DocumentJob = { id: string; name: string; buffer: ArrayBuffer; renderPages?: boolean };
export type ParsedDocument = { hash: string; name: string; text: string; chunks: { text: string; page?: number }[]; images: { page: number; blob: Blob }[]; warnings: string[] };
const MAX_BYTES = 25_000_000, MAX_TEXT = 2_000_000;
const decode = (value: Uint8Array) => new TextDecoder().decode(value);

export function parseCSV(text: string): string[][] {
  const rows: string[][]=[]; let row:string[]=[], cell='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') { if(quoted&&text[i+1]==='"'){cell+='"';i++;} else if(quoted||cell==='') quoted=!quoted; else cell+=c; }
    else if(c===','&&!quoted){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';if(rows.length>100_000)throw new Error('CSV exceeds 100,000 rows');}
    else cell+=c;
    if(row.length>10_000||cell.length>MAX_TEXT)throw new Error('CSV field limits exceeded');
  }
  if(quoted)throw new Error('CSV has an unfinished quoted field');
  if(cell||row.length){row.push(cell);rows.push(row);}return rows;
}

export function chunkText(text: string, page?: number): { text: string; page?: number }[] {
  const chunks: {text:string;page?:number}[]=[]; let pending='';
  for(const paragraph of text.split(/\n\s*\n/)) {
    if(pending.length+paragraph.length>1800 && pending){chunks.push({text:pending.trim(),page});pending=pending.slice(-180);}
    pending+=(pending?'\n\n':'')+paragraph;
    while(pending.length>2200){let end=pending.lastIndexOf(' ',1800);if(end<900)end=1800;chunks.push({text:pending.slice(0,end),page});pending=pending.slice(end-150);}
  }
  if(pending.trim())chunks.push({text:pending.trim(),page});return chunks;
}

export async function parseDocument(job: DocumentJob): Promise<ParsedDocument> {
  if(job.buffer.byteLength>MAX_BYTES)throw new Error('Documents are limited to 25 MB');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',job.buffer)),b=>b.toString(16).padStart(2,'0')).join('');
  const result:ParsedDocument={hash,name:job.name,text:'',chunks:[],images:[],warnings:[]};
  const extension=job.name.split('.').pop()?.toLowerCase();
  if(extension==='pdf') {
    const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc=(await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
    const loading=pdfjs.getDocument({data:new Uint8Array(job.buffer),isEvalSupported:false,useSystemFonts:true});
    const document=await loading.promise;
    try {
      if(document.numPages>200)throw new Error('PDFs are limited to 200 pages');
      for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++) {
        const page=await document.getPage(pageNumber);const text=await page.getTextContent();
        const lines=text.items.map(item=>'str' in item?item.str+('hasEOL' in item&&item.hasEOL?'\n':' '):'').join('');
        result.text+=`\n\n[Page ${pageNumber}]\n${lines}`;result.chunks.push(...chunkText(lines,pageNumber));
        if(result.text.length>MAX_TEXT)throw new Error('PDF extracted text exceeds 2 MB');
        if(job.renderPages&&result.images.length<4&&typeof OffscreenCanvas!=='undefined') {
          try {const original=page.getViewport({scale:1});const scale=Math.min(1.8,Math.sqrt(2_000_000/(original.width*original.height)));const viewport=page.getViewport({scale});const canvas=new OffscreenCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));const context=canvas.getContext('2d');if(context){await page.render({canvas:canvas as unknown as HTMLCanvasElement,canvasContext:context as unknown as CanvasRenderingContext2D,viewport}).promise;result.images.push({page:pageNumber,blob:await canvas.convertToBlob({type:'image/png'})});}}
          catch {result.warnings.push(`Page ${pageNumber} could not be rendered on this browser.`);}
        }
        page.cleanup();
      }
    } finally {await document.destroy();}
    if(!result.text.trim()||result.chunks.length===0)result.warnings.push('No text layer was found. This PDF needs OCR or a vision model.');
    return result;
  }
  if(extension==='docx'||extension==='xlsx') {
    const office=extractOffice(job.buffer,job.name);result.text=office.text;result.warnings.push(...office.warnings);
  } else if(extension==='csv')result.text=parseCSV(decode(new Uint8Array(job.buffer))).map(row=>row.join('\t')).join('\n');
  else if(['txt','md','json','log'].includes(extension??''))result.text=decode(new Uint8Array(job.buffer));
  else throw new Error('Supported documents: PDF, DOCX, XLSX, CSV, TXT, Markdown and JSON');
  if(result.text.length>MAX_TEXT)throw new Error('Extracted text exceeds 2 MB');result.chunks=chunkText(result.text);return result;
}

// This guard also permits direct parser tests outside a worker.
if(typeof WorkerGlobalScope!=='undefined'&&self instanceof WorkerGlobalScope) {
  self.addEventListener('message',async(event:MessageEvent<DocumentJob>)=>{try{const result=await parseDocument(event.data);self.postMessage({id:event.data.id,ok:true,result});}catch(error){self.postMessage({id:event.data.id,ok:false,error:error instanceof Error?error.message:'Document parsing failed'});}});
}
