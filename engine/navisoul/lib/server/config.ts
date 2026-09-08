import type { ModelNode } from '../ai/router';
export function configuredModels(env:Record<string,string|undefined>):ModelNode[] {
  const raw=JSON.parse(env.NAVI_MODELS_JSON??'[]') as unknown;
  if(!Array.isArray(raw))throw new Error('NAVI_MODELS_JSON must be an array');
  return raw.slice(0,12).flatMap((entry:any)=>{
    if(!entry||typeof entry.endpoint!=='string'||typeof entry.model!=='string'||typeof entry.keyEnv!=='string')return[];
    const endpoint=new URL(entry.endpoint);if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)throw new Error('Model endpoints must be HTTPS');
    const key=env[entry.keyEnv];if(!key)return[];
    return[{id:String(entry.id??entry.model),endpoint:endpoint.href,key,model:entry.model,role:['fast','reasoning','critic'].includes(entry.role)?entry.role:'fast',free:entry.free===true,context:Math.min(200_000,Math.max(4000,Number(entry.context)||8000)),maxOutput:Math.min(12_000,Math.max(512,Number(entry.maxOutput)||6000)),tools:entry.tools===true,firstTokenMs:3000} as ModelNode];
  });
}
