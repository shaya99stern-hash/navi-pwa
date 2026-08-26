import React, { useState, useRef, useEffect } from 'react';

interface ClaudeComposerProps {
  onSend: (message: string) => void;
  isChatActive?: boolean;
  userName?: string;
  placeholder?: string;
  disabled?: boolean;
}

export const ClaudeComposer: React.FC<ClaudeComposerProps> = ({
  onSend,
  isChatActive = false,
  userName,
  placeholder = 'Message NaviOS...',
  disabled = false,
}) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea height
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

  const quickPills = [
    { label: '✨ Create Code Artifact', prompt: 'Create an interactive single-page app artifact for...' },
    { label: '📊 Analyze Data', prompt: 'Analyze and summarize the following data...' },
    { label: '📝 Draft Report', prompt: 'Draft a professional research summary on...' },
  ];

  return (
    <div
      className={`transition-all duration-300 ease-out ${
        isChatActive
          ? 'fixed bottom-0 left-0 right-0 z-40 bg-gradient-to-t from-[#08080a] via-[#08080a]/90 to-transparent pb-4 pt-6'
          : 'mx-auto my-auto flex w-full max-w-2xl flex-col items-center justify-center px-4 py-8'
      }`}
    >
      {/* Empty State Greeting */}
      {!isChatActive && (
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-[#111115] shadow-xl shadow-orange-500/10">
            <span className="text-2xl">⚡</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">
            {userName ? `Welcome back, ${userName}` : 'What can I help you build today?'}
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            NaviOS is your private, multi-agent AI workspace.
          </p>
        </div>
      )}

      {/* Main Composer Box */}
      <form
        onSubmit={handleSubmit}
        className={`relative w-full rounded-2xl border border-white/10 bg-[#111115] shadow-2xl transition-all focus-within:border-orange-500/50 focus-within:ring-4 focus-within:ring-orange-500/10 ${
          isChatActive ? 'mx-auto max-w-3xl px-3 py-2.5' : 'p-3.5'
        }`}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={isChatActive ? 1 : 2}
          disabled={disabled}
          className="w-full resize-none bg-transparent text-[16px] text-zinc-100 placeholder-zinc-500 outline-none leading-relaxed"
          style={{ maxHeight: '180px' }}
        />

        {/* Action Row */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-zinc-500">
              ⚡ Multi-Agent Router Active
            </span>
          </div>

          <button
            type="submit"
            disabled={!input.trim() || disabled}
            className={`flex h-9 w-9 items-center justify-center rounded-xl transition-all active:scale-95 ${
              input.trim() && !disabled
                ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/25 hover:bg-orange-600'
                : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
            }`}
          >
            ↑
          </button>
        </div>
      </form>

      {/* Quick Action Suggestion Pills (Centered View Only) */}
      {!isChatActive && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {quickPills.map((pill, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setInput(pill.prompt);
                textareaRef.current?.focus();
              }}
              className="rounded-full border border-white/5 bg-[#18181f] px-3.5 py-1.5 text-xs text-zinc-300 transition-all hover:border-orange-500/30 hover:text-white active:scale-95"
            >
              {pill.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
