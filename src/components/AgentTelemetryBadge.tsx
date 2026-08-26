import React from 'react';

interface AgentTelemetryBadgeProps {
  providerName: string;
  modelName: string;
  speedTps?: number;
  latencyMs?: number;
  intent?: string;
  isCascading?: boolean;
}

export const AgentTelemetryBadge: React.FC<AgentTelemetryBadgeProps> = ({
  providerName,
  modelName,
  speedTps = 850,
  latencyMs = 45,
  intent = 'Code & Intelligence',
  isCascading = false,
}) => {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900/80 px-3 py-1 text-xs text-zinc-300 shadow-lg backdrop-blur-md transition-all hover:border-orange-500/40">
      <span className="relative flex h-2 w-2">
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
          isCascading ? 'bg-amber-400' : 'bg-orange-500'
        }`} />
        <span className={`relative inline-flex h-2 w-2 rounded-full ${
          isCascading ? 'bg-amber-500' : 'bg-orange-500'
        }`} />
      </span>

      <span className="font-semibold text-zinc-100">{modelName}</span>
      <span className="text-zinc-500">•</span>
      <span className="font-mono text-zinc-400">{speedTps} t/s</span>
      <span className="text-zinc-500">•</span>
      <span className="text-orange-400/90">{latencyMs}ms</span>

      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400 uppercase tracking-wider">
        {intent}
      </span>
    </div>
  );
};
