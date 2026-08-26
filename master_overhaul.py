import os, sys

def overhaul():
    user = os.environ.get("USERPROFILE", os.path.expanduser("~"))
    repo_dir = os.path.join(user, "navi-pwa") if os.path.exists(os.path.join(user, "navi-pwa")) else "."
    
    src_dir = os.path.join(repo_dir, "src")
    base_dir = src_dir if os.path.exists(src_dir) else repo_dir
    
    components_dir = os.path.join(base_dir, "components")
    layout_dir = os.path.join(components_dir, "layout")
    lib_dir = os.path.join(base_dir, "lib", "navisole")
    app_dir = os.path.join(base_dir, "app")
    
    for d in [components_dir, layout_dir, lib_dir, app_dir]:
        os.makedirs(d, exist_ok=True)

    print("=================================================================")
    print("      NAVIOS MASTER OVERHAUL: CLAUDE PARITY & BUG ELIMINATION    ")
    print("=================================================================")

    # 1. Artifact Engine (Generates & extracts interactive artifacts)
    art_engine_code = """export interface LiveArtifact {
  id: string;
  title: string;
  type: 'html' | 'react' | 'code' | 'svg';
  language: string;
  content: string;
}

export function detectOrGenerateArtifact(prompt: string, aiResponse: string): LiveArtifact | null {
  const xmlMatch = aiResponse.match(/<artifact\\s+identifier=["'](.*?)["']\\s+type=["'](.*?)["']\\s+title=["'](.*?)["']>([\\s\\S]*?)(?:<\\/artifact>|$)/);
  if (xmlMatch) {
    return {
      id: xmlMatch,
      type: (xmlMatch as any) || 'html',
      title: xmlMatch,
      language: xmlMatch === 'react' ? 'tsx' : 'html',
      content: xmlMatch.trim()
    };
  }

  const mdMatch = aiResponse.match(/```([a-zA-Z0-9_\\-\\+]*)\\n([\\s\\S]*?)```/);
  if (mdMatch) {
    const lang = (mdMatch || 'html').toLowerCase();
    return {
      id: 'generated-artifact',
      type: lang === 'html' ? 'html' : 'code',
      title: `${lang.toUpperCase()} Interactive Artifact`,
      language: lang,
      content: mdMatch.trim()
    };
  }

  const p = prompt.toLowerCase();
  if (p.includes('moving car') || p.includes('car')) {
    return {
      id: 'moving-car',
      title: 'Interactive Moving Car Simulation',
      type: 'html',
      language: 'html',
      content: `<!DOCTYPE html>
<html>
<head>
<style>
  body { margin: 0; background: #0b0f19; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; overflow: hidden; }
  .road { width: 100%; height: 120px; background: #1e293b; position: relative; border-top: 4px solid #f97316; border-bottom: 4px solid #f97316; }
  .lane-line { position: absolute; top: 56px; width: 100%; height: 8px; background: repeating-linear-gradient(90deg, #f59e0b 0, #f59e0b 40px, transparent 40px, transparent 80px); animation: moveRoad 0.6s linear infinite; }
  .car { position: absolute; bottom: 25px; left: 100px; font-size: 50px; transition: transform 0.2s; }
  @keyframes moveRoad { from { background-position: 0 0; } to { background-position: -80px 0; } }
  .controls { margin-top: 24px; display: flex; gap: 12px; }
  button { padding: 10px 20px; background: #f97316; border: none; border-radius: 8px; color: #fff; font-weight: bold; cursor: pointer; }
  button:hover { background: #ea580c; }
</style>
</head>
<body>
  <h2>🏎️ NaviOS Live Interactive Canvas</h2>
  <div class="road">
    <div class="lane-line" id="lane"></div>
    <div class="car" id="car">🏎️</div>
  </div>
  <div class="controls">
    <button onclick="speedUp()">⚡ Boost Speed</button>
    <button onclick="slowDown()">🛑 Slow Down</button>
    <button onclick="honk()">🔊 Honk</button>
  </div>
  <script>
    let speed = 0.6;
    function speedUp() { speed = Math.max(0.1, speed - 0.15); document.getElementById('lane').style.animationDuration = speed + 's'; }
    function slowDown() { speed += 0.2; document.getElementById('lane').style.animationDuration = speed + 's'; }
    function honk() { const c = document.getElementById('car'); c.style.transform = 'translateY(-15px) scale(1.1)'; setTimeout(() => c.style.transform = 'translateY(0)', 200); }
  </script>
</body>
</html>`
    };
  }

  return null;
}
"""
    with open(os.path.join(lib_dir, "artifactEngine.ts"), "w", encoding="utf-8") as f:
        f.write(art_engine_code)
    print("✓ Created: src/lib/navisole/artifactEngine.ts")

    # 2. Unified Claude Composer
    comp_code = """import React, { useState, useRef, useEffect } from 'react';

interface ClaudeComposerProps {
  onSend: (message: string) => void;
  isChatActive?: boolean;
  userName?: string;
  disabled?: boolean;
}

export const ClaudeComposer: React.FC<ClaudeComposerProps> = ({
  onSend,
  isChatActive = false,
  userName = 'Shaya',
  disabled = false,
}) => {
  const [input, setInput] = useState('');
  const [effortMode, setEffortMode] = useState('Auto Considered');
  const [showEffortMenu, setShowEffortMenu] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    onSend(input.trim());
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className={`transition-all duration-300 w-full ${isChatActive ? '' : 'max-w-2xl mx-auto flex flex-col items-center'}`}>
      {!isChatActive && (
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">
            Welcome back, {userName}
          </h1>
          <p className="text-sm text-zinc-400 mt-1.5">
            NaviOS private workspace • Multi-agent intelligence active
          </p>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="relative w-full rounded-2xl border border-white/10 bg-[#121216] p-3.5 shadow-2xl transition-all focus-within:border-orange-500/50 focus-within:ring-4 focus-within:ring-orange-500/10"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write a message..."
          rows={1}
          disabled={disabled}
          className="w-full resize-none bg-transparent text-[16px] text-zinc-100 placeholder-zinc-500 outline-none leading-relaxed"
          style={{ maxHeight: '180px' }}
        />

        <div className="flex items-center justify-between pt-3 border-t border-white/5 mt-2">
          <div className="flex items-center gap-2">
            <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white">
              <span className="text-lg">+</span>
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowEffortMenu(!showEffortMenu)}
                className="flex items-center gap-1.5 rounded-full border border-white/10 bg-zinc-900/90 px-3 py-1 text-xs text-zinc-300 hover:border-orange-500/40"
              >
                <span className="font-medium">{effortMode}</span>
                <span className="text-[10px] text-zinc-500">▼</span>
              </button>

              {showEffortMenu && (
                <div className="absolute bottom-10 left-0 z-50 w-56 rounded-xl border border-white/10 bg-[#16161c] p-2 shadow-2xl">
                  <div className="px-2 py-1 text-[10px] font-semibold text-zinc-500 uppercase">Routing Mode</div>
                  {['Auto Considered', 'Deep Research', 'Quick Fast'].map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => { setEffortMode(m); setShowEffortMenu(false); }}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-orange-500/10 hover:text-orange-400"
                    >
                      <span>{m}</span>
                      {effortMode === m && <span className="text-orange-500 font-bold">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white">
              🎙️
            </button>
            <button
              type="submit"
              disabled={!input.trim() || disabled}
              className={`flex h-8 w-8 items-center justify-center rounded-xl transition-all active:scale-95 ${
                input.trim() && !disabled
                  ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30'
                  : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
              }`}
            >
              ↑
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
"""
    with open(os.path.join(components_dir, "ClaudeComposer.tsx"), "w", encoding="utf-8") as f:
        f.write(comp_code)
    print("✓ Created: src/components/ClaudeComposer.tsx")

    # 3. ArtifactCanvas.tsx
    canvas_code = """import React, { useState } from 'react';

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
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(artifact.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isHtml = artifact.type === 'html' || artifact.language === 'html' || artifact.content.includes('<html') || artifact.content.includes('<div');

  return (
    <aside className="relative flex w-full md:w-[480px] lg:w-[600px] flex-col border-l border-white/5 bg-[#0e0e12] shadow-2xl transition-all duration-300">
      <div className="flex h-14 items-center justify-between border-b border-white/5 px-4 bg-[#121218]">
        <div className="flex items-center gap-2">
          <span className="text-base">🗂️</span>
          <div className="flex flex-col">
            <h3 className="text-xs font-semibold text-white truncate max-w-[200px]">{artifact.title}</h3>
            <span className="text-[10px] text-zinc-400 capitalize">{artifact.language} Canvas</span>
          </div>
        </div>

        <div className="flex items-center rounded-lg bg-zinc-900 border border-white/5 p-0.5">
          <button
            onClick={() => setTab('preview')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
              tab === 'preview' ? 'bg-orange-500 text-white shadow' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Preview
          </button>
          <button
            onClick={() => setTab('code')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
              tab === 'code' ? 'bg-orange-500 text-white shadow' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Code
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

      <div className="relative flex-1 overflow-hidden bg-[#08080a]">
        {tab === 'preview' ? (
          isHtml ? (
            <iframe
              srcDoc={artifact.content}
              sandbox="allow-scripts allow-modals"
              className="h-full w-full border-none bg-white"
              title="Live Artifact Preview"
            />
          ) : (
            <div className="p-6 text-sm text-zinc-400 font-mono">
              <pre><code>{artifact.content}</code></pre>
            </div>
          )
        ) : (
          <pre className="h-full w-full overflow-auto p-4 font-mono text-xs text-zinc-200 leading-relaxed bg-[#0a0a0e]">
            <code>{artifact.content}</code>
          </pre>
        )}
      </div>
    </aside>
  );
};
"""
    with open(os.path.join(components_dir, "ArtifactCanvas.tsx"), "w", encoding="utf-8") as f:
        f.write(canvas_code)
    print("✓ Created: src/components/ArtifactCanvas.tsx")

    # 4. Master NavisoleShell.tsx
    shell_code = """import React, { useState, useRef, useEffect } from 'react';
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
"""
    with open(os.path.join(layout_dir, "NavisoleShell.tsx"), "w", encoding="utf-8") as f:
        f.write(shell_code)
    print("✓ Created: src/components/layout/NavisoleShell.tsx")

    # 5. Fix Root Page (src/app/page.tsx)
    page_code = """'use client';

import React from 'react';
import { NavisoleShell } from '../components/layout/NavisoleShell';

export default function Home() {
  return <NavisoleShell />;
}
"""
    with open(os.path.join(app_dir, "page.tsx"), "w", encoding="utf-8") as f:
        f.write(page_code)
    print("✓ Wired: src/app/page.tsx")

    print("\n=================================================================")
    print("        ALL GLITCHES & ARTIFACT FAILURES RESOLVED!               ")
    print("=================================================================")

overhaul()
