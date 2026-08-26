import React, { useState } from 'react';

interface ArtifactCanvasProps {
  artifact: {
    id: string;
    title: string;
    type: string;
    language: string;
    content: string;
  };
  onClose: () => void;
}

export const ArtifactCanvas: React.FC<ArtifactCanvasProps> = ({ artifact, onClose }) => {
  const [tab, setTab] = useState<'preview' | 'code'>('code');
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(artifact.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <aside className="relative flex w-[480px] lg:w-[560px] flex-col border-l border-white/5 bg-[#0d0d12] shadow-2xl transition-all duration-300">
      <div className="flex h-14 items-center justify-between border-b border-white/5 px-4 bg-[#101016]">
        <div className="flex items-center gap-2">
          <span className="text-base">🗂️</span>
          <div className="flex flex-col">
            <h3 className="text-xs font-semibold text-white truncate max-w-[200px]">{artifact.title}</h3>
            <span className="text-[10px] text-zinc-400 capitalize">{artifact.language}</span>
          </div>
        </div>

        <div className="flex items-center rounded-lg bg-zinc-900 border border-white/5 p-0.5">
          <button
            onClick={() => setTab('code')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
              tab === 'code' ? 'bg-orange-500 text-white shadow' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Code
          </button>
          <button
            onClick={() => setTab('preview')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
              tab === 'preview' ? 'bg-orange-500 text-white shadow' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Preview
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-auto bg-[#08080a] p-4">
        {tab === 'code' ? (
          <pre className="font-mono text-xs text-zinc-200 leading-relaxed overflow-x-auto">
            <code>{artifact.content}</code>
          </pre>
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-xl border border-white/5 bg-zinc-950 p-6 text-center text-xs text-zinc-400">
            Interactive Preview Sandbox
          </div>
        )}
      </div>
    </aside>
  );
};
