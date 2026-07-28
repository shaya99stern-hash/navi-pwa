export const PWA_UPDATE_REQUEST_EVENT = "navi:pwa-update-request";
export const PWA_UPDATE_STATUS_EVENT = "navi:pwa-update-status";

export type PwaUpdatePhase = "idle" | "checking" | "available" | "downloading" | "restarting" | "current" | "error";

export type PwaUpdateStatus = {
  phase: PwaUpdatePhase;
  message: string;
};

export function emitPwaUpdateStatus(status: PwaUpdateStatus): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PwaUpdateStatus>(PWA_UPDATE_STATUS_EVENT, { detail: status }));
}

export function requestPwaUpdate(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PWA_UPDATE_REQUEST_EVENT));
}
