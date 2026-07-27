import { Brain, Check, ChevronDown, Gauge, Settings2, Sparkles, Zap } from "lucide-react";
import { ROUTES, STYLES, type ModelRoute, type ResponseStyle } from "../lib/chat";

const ICONS = { sparkles: Sparkles, brain: Brain, gauge: Gauge, zap: Zap, settings: Settings2 };

type Props = {
  open: boolean;
  route: ModelRoute;
  style: ResponseStyle;
  saveHistory: boolean;
  onToggle: () => void;
  onClose: () => void;
  onRoute: (route: ModelRoute) => void;
  onStyle: (style: ResponseStyle) => void;
  onHistory: () => void;
};

export function TopMenu({ open, route, style, saveHistory, onToggle, onClose, onRoute, onStyle, onHistory }: Props) {
  return (
    <>
      {open ? <button type="button" aria-label="Close Navi menu" className="fixed inset-0 z-40 cursor-default" onClick={onClose} /> : null}
      <div className="absolute left-1/2 top-[max(env(safe-area-inset-top),12px)] -translate-x-1/2">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-11 max-w-[210px] items-center gap-1.5 rounded-full px-3 text-[16px] font-semibold tracking-tight active:bg-white/10">
          <span className="truncate">Navi</span><ChevronDown size={17} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open ? (
          <div className="absolute left-1/2 top-[48px] z-50 w-[min(90vw,340px)] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 bg-[#202020] shadow-menu">
            <div className="border-b border-white/10 px-4 py-3 text-[12px] font-medium uppercase tracking-[0.12em] text-neutral-500">AI engine</div>
            <div className="p-2">
              {ROUTES.map((item) => {
                const Icon = ICONS[item.icon];
                return (
                  <button key={item.id} type="button" onClick={() => onRoute(item.id)} className={`flex min-h-[58px] w-full items-center gap-3 rounded-xl px-3 text-left active:bg-white/10 ${route === item.id ? "bg-white/[0.07]" : ""}`}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/25 text-neutral-300"><Icon size={18} /></span>
                    <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium text-neutral-100">{item.label}</span><span className="block truncate text-[12px] text-neutral-500">{item.detail}</span></span>
                    {route === item.id ? <Check size={18} /> : null}
                  </button>
                );
              })}
            </div>

            <div className="border-t border-white/10 px-4 py-3">
              <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.12em] text-neutral-500">Response style</div>
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-black/25 p-1">
                {STYLES.map((item) => <button key={item.id} type="button" onClick={() => onStyle(item.id)} className={`min-h-9 rounded-lg px-2 text-[12px] font-medium ${style === item.id ? "bg-neutral-700 text-white" : "text-neutral-500 active:bg-white/10"}`}>{item.label}</button>)}
              </div>
            </div>

            <div className="border-t border-white/10 p-2">
              <button type="button" onClick={onHistory} className="flex min-h-[54px] w-full items-center justify-between rounded-xl px-3 text-left active:bg-white/10">
                <span><span className="block text-[14px] font-medium text-neutral-100">Local chat history</span><span className="block text-[12px] text-neutral-500">Stored only in this PWA</span></span>
                <span className={`relative h-7 w-12 rounded-full ${saveHistory ? "bg-white" : "bg-neutral-700"}`}><span className={`absolute top-1 h-5 w-5 rounded-full transition-transform ${saveHistory ? "translate-x-6 bg-black" : "translate-x-1 bg-neutral-300"}`} /></span>
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
