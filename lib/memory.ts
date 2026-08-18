import type { StoredChat } from "./ai/types";
import { messageText } from "./chat";

/**
 * Cross-conversation recall, computed on this device.
 *
 * Every new chat used to start from zero, so the same context had to be
 * re-explained each time — the single most "not intelligent" thing the app
 * did, and nothing to do with the model's weights. This finds the passages in
 * *past* chats that bear on the current question and hands them forward.
 *
 * Deliberately lexical rather than embedding-based: scoring is a scan over
 * text already in IndexedDB, so it costs no model call, no network, no extra
 * storage, and works offline. Embeddings would rank better on paraphrase, but
 * they need a model download and a vector index — worth revisiting only once
 * this proves too blunt in practice.
 */

/** Passages carried into the prompt, and the ceiling on their combined size. */
const MAX_PASSAGES = 4;
const MEMORY_BUDGET = 2_400;
const MAX_PASSAGE_CHARS = 700;
/** Chats older than this rarely bear on a new question. */
const MAX_AGE_MS = 120 * 24 * 60 * 60 * 1_000;
/** Below this a "match" is coincidence, not recall. */
const MIN_SCORE = 2.5;

/* Words that match everywhere and therefore discriminate nowhere. */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "doing",
  "have", "has", "had", "having", "i", "you", "he", "she", "it", "we", "they", "me", "him",
  "her", "us", "them", "my", "your", "his", "its", "our", "their", "what", "which", "who",
  "whom", "how", "why", "when", "where", "can", "could", "would", "should", "will", "shall",
  "may", "might", "must", "of", "in", "on", "at", "to", "for", "with", "from", "by", "about",
  "as", "into", "like", "through", "after", "before", "between", "out", "up", "down", "off",
  "over", "under", "again", "once", "here", "there", "all", "any", "both", "each", "few",
  "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so",
  "too", "very", "just", "also", "get", "got", "make", "made", "want", "need", "please",
  "thanks", "thank", "ok", "okay", "yes", "yeah", "know", "think", "see", "use", "using"
]);

/**
 * Split text into the words that actually discriminate.
 *
 * Exported so repository retrieval scores file paths with the same tokenizer
 * that scores past conversations. Two tokenizers would drift, and the second
 * one would be written from memory of the first.
 */
export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && word.length < 32 && !STOPWORDS.has(word));
}

/** Rarer words say more about a topic than common ones. */
export function inverseFrequency(documents: string[][]): Map<string, number> {
  const seen = new Map<string, number>();
  for (const document of documents) {
    for (const word of new Set(document)) seen.set(word, (seen.get(word) ?? 0) + 1);
  }
  const total = Math.max(1, documents.length);
  const weights = new Map<string, number>();
  for (const [word, count] of seen) weights.set(word, Math.log(1 + total / count));
  return weights;
}

export type MemoryPassage = {
  chatId: string;
  chatTitle: string;
  updatedAt: number;
  text: string;
  score: number;
};

/**
 * Rank passages from other chats against the current question.
 *
 * A "passage" is one exchange — the question and the answer it drew — because
 * an answer without its question is frequently unreadable out of context.
 */
