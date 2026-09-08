import type { APIRoute } from 'astro';
import { userId } from '../../lib/server/auth';
import { configuredModels } from '../../lib/server/config';
export const GET:APIRoute=async({request})=>{
  const user=await userId(request);if(!user)return Response.json({signedIn:false},{status:401});
  let models:unknown[]=[];try{models=configuredModels(process.env).map(n=>({name:n.id,role:n.role,free:n.free,status:'configured'}));}catch{/* Configuration failure stays visible in Settings. */}
  return Response.json({signedIn:true,user,models,connections:{github:!!process.env.GITHUB_TOKEN,vercel:!!process.env.VERCEL_TOKEN,search:!!process.env.TAVILY_API_KEY},localDocuments:true},{headers:{'Cache-Control':'no-store'}});
};
