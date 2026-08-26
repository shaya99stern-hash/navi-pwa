import os, sys

def fix_navi():
    user = os.environ.get("USERPROFILE", os.path.expanduser("~"))
    repo_dir = os.path.join(user, "navi-pwa")
    if not os.path.exists(repo_dir):
        repo_dir = "."

    print(f"Targeting Codebase: {repo_dir}")
    print("Applying Claude-grade iOS Mobile Layout & Artifact Fixes...")

    # 1. Patch CSS with iOS resets
    css_files = []
    for root, _, files in os.walk(repo_dir):
        if any(x in root for x in ["node_modules", ".git", ".next"]): continue
        for f in files:
            if f in ["globals.css", "global.css", "app.css", "index.css", "main.css"]:
                css_files.append(os.path.join(root, f))

    ios_css_patch = """
/* ==========================================================================
   CLAUDE-GRADE iOS MOBILE PWA & ERGONOMICS PATCH
   ========================================================================== */

/* 1. Root Viewport & Rubber-Banding Suppression */
html, body {
  height: 100%;
  height: -webkit-fill-available;
  overscroll-behavior-y: none;
  -webkit-overflow-scrolling: touch;
  -webkit-tap-highlight-color: transparent;
}

/* 2. Apple Safe Area Clearance Utilities */
.safe-top {
  padding-top: env(safe-area-inset-top, 0px);
}
.safe-bottom {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.safe-left {
  padding-left: env(safe-area-inset-left, 0px);
}
.safe-right {
  padding-right: env(safe-area-inset-right, 0px);
}

/* 3. Prevent iOS Safari Input Auto-Zoom (Enforce 16px minimum on touch) */
input, textarea, select {
  font-size: 16px !important;
}

/* 4. Touch Target & Selection Ergonomics */
button, a, [role="button"] {
  min-height: 44px;
  min-width: 44px;
  user-select: none;
  -webkit-user-select: none;
}

/* 5. Horizontal Code Block & Artifact Containment */
pre, code {
  max-width: 100%;
  overflow-x: auto !important;
  -webkit-overflow-scrolling: touch;
}

/* 6. Claude-style Glassmorphism & Spring Timing */
.claude-sheet {
  transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
  will-change: transform;
}
"""

    for cf in css_files:
        try:
            with open(cf, "r", encoding="utf-8", errors="ignore") as f: content = f.read()
            if "CLAUDE-GRADE iOS" not in content:
                with open(cf, "a", encoding="utf-8") as f: f.write("\n" + ios_css_patch)
                print(f"✓ Injected iOS Safe Area & Native Touch CSS into: {cf}")
        except Exception as e:
            print(f"Error patching {cf}: {e}")

    # 2. Create useVisualViewport.ts Hook
    hooks_dir = os.path.join(repo_dir, "src", "hooks")
    if not os.path.exists(os.path.join(repo_dir, "src")):
        hooks_dir = os.path.join(repo_dir, "hooks")
    os.makedirs(hooks_dir, exist_ok=True)

    hook_code = """import { useState, useEffect } from 'react';

/**
 * useVisualViewport Hook (Claude-grade iOS keyboard avoidance)
 * Tracks the real visual viewport height to stick the input bar
 * to the virtual keyboard without pushing the header offscreen.
 */
export function useVisualViewport() {
  const [viewportHeight, setViewportHeight] = useState<number>(
    typeof window !== 'undefined' ? window.innerHeight : 0
  );
  const [keyboardOffset, setKeyboardOffset] = useState<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const handleResize = () => {
      if (!window.visualViewport) return;
      const currentHeight = window.visualViewport.height;
      const offset = window.innerHeight - currentHeight;
      setViewportHeight(currentHeight);
      setKeyboardOffset(offset > 50 ? offset : 0);
    };

    window.visualViewport.addEventListener('resize', handleResize);
    window.visualViewport.addEventListener('scroll', handleResize);

    return () => {
      window.visualViewport?.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('scroll', handleResize);
    };
  }, []);

  return { viewportHeight, keyboardOffset, isKeyboardOpen: keyboardOffset > 50 };
}
"""
    hook_path = os.path.join(hooks_dir, "useVisualViewport.ts")
    with open(hook_path, "w", encoding="utf-8") as f: f.write(hook_code)
    print(f"✓ Created iOS Keyboard Viewport Hook: {hook_path}")

    # 3. Create Claude-Grade Mobile Artifact Drawer Component
    components_dir = os.path.join(repo_dir, "src", "components")
    if not os.path.exists(os.path.join(repo_dir, "src")):
        components_dir = os.path.join(repo_dir, "components")
    os.makedirs(components_dir, exist_ok=True)

    sheet_code = """import React, { useState } from 'react';

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
"""
    sheet_path = os.path.join(components_dir, "MobileArtifactSheet.tsx")
    with open(sheet_path, "w", encoding="utf-8") as f: f.write(sheet_code)
    print(f"✓ Created Claude-Grade Mobile Artifact Drawer: {sheet_path}")

    print("\n" + "=" * 60)
    print("           CLAUDE-GRADE MOBILE FIXES APPLIED!               ")
    print("=" * 60)

fix_navi()
