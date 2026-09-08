import { createClerkClient } from '@clerk/backend';
export async function userId(request:Request):Promise<string|null> {
  if(import.meta.env.DEV&&process.env.NAVI_DEV_MODE==='true')return 'local-development';
  const secretKey=process.env.CLERK_SECRET_KEY,publishableKey=process.env.PUBLIC_CLERK_PUBLISHABLE_KEY;
  if(!secretKey||!publishableKey)return null;
  const clerk=createClerkClient({secretKey,publishableKey});
  const state=await clerk.authenticateRequest(request,{authorizedParties:[new URL(request.url).origin]});
  const auth=state.toAuth();if(!auth?.userId)return null;
  const allow=process.env.NAVI_ALLOWED_USER_IDS?.split(',').map(s=>s.trim()).filter(Boolean);
  return allow?.length&&!allow.includes(auth.userId)?null:auth.userId;
}
export function sameOrigin(request:Request):boolean{return request.headers.get('origin')===new URL(request.url).origin;}