export function recall(question: string, chats: StoredChat[], currentChatId: string): MemoryPassage[] {
  const query = terms(question);
  if (query.length < 2) return [];

  const cutoff = Date.now() - MAX_AGE_MS;
  const candidates: Array<{ passage: Omit<MemoryPassage, "score">; words: string[] }> = [];

  for (const chat of chats) {
    if (chat.id === currentChatId || chat.updatedAt < cutoff) continue;
    const messages = chat.messages;
    for (let index = 0; index < messages.length; index += 1) {
      if (messages[index].role !== "user") continue;
      const asked = messageText(messages[index]);
      if (!asked) continue;
      const answered = messages[index + 1]?.role === "assistant" ? messageText(messages[index + 1]) : "";
      const text = answered
        ? `You asked: ${asked.slice(0, MAX_PASSAGE_CHARS / 2)}\nNavi Soul answered: ${answered.slice(0, MAX_PASSAGE_CHARS)}`
        : `You asked: ${asked.slice(0, MAX_PASSAGE_CHARS)}`;
      candidates.push({
        passage: { chatId: chat.id, chatTitle: chat.title, updatedAt: chat.updatedAt, text },
        words: terms(`${asked} ${answered}`)
      });
    }
  }
  if (!candidates.length) return [];

  const weights = inverseFrequency(candidates.map((candidate) => candidate.words));
  const queryTerms = new Set(query);
  const now = Date.now();

  const ranked = candidates
    .map(({ passage, words }) => {
      const present = new Set(words);
      let score = 0;
      for (const word of queryTerms) if (present.has(word)) score += weights.get(word) ?? 0;
      // Long passages match more words by accident; normalise a little.
      score /= Math.log(8 + words.length);
      // A recent conversation is likelier to still be the thing being resumed.
      const ageDays = (now - passage.updatedAt) / 86_400_000;
      score *= 1 + Math.max(0, 1 - ageDays / 30) * 0.4;
      return { ...passage, score: score * 10 };
    })
    .filter((entry) => entry.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);

  // One passage per chat, so four hits do not all come from one conversation.
  const chosen: MemoryPassage[] = [];
  const usedChats = new Set<string>();
  for (const entry of ranked) {
    if (usedChats.has(entry.chatId)) continue;
    usedChats.add(entry.chatId);
    chosen.push(entry);
    if (chosen.length >= MAX_PASSAGES) break;
  }
  return chosen;
}

/* ------------------------------------------------------------------------
 * Searching, as distinct from recalling.
 *
 * `recall` answers "what bears on this question", ranked, for the model.
 * Search answers "where did I say that", for a person who already knows what
 * they are looking for. Different jobs: recall may return a passage that never
 * contains the words asked about, and search must never do that — a search box
 * that returns something without the term in it reads as broken.
 *
 * The drawer's search matched only the title and a one-line preview, so
 * anything said in the middle of a conversation was unfindable. Everything is
 * already in IndexedDB; nothing needed to be stored to fix this, only read.
 * --------------------------------------------------------------------- */

export type ChatMatch = {
  chat: StoredChat;
  /** The text around the first hit, for showing under the title. */
  snippet: string;
  /** How many messages matched, so a thread about the topic outranks a mention. */
  hits: number;
  score: number;
};

/** Words either side of a hit in the snippet. */
const SNIPPET_RADIUS = 60;

function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + length + SNIPPET_RADIUS);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

/**
 * Find conversations containing a phrase, newest and most relevant first.
 *
 * Substring rather than token matching, because this is a search box: someone
 * typing "redirect_uri" expects the thing they typed, not its stems, and a
 * partial word should match while still being typed.
 */
export function searchConversations(query: string, chats: StoredChat[], limit = 40): ChatMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const matches: ChatMatch[] = [];

  for (const chat of chats) {
    const title = chat.title.toLowerCase();
    const titleHit = title.includes(needle);

    let hits = 0;
    let snippet = "";
    for (const message of chat.messages) {
      const text = messageText(message);
      if (!text) continue;
      const at = text.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      hits += 1;
      /* The first hit in the conversation, not the last: it is usually the
         message that introduced the topic, which is what someone scanning a
         list of results is trying to recognise. */
      if (!snippet) snippet = snippetAround(text, at, needle.length);
    }

    if (!titleHit && !hits) continue;

    /* A title match is a strong signal — it is the name someone gave the
       conversation — but it must not bury a thread that discusses the term at
       length. Both count, and recency only breaks ties. */
    const score = (titleHit ? 8 : 0) + Math.min(hits, 12) + (chat.pinned ? 2 : 0);
    matches.push({
      chat,
      snippet: snippet || chat.preview,
      hits,
      score
    });
  }

  return matches
    .sort((a, b) => b.score - a.score || b.chat.updatedAt - a.chat.updatedAt)
    .slice(0, limit);
}

/** Render recalled passages for the prompt, bounded by the budget. */
export function memoryBlock(passages: MemoryPassage[]): string {
  if (!passages.length) return "";
  const lines: string[] = [];
  let used = 0;
  for (const passage of passages) {
    const entry = `From an earlier conversation titled “${passage.chatTitle}”:\n${passage.text}`;
    if (used + entry.length > MEMORY_BUDGET) break;
    used += entry.length;
    lines.push(entry);
  }
  if (!lines.length) return "";
  return [
    "Possibly relevant context from this user's earlier conversations on this device.",
    "Use it only where it genuinely bears on the current question; ignore it otherwise, and never claim to remember something that is not here.",
    "",
    lines.join("\n\n")
  ].join("\n");
}

