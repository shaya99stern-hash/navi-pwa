import { parseExpressionAt } from 'acorn';
import { MCPBus } from './mcp-bus';
export function calculate(expression: string): number {
  if(expression.length>1000)throw new Error('Expression too long');
  const ast=parseExpressionAt(expression,0,{ecmaVersion:'latest'});if(expression.slice(ast.end).trim())throw new Error('Unexpected trailing expression');
  const evaluate=(node:any,depth=0):number=>{
    if(depth>40)throw new Error('Expression too deep');
    if(node.type==='Literal'&&typeof node.value==='number')return node.value;
    if(node.type==='UnaryExpression'&&['+','-'].includes(node.operator)){const n=evaluate(node.argument,depth+1);return node.operator==='-'?-n:n;}
    if(node.type==='BinaryExpression') {const a=evaluate(node.left,depth+1),b=evaluate(node.right,depth+1);switch(node.operator){case '+':return a+b;case '-':return a-b;case '*':return a*b;case '/':return a/b;case '%':return a%b;case '**':return a**b;}}
    throw new Error('Use numeric arithmetic only');
  };
  const value=evaluate(ast);if(!Number.isFinite(value))throw new Error('The result is not finite');return value;
}
const schema=(properties:Record<string,unknown>,required:string[]=[])=>({type:'object' as const,properties,required,additionalProperties:false});
export function registerBuiltins(bus:MCPBus,env:Record<string,string|undefined>):void {
  bus.register({name:'calculate',description:'Evaluate arithmetic without inference or code execution.',effect:'read',inputSchema:schema({expression:{type:'string',maxLength:1000}},['expression']),execute:async args=>({result:calculate((args as {expression:string}).expression)})});
  bus.register({name:'time',description:'Read the current UTC time.',effect:'read',inputSchema:schema({}),execute:async()=>({utc:new Date().toISOString()})});
  const get=async(url:URL,signal:AbortSignal,headers:Record<string,string>={})=>{const response=await fetch(url,{headers,signal,redirect:'error'});if(!response.ok)throw new Error(`HTTP ${response.status}`);const reader=response.body?.getReader();if(!reader)throw new Error('No body');let text='',bytes=0;const decoder=new TextDecoder();try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>300_000)throw new Error('Result too large');text+=decoder.decode(part.value,{stream:true});}return JSON.parse(text+decoder.decode());}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}};
  if(env.GITHUB_TOKEN) {
    const headers={Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
    bus.register({name:'github_repositories',description:'List the authenticated account repositories.',effect:'read',inputSchema:schema({page:{type:'integer',minimum:1,maximum:100}}),execute:async(args,c)=>get(new URL(`https://api.github.com/user/repos?per_page=30&page=${(args as {page?:number}).page??1}`),c.signal,headers)});
    bus.register({name:'github_file',description:'Read a file from a named GitHub repository.',effect:'read',inputSchema:schema({owner:{type:'string',pattern:'^[a-zA-Z0-9-]+$'},repo:{type:'string',pattern:'^[a-zA-Z0-9_.-]+$'},path:{type:'string',maxLength:1000}},['owner','repo','path']),execute:async(args,c)=>{const a=args as {owner:string;repo:string;path:string};if(a.path.split('/').some(p=>p==='..'))throw new Error('Invalid path');return get(new URL(`https://api.github.com/repos/${a.owner}/${a.repo}/contents/${a.path.split('/').map(encodeURIComponent).join('/')}`),c.signal,headers);}});
  }
  if(env.VERCEL_TOKEN) {
    const headers={Authorization:`Bearer ${env.VERCEL_TOKEN}`};
    for(const [name,path] of [['vercel_projects','/v9/projects'],['vercel_deployments','/v6/deployments']])bus.register({name,description:`Read ${name.replace('_',' ')} and actual status.`,effect:'read',inputSchema:schema({}),execute:async(_,c)=>{const url=new URL(path,'https://api.vercel.com');url.searchParams.set('limit','20');if(env.VERCEL_TEAM_ID)url.searchParams.set('teamId',env.VERCEL_TEAM_ID);return get(url,c.signal,headers);}});
  }
  bus.register({name:'weather_forecast',description:'Get a location forecast using latitude and longitude.',effect:'read',inputSchema:schema({latitude:{type:'number',minimum:-90,maximum:90},longitude:{type:'number',minimum:-180,maximum:180}},['latitude','longitude']),execute:async(args,c)=>{const a=args as {latitude:number;longitude:number};const url=new URL('https://api.open-meteo.com/v1/forecast');url.searchParams.set('latitude',String(a.latitude));url.searchParams.set('longitude',String(a.longitude));url.searchParams.set('current','temperature_2m,weather_code');url.searchParams.set('daily','temperature_2m_max,temperature_2m_min');return get(url,c.signal);}});
  if(env.TAVILY_API_KEY)bus.register({name:'search_web',description:'Search the web and return source URLs and excerpts.',effect:'read',inputSchema:schema({query:{type:'string',minLength:1,maxLength:800}},['query']),execute:async(args,c)=>{const response=await fetch('https://api.tavily.com/search',{method:'POST',signal:c.signal,redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.TAVILY_API_KEY}`},body:JSON.stringify({query:(args as {query:string}).query,max_results:5,include_answer:false})});if(!response.ok)throw new Error('Search unavailable');return response.json();}});
}
