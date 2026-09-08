/// <reference lib="webworker" />
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
env.allowLocalModels=false;
env.useBrowserCache=true;
if(env.backends.onnx.wasm)env.backends.onnx.wasm.numThreads=1;
let extractor:FeatureExtractionPipeline|null=null;
let queue=Promise.resolve();
let idle:ReturnType<typeof setTimeout>|undefined;
self.addEventListener('message',(event:MessageEvent<{id:string;texts:string[]}>)=>{
  queue=queue.then(async()=>{
    if(idle)clearTimeout(idle);
    const {id,texts}=event.data;
    try{
      if(!Array.isArray(texts)||texts.length>256||texts.some(text=>typeof text!=='string'||text.length>2400))throw new Error('Embedding batch exceeds limits');
      extractor??=await pipeline('feature-extraction','onnx-community/all-MiniLM-L6-v2-ONNX',{device:'wasm',dtype:'q8',revision:'aff7a1dc4e8a1ea593e6ea21e95c22ef0a25966f'});
      const vectors:number[][]=[];
      for(let i=0;i<texts.length;i+=8){const output=await extractor(texts.slice(i,i+8),{pooling:'mean',normalize:true});vectors.push(...output.tolist() as number[][]);self.postMessage({id,progress:Math.min(texts.length,i+8),total:texts.length});}
      self.postMessage({id,ok:true,vectors});
    }catch(error){self.postMessage({id,ok:false,error:error instanceof Error?error.message:'Local embeddings are unavailable'});}
    finally{idle=setTimeout(()=>{const previous=extractor;extractor=null;void previous?.dispose();},60_000);}
  });
});
