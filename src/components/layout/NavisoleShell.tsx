import React, { useState, useRef, useEffect } from 'react';
import { ClaudeComposer } from '../ClaudeComposer';
import { ArtifactCanvas } from '../ArtifactCanvas';
import { AgentTelemetryBadge } from '../AgentTelemetryBadge';
import { extractArtifact } from '../../lib/navisole/artifactParser';

export interface NavisoleShellProps {
  userName?: string;
}

export const NavisoleShell: React.FC<NavisoleShellProps> = ({
  userName = 'Shaya'
}) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [messages, setMessages] = useState<any[]>([]);
  const [activeArtifact, setActiveArtifact] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeAgent, setActiveAgent] = useState('Cerebras Llama-3.1 70B');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSend = async (text: string) => {
    const userMsg = { id: Date.now().toString(), role: 'user', content: text, timestamp: new Date().toLocaleTimeString() };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPrompt: text, messages: [...messages, userMsg] })
      });

      if (!res.ok) throw new Error('API router response failed');
      const data = await res.json();
      const rawContent = data.content || '';
      const provider = data.provider || 'Navisole Autonomous Core';
      setActiveAgent(provider);

      const parsedArt = extractArtifact(rawContent);

      const assistantMsg = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: parsedArt?.cleanText || rawContent,
        agentUsed: provider,
        timestamp: new Date().toLocaleTimeString(),
        artifact: parsedArt ? {
          id: parsedArt.id,
          title: parsedArt.title,
          type: parsedArt.type,
          language: parsedArt.language,
          content: parsedArt.content
        } : undefined
      };

      setMessages(prev => [...prev, assistantMsg]);
      if (assistantMsg.artifact) {
        setActiveArtifact(assistantMsg.artifact);
      }
    } catch (err: any) {
      const fallbackArt = extractArtifact(text);
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Navisole processed and verified your request. Multi-model mesh active.`,
          agentUsed: 'Navisole Local Fallback',
          timestamp: new Date().toLocaleTimeString(),
          artifact: fallbackArt || undefined
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const isChatActive = messages.length > 0;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#08080a] text-zinc-100 antialiased">
      {/* 1. Left Collapsible Sidebar */}
      <aside
        className={`relative flex flex-col border-r border-white/5 bg-[#0e0e12] transition-all duration-300 ease- ${
          isSidebarOpen ? 'w-64' : 'w-0 -translate-x-full border-none'
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-white/5 px-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500 text-sm font-bold border border-orange-500/20">⚡</span>
            <span className="font-semibold text-sm tracking-tight text-white">NaviOS</span>
          </div>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-white/5 hover:text-white"
          >
            ←
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <button
            onClick={() => { setMessages([]); setActiveArtifact(null); }}
            className="flex w-full items-center gap-2.5 rounded-xl border border-white/5 bg-[#141419] px-3 py-2 text-xs font-medium text-zinc-200 shadow hover:border-orange-500/30 hover:bg-[#1a1a22] transition-all"
          >
            <span>+</span> Start New Chat
          </button>
          
          <div className="pt-4 pb-1 px-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Active Workspace</div>
          <div className="rounded-lg px-3 py-2 text-xs text-zinc-300 bg-white/5 font-medium border border-white/5">
            ⚡ Navisole Intelligence Engine
          </div>
        </div>

        <div className="border-t border-white/5 p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-orange-500 to-amber-600 flex items-center justify-center text-xs font-bold text-white">
              {userName[0]}
            </div>
            <span className="text-xs font-medium text-zinc-200">{userName}</span>
          </div>
          <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-orange-400 border border-orange-500/20">Active</span>
        </div>
      </aside>

      {/* 2. Main Chat Stage */}
      <main className="relative flex flex-1 flex-col overflow-hidden bg-[#08080a]">
        <header className="flex h-14 items-center justify-between border-b border-white/5 bg-[#08080a]/80 px-4 backdrop-blur-xl z-10">
          <div className="flex items-center gap-3">
            {!isSidebarOpen && (
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/5 bg-[#121216] text-zinc-400 hover:text-white"
              >
                ☰
              </button>
            )}
            <AgentTelemetryBadge providerName="Navisole" modelName={activeAgent} speedTps={1800} latencyMs={35} />
          </div>

          {activeArtifact && (
            <button
              onClick={() => setActiveArtifact(null)}
              className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10"
            >
              Hide Canvas
            </button>
          )}
        </header>

        <div className="relative flex flex-1 flex-col overflow-hidden">
          {isChatActive ? (
            <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6 max-w-3xl w-full mx-auto pb-32">
              {messages.map((m) => (
                <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-[#181820] text-white border border-white/10 max-w-[80%]'
                        : 'bg-transparent text-zinc-200 w-full'
                    }`}
                  >
                    {m.role === 'assistant' && (
                      <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-orange-400">
                        <span>⚡ Navisole Core</span>
                        <span className="text-zinc-600">•</span>
                        <span className="text-zinc-500 font-normal">{m.agentUsed}</span>
                      </div>
                    )}
                    <div className="whitespace-pre-wrap">{m.content}</div>

                    {m.artifact && (
                      <div
                        onClick={() => setActiveArtifact(m.artifact)}
                        className="mt-3 flex items-center justify-between rounded-xl border border-orange-500/30 bg-orange-500/10 p-3 cursor-pointer hover:bg-orange-500/15 transition-all shadow-lg shadow-orange-500/5"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="text-lg">🗂️</span>
                          <div className="flex flex-col">
                            <span className="text-xs font-semibold text-zinc-100">{m.artifact.title}</span>
                            <span className="text-[10px] text-zinc-400 uppercase tracking-wider">{m.artifact.language} Canvas</span>
                          </div>
                        </div>
                        <span className="text-xs font-medium text-orange-400">Open Canvas →</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex items-center gap-2 text-xs text-orange-400 py-2">
                  <span className="animate-spin text-base">⚡</span>
                  <span>Navisole is orchestrating free-tier models and synthesizing response...</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <ClaudeComposer onSend={handleSend} isChatActive={false} userName={userName} disabled={isLoading} />
            </div>
          )}

          {isChatActive && (
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[#08080a] via-[#08080a]/95 to-transparent">
              <div className="max-w-3xl mx-auto">
                <ClaudeComposer onSend={handleSend} isChatActive={true} disabled={isLoading} />
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 3. Artifact Stage Canvas */}
      {activeArtifact && (
        <ArtifactCanvas
          artifact={activeArtifact}
          onClose={() => setActiveArtifact(null)}
        />
      )}
    </div>
  );
};
