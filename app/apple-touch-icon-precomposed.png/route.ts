import { naviHomeIconResponse } from "@/lib/ui/navi-home-icon/response";

export const runtime = "nodejs";

export function GET(): Response {
  return naviHomeIconResponse();
}
