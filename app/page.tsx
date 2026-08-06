"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowUp, Plus, Square } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage } from "./components/chat-message";
import { Sidebar, SidebarButton } from "./components/sidebar";
import { TopMenu } from "./components/top-menu";
import {
  ROUTES,
  chatTitle,
  createId,
  type ModelRoute,
  type NaviPreferences,
  type ResponseStyle,
  type StoredChat
} from "./lib/chat";

const CHAT_STORAGE_KEY = "navi.chats.v2";
const PREFERENCES_STORAGE_KEY = "navi.preferences.v2";
const STARTERS = ["Help me plan something", "Explain a difficult topic", "Write or improve code"];
const MAX_CHATS = 30;
const MAX_MESSAGES = 50;
import { AppShell } from "./components/app-shell";

export default function NaviPage() {
  const initialId = useRef(createId());
  const [activeId, setActiveId] = useState(initialId.current);
  const [savedChats, setSavedChats] = useState<StoredChat[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [input, setInput] = useState("");
  const [route, setRoute] = useState<ModelRoute>("auto");
  const [style, setStyle] = useState<ResponseStyle>("balanced");
  const [saveHistory, setSaveHistory] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  const { messages, sendMessage, regenerate, stop, status, error, clearError, setMessages } = useChat({
    transport,
    experimental_throttle: 35,
    onError: (chatError) => console.error("Navi chat error:", chatError)
  });

  const generating = status === "submitted" || status === "streaming";
  const routeLabel = ROUTES.find((item) => item.id === route)?.label ?? "Navi Auto";

  useEffect(() => {
    try {
      const rawPreferences = localStorage.getItem(PREFERENCES_STORAGE_KEY);
      if (rawPreferences) {
        const preferences = JSON.parse(rawPreferences) as Partial<NaviPreferences>;
        if (preferences.route && ROUTES.some((item) => item.id === preferences.route)) setRoute(preferences.route);
        if (preferences.style && ["balanced", "concise", "detailed"].includes(preferences.style)) setStyle(preferences.style);
        if (typeof preferences.saveHistory === "boolean") setSaveHistory(preferences.saveHistory);
      }

      const rawChats = localStorage.getItem(CHAT_STORAGE_KEY);
      if (rawChats) {
        const chats = (JSON.parse(rawChats) as StoredChat[])
          .filter((chat) => typeof chat.id === "string" && typeof chat.title === "string" && Array.isArray(chat.messages))
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, MAX_CHATS);
        setSavedChats(chats);
        if (chats[0]) {
          setActiveId(chats[0].id);
          setMessages(chats[0].messages);
        }
      }
    } catch (storageError) {
      console.error("Navi could not restore local data:", storageError);
    } finally {
      setHydrated(true);
    }
  }, [setMessages]);

  useEffect(() => {
    if (!hydrated) return;
    const preferences: NaviPreferences = { route, style, saveHistory };
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  }, [hydrated, route, saveHistory, style]);

  useEffect(() => {
    if (!hydrated || !saveHistory || messages.length === 0) return;
    const timer = window.setTimeout(() => {
      setSavedChats((current) => {
        const nextChat: StoredChat = {
          id: activeId,
          title: chatTitle(messages),
          updatedAt: Date.now(),
          messages: messages.slice(-MAX_MESSAGES)
        };
        const next = [nextChat, ...current.filter((chat) => chat.id !== activeId)]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, MAX_CHATS);
        try {
          localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(next));
        } catch (storageError) {
          console.error("Navi could not save local history:", storageError);
        }
        return next;
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeId, hydrated, messages, saveHistory]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [input]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const frame = requestAnimationFrame(() => scroller.scrollTo({ top: scroller.scrollHeight, behavior: status === "streaming" ? "auto" : "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [messages, status]);

  const newChat = useCallback(() => {
    if (generating) stop();
    setActiveId(createId());
    setMessages([]);
    setInput("");
    clearError();
    setSidebarOpen(false);
    setMenuOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [clearError, generating, setMessages, stop]);

  const openChat = useCallback((chat: StoredChat) => {
    if (generating) stop();
    setActiveId(chat.id);
    setMessages(chat.messages);
    clearError();
    setSidebarOpen(false);
  }, [clearError, generating, setMessages, stop]);

  const deleteChat = useCallback((id: string) => {
    setSavedChats((current) => {
      const next = current.filter((chat) => chat.id !== id);
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    if (id === activeId) {
      setActiveId(createId());
      setMessages([]);
      clearError();
    }
  }, [activeId, clearError, setMessages]);

  const submitText = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text || generating) return;
    clearError();
    setInput("");
    await sendMessage({ text }, { body: { route, style } });
  }, [clearError, generating, route, sendMessage, style]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitText(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submitText(input);
    }
  }

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-navi-background text-white">
      <Sidebar
        open={sidebarOpen}
        chats={savedChats}
        activeId={activeId}
        search={historySearch}
        onSearch={setHistorySearch}
        onClose={() => setSidebarOpen(false)}
        onNew={newChat}
        onOpen={openChat}
        onDelete={deleteChat}
      />

      <section className="relative flex h-full min-w-0 flex-col">
        <header className="safe-top relative z-50 flex shrink-0 items-center justify-between border-b border-white/[0.06] bg-navi-background/95 px-2 pb-2 backdrop-blur-xl">
          <SidebarButton onClick={() => setSidebarOpen(true)} />
          <TopMenu
            open={menuOpen}
            route={route}
            style={style}
            saveHistory={saveHistory}
            onToggle={() => setMenuOpen((open) => !open)}
            onClose={() => setMenuOpen(false)}
            onRoute={(next) => { setRoute(next); setMenuOpen(false); }}
            onStyle={setStyle}
            onHistory={() => setSaveHistory((enabled) => !enabled)}
          />
          <button type="button" onClick={newChat} className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-200 active:bg-white/10" aria-label="Start a new chat"><Plus size={23} /></button>
        </header>

        <main ref={scrollerRef} className="scroll-area min-h-0 flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="flex min-h-full flex-col items-center justify-center px-5 pb-28 pt-8">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-[#181818] text-[27px] font-semibold tracking-[-0.08em]">N</div>
              <h1 className="text-center text-[27px] font-semibold tracking-[-0.03em]">What can I help with?</h1>
              <div className="mt-8 grid w-full max-w-md gap-2">
                {STARTERS.map((prompt) => <button key={prompt} type="button" onClick={() => void submitText(prompt)} className="min-h-12 rounded-2xl border border-white/10 bg-[#171717] px-4 text-left text-[14px] text-neutral-300 active:bg-white/10">{prompt}</button>)}
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl px-4 pb-8 pt-5">
              {messages.map((message, index) => <ChatMessage key={message.id} message={message} streaming={message.role !== "user" && index === messages.length - 1 && status === "streaming"} />)}
              {status === "submitted" ? <div className="mb-7 flex items-center gap-2 text-[14px] text-neutral-500"><span className="h-2 w-2 animate-pulse rounded-full bg-neutral-500" />Navi is thinking</div> : null}
              {error ? (
                <div className="mb-7 rounded-2xl border border-red-400/20 bg-red-500/10 p-4">
                  <p className="text-[14px] leading-5 text-red-100">{error.message || "Navi could not complete that response."}</p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => { clearError(); void regenerate({ body: { route, style } }); }} className="min-h-10 rounded-xl bg-white px-4 text-[13px] font-semibold text-black active:bg-neutral-300">Try again</button>
                    <button type="button" onClick={clearError} className="min-h-10 rounded-xl px-4 text-[13px] font-medium text-neutral-400 active:bg-white/10">Dismiss</button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </main>

        <div className="safe-bottom shrink-0 bg-gradient-to-t from-navi-background via-navi-background to-navi-background/90 px-3 pt-2 shadow-composer">
          <div className="mx-auto w-full max-w-3xl">
            <form onSubmit={submit} className="flex min-h-[54px] items-end gap-2 rounded-[27px] border border-white/10 bg-[#252525] p-2 pl-4 shadow-lg">
              <textarea ref={textareaRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={onKeyDown} rows={1} enterKeyHint="send" autoCapitalize="sentences" autoCorrect="on" spellCheck placeholder="Message Navi" aria-label="Message Navi" className="max-h-40 min-h-[38px] min-w-0 flex-1 overflow-y-auto bg-transparent py-2 text-[16px] leading-[22px] text-white outline-none placeholder:text-neutral-500" />
              <button type={generating ? "button" : "submit"} onClick={generating ? stop : undefined} disabled={!generating && !input.trim()} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${generating || input.trim() ? "bg-white text-black active:bg-neutral-300" : "bg-neutral-700 text-neutral-500"}`} aria-label={generating ? "Stop response" : "Send message"}>
                {generating ? <Square size={15} fill="currentColor" /> : <ArrowUp size={20} strokeWidth={2.4} />}
              </button>
            </form>
            <div className="flex min-h-7 items-center justify-center px-3 text-center text-[10px] leading-4 text-neutral-600">{routeLabel} · Free-tier availability and limits may vary</div>
          </div>
        </div>
      </section>
    </div>
  );
  return <AppShell />;
}
