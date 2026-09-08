import type { MCPBus,ToolSchema } from './mcp-bus';
export type RestIntegration={namespace:string;baseUrl:string;authorizationEnv?:string;operations:{name:string;description:string;method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE';path:string;inputSchema:ToolSchema}[]};
/** Declarative REST adapters use fixed origins; model arguments cannot redirect credentials. */
export function registerRestIntegration(bus:MCPBus,integration:RestIntegration,env:Record<string,string|undefined>):void{
  const base=new URL(integration.baseUrl);if(base.protocol!=='https:'||base.username||base.password)throw new Error('Integration requires HTTPS');
  if(integration.operations.length>200)throw new Error('Too many operations');
  for(const operation of integration.operations){
    if(!['GET','POST','PUT','PATCH','DELETE'].includes(operation.method))throw new Error('Unsupported integration method');
    bus.register({name:integration.namespace+'_'+operation.name,description:operation.description,inputSchema:operation.inputSchema,effect:operation.method==='GET'?'read':'write',execute:async(args,context)=>{
      const values=args as Record<string,unknown>;const used=new Set<string>();
      const path=operation.path.replace(/\{([\w]+)\}/g,(_,key:string)=>{used.add(key);const value=String(values[key]??'');if(!value||value==='.'||value==='..')throw new Error('Missing path parameter');return encodeURIComponent(value);});
      const url=new URL(path,base);if(url.origin!==base.origin)throw new Error('Integration path escaped its origin');
      const headers:Record<string,string>={Accept:'application/json'};const credential=integration.authorizationEnv?env[integration.authorizationEnv]:undefined;if(credential)headers.Authorization=credential;
      const remaining=Object.fromEntries(Object.entries(values).filter(([key])=>!used.has(key)));
      if(operation.method==='GET')for(const [key,value]of Object.entries(remaining))url.searchParams.set(key,typeof value==='string'?value:JSON.stringify(value));
      else headers['Content-Type']='application/json';
      const response=await fetch(url,{method:operation.method,headers,body:operation.method==='GET'?undefined:JSON.stringify(remaining),signal:context.signal,redirect:'error'});
      if(!response.ok)return{status:'api_error',httpStatus:response.status,retryable:[429,502,503,504].includes(response.status),message:'Review the API parameters or connection; do not repeat a write without checking its outcome.'};
      const reader=response.body?.getReader();if(!reader)return null;const decoder=new TextDecoder();let text='',bytes=0;
      try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>80_000)throw new Error('Result too large');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      try{return JSON.parse(text);}catch{return{content:text};}
    }});
  }
}
export async function loadConnections(bus:MCPBus,env:Record<string,string|undefined>):Promise<void>{
  const rest=JSON.parse(env.NAVI_REST_INTEGRATIONS_JSON??'[]') as RestIntegration[];
  if(!Array.isArray(rest)||rest.length>30)throw new Error('Invalid REST registry');for(const entry of rest)registerRestIntegration(bus,entry,env);
  const servers=JSON.parse(env.NAVI_MCP_SERVERS_JSON??'[]') as {namespace:string;endpoint:string;authorizationEnv?:string;readTools?:string[];allowedTools?:string[]}[];
  if(!Array.isArray(servers)||servers.length>12)throw new Error('Invalid MCP registry');
  // Four concurrent handshakes, with bounded protocol timeouts inside the bus.
  for(let i=0;i<servers.length;i+=4)await Promise.all(servers.slice(i,i+4).map(server=>bus.connect({namespace:server.namespace,endpoint:new URL(server.endpoint),headers:server.authorizationEnv&&env[server.authorizationEnv]?{Authorization:env[server.authorizationEnv]!}:undefined,readTools:new Set(server.readTools??[]),allowedTools:server.allowedTools?new Set(server.allowedTools):undefined})));
}
