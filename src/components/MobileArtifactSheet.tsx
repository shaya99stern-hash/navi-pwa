import React, { useState } from 'react';

interface MobileArtifactSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  code: string;
  language?: string;
  previewUrl?: string;
}

export const MobileArtifactSheet: React.FC<MobileArtifactSheetProps> = ({
  isOpen,
  onClose,
  title,
  code,
  language = 'typescript',
  previewUrl
}) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/70 backdrop-blur-sm transition-opacity">
      <div className="flex-1" onClick={onClose} />

      <div className="claude-sheet relative flex h-[85vh] max-h-[85vh] w-full flex-col rounded-t-3xl border-t border-slate-800 bg-slate-900 shadow-2xl safe-bottom">
        <div className="flex w-full items-center justify-center pt-3 pb-2">
          <div className="h-1.5 w-12 rounded-full bg-slate-700" />
        </div>

        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex flex-col">
            <h3 className="text-base font-semibold text-white">{title}</h3>
            <span className="text-xs text-slate-400 capitalize">{language} Artifact</span>
          </div>

          <div className="flex items-center rounded-lg bg-slate-800 p-1">
            <button
              onClick={() => setActiveTab('preview')}
              className={`min-h-[36px] min-w-[64px] rounded-md px-3 py-1 text-xs font-medium transition-all ${
                activeTab === 'preview' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Preview
            </button>
            <button
              onClick={() => setActiveTab('code')}
              className={`min-h-[36px] min-w-[64px] rounded-md px-3 py-1 text-xs font-medium transition-all ${
                activeTab === 'code' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Code
            </button>
          </div>

          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-slate-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="relative flex-1 overflow-hidden bg-slate-950">
          {activeTab === 'preview' ? (
            <div className="h-full w-full">
              {previewUrl ? (
                <iframe
                  src={previewUrl}
                  sandbox="allow-scripts allow-same-origin"
                  className="h-full w-full border-none bg-white"
                  title="Artifact Preview"
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">
                  Interactive preview container ready.
                </div>
              )}
            </div>
          ) : (
            <div className="relative h-full w-full overflow-auto p-4">
              <button
                onClick={handleCopy}
                className="absolute top-4 right-4 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700"
              >
                {copied ? '✓ Copied' : 'Copy Code'}
              </button>
              <pre className="font-mono text-xs text-slate-300 leading-relaxed">
                <code>{code}</code>
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
