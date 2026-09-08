import type { APIRoute } from 'astro';
import { NaviRouter,eventStream } from '../../lib/ai/router';
import { MCPBus } from '../../lib/tools/mcp-bus';
import { registerBuiltins } from '../../lib/tools/builtins';
import { loadConnections } from '../../lib/tools/registry-config';
import { configuredModels } from '../../lib/server/config';
import { userId,sameOrigin } from '../../lib/server/auth';
import type { Message } from '../../lib/types';
const health=new Map();
const active=new Set<string>();
export const POST:APIRoute=async({request})=>{
  if(!sameOrigin(request))return new Response('Origin rejected',{status:403});
  const principal=await userId(request);if(!principal)return new Response('Sign in to continue',{status:401});
  if(active.has(principal))return new Response('A response is already running',{status:429});
  const bytes=await request.arrayBuffer();if(bytes.byteLength>150_000)return new Response('Request too large',{status:413});
  let body:any;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return new Response('Invalid JSON',{status:400});}
  if(!Array.isArray(body.messages)||body.messages.length>60||body.messages.some((m:any)=>!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>60_000))return new Response('Invalid conversation',{status:400});
  const bus=new MCPBus();registerBuiltins(bus,process.env);
  let nodes;try{nodes=configuredModels(process.env);}catch{return new Response('Model configuration is invalid',{status:503});}
  active.add(principal);
  const router=new NaviRouter({nodes,bus,health});
  async function* run(){try{try{await loadConnections(bus,process.env);}catch{yield{type:'status' as const,message:'One connection is unavailable; continuing with available tools.'};}yield*router.run({messages:body.messages as Message[],signal:request.signal,principal:principal!,allowPaid:process.env.NAVI_ALLOW_PAID==='true'});}finally{active.delete(principal!);await bus.close();}}
  return eventStream(run(),request.signal);
};