/* ── Searching on demand, rather than being handed four passages ────────────
   `memoryBlock` above is pushed into every prompt whether or not this turn is
   about the past: four passages, 2,400 characters, ranked by a guess at
   relevance made before the model saw the question. That is the right shape
   for background context and the wrong shape for "when did we last talk about
   this" — which needs dates, titles, and however many results there are, not
   a fixed four chosen by a threshold.

   So the model gets to ask. This renders the answer; the tool that calls it is
   declared on the server with no `execute` and runs here on the device, for the
   plain reason that the conversations are here — they live in IndexedDB and the
   edge runtime has never seen them.
   ------------------------------------------------------------------------ */

/** Results in one answer. Beyond this it is a list to scroll, not an answer. */
const MAX_HISTORY_RESULTS = 8;
const HISTORY_BUDGET = 4_000;

function ageInWords(from: number, now: number): string {
  const days = Math.floor((now - from) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/**
 * What was said about something, and when.
 *
 * Two passes, and the order matters. Literal search runs first because that is
 * what "search" means to the person asking: someone who says `redirect_uri`
 * wants the conversation containing `redirect_uri`, and a fuzzy match that
 * returns a thread about OAuth generally is a worse answer that looks like a
 * better one. Only when the literal pass finds nothing does the ranked pass
 * run — and the answer says which one produced it, because a topical match
 * presented as a literal one is how "we discussed this on the 3rd" becomes a
 * confident invention.
 *
 * `now` is a parameter so the phrasing of an age is testable rather than
 * dependent on when the suite happens to run.
 */
export function historyAnswer(
  query: string,
  chats: StoredChat[],
  currentChatId: string,
  options: { limit?: number; now?: number } = {}
): string {
  const needle = query.trim();
  if (needle.length < 2) return "A search needs at least two characters.";

  const now = options.now ?? Date.now();
  const limit = Math.min(Math.max(1, options.limit ?? MAX_HISTORY_RESULTS), MAX_HISTORY_RESULTS);

  const literal = searchConversations(needle, chats, limit);
  if (literal.length) {
    const lines = [`${literal.length} conversation${literal.length === 1 ? "" : "s"} contain “${needle}”, most relevant first.`, ""];
    let used = 0;
    for (const match of literal) {
      const here = match.chat.id === currentChatId ? " — this is the conversation you are in now" : "";
      const entry = [
        `### ${match.chat.title}`,
        `${ageInWords(match.chat.updatedAt, now)}, ${new Date(match.chat.updatedAt).toISOString().slice(0, 10)}${here}`,
        `${match.hits} message${match.hits === 1 ? "" : "s"} mention it. First one: ${match.snippet}`
      ].join("\n");
      if (used + entry.length > HISTORY_BUDGET) break;
      used += entry.length;
      lines.push(entry, "");
    }
    lines.push("These are conversations that literally contain those words. Quote them as what was said; say the title and when, so it can be found in Recents.");
    return lines.join("\n");
  }

  /* Nothing said those words. The ranked pass can still find the conversation
     that was *about* it — but it is a different claim and is labelled as one. */
  const related = recall(needle, chats, currentChatId);
  if (!related.length) {
    return `Nothing in the saved conversations on this device mentions “${needle}”, and nothing reads as being about it either. Say that plainly rather than reconstructing what might have been said.`;
  }

  return [
    `No conversation contains the words “${needle}”. These read as being about it, ranked by relevance rather than found literally:`,
    "",
    ...related.map((passage) => [
      `### ${passage.chatTitle}`,
      `${ageInWords(passage.updatedAt, now)}, ${new Date(passage.updatedAt).toISOString().slice(0, 10)}`,
      passage.text
    ].join("\n")),
    "",
    "These matched by topic, not by wording. Say so — do not present them as the words that were used."
  ].join("\n");
}
