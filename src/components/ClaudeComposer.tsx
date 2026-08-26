import React, { useState, useRef, useEffect } from 'react';

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
