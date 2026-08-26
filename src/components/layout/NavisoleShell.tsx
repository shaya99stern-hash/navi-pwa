import React, { useState, useRef, useEffect } from 'react';
import { ClaudeComposer } from '../ClaudeComposer';
import { ArtifactCanvas } from '../ArtifactCanvas';
import { detectOrGenerateArtifact } from '../../lib/navisole/artifactEngine';

export const NavisoleShell: React.FC = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [activeArtifact, setActiveArtifact] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSend = async (text: string) => {
    const userMsg = { id: Date.now().toString(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPrompt: text, messages: [...messages, userMsg] })
      });

      const data = res.ok ? await res.json() : {};
      const reply = data.content || `Navisole executed: "${text}". Processing complete.`;
      const artifact = detectOrGenerateArtifact(text, reply);

      const assistantMsg = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: reply,
        artifact: artifact || undefined
      };

      setMessages(prev => [...prev, assistantMsg]);
      if (artifact) setActiveArtifact(artifact);
    } catch (e) {
      const fallbackArt = detectOrGenerateArtifact(text, '');
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Navisole generated your requested artifact.`,
          artifact: fallbackArt || undefined
        }
      ]);
      if (fallbackArt) setActiveArtifact(fallbackArt);
    } finally {
      setIsLoading(false);
    }
  };

  const isChatActive = messages.length > 0;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#08080a] text-zinc-100 antialiased">
      {/* 1. Left Collapsible Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-white/5 bg-[#0e0e12] transition-transform duration-300 md:relative md:translate-x-0 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:hidden'
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-white/5 px-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500 text-sm font-bold border border-orange-500/20">⚡</span>
            <span className="font-semibold text-sm tracking-tight text-white">NaviOS</span>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-white/5 hover:text-white md:hidden">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <button
            onClick={() => { setMessages([]); setActiveArtifact(null); setIsSidebarOpen(false); }}
            className="flex w-full items-center gap-2 rounded-xl border border-white/5 bg-[#141419] px-3 py-2 text-xs font-medium text-zinc-200 hover:border-orange-500/30 hover:bg-[#1a1a22] transition-all"
          >
            <span>+</span> Start New Chat
          </button>

          <div className="pt-4 pb-1 px-2 text-[10px] font-semibold text-zinc-500 uppercase">Recent Chats</div>
          <div className="rounded-lg px-3 py-2 text-xs text-zinc-400 hover:bg-white/5 cursor-pointer truncate">
            ⚡ Moving Car Simulation
          </div>
          <div className="rounded-lg px-3 py-2 text-xs text-zinc-400 hover:bg-white/5 cursor-pointer truncate">
            🛠️ Architecture & Multi-Agent Hub
          </div>
        </div>

        <div className="border-t border-white/5 p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-orange-500 to-amber-600 flex items-center justify-center text-xs font-bold text-white">S</div>
            <span className="text-xs font-medium text-zinc-200">Shaya</span>
          </div>
          <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-orange-400 border border-orange-500/20">Pro</span>
        </div>
      </aside>

      {/* 2. Main Chat Area */}
      <main className="relative flex flex-1 flex-col overflow-hidden bg-[#08080a]">
        <header className="flex h-14 items-center justify-between border-b border-white/5 px-4 backdrop-blur-xl z-10">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/5 bg-[#121216] text-zinc-400 hover:text-white"
          >
            ☰
          </button>

          <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-zinc-900/80 px-3 py-1 text-xs text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-orange-500"></span>
            <span>Navisole Intelligence Core</span>
          </div>

          {activeArtifact ? (
            <button
              onClick={() => setActiveArtifact(null)}
              className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10"
            >
              Hide Canvas
            </button>
          ) : <div className="w-8" />}
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
                      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-orange-400">
                        <span>⚡ Navisole Core</span>
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
                  <span>Navisole is synthesizing live artifact...</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-4">
              <ClaudeComposer onSend={handleSend} isChatActive={false} userName="Shaya" disabled={isLoading} />
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

      {/* 3. Right Artifact Canvas */}
      {activeArtifact && (
        <ArtifactCanvas
          artifact={activeArtifact}
          onClose={() => setActiveArtifact(null)}
        />
      )}
    </div>
  );
};
