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
        ? `You asked: ${asked.slice(0, MAX_PASSAGE_CHARS / 2)}\nNavi answered: ${answered.slice(0, MAX_PASSAGE_CHARS)}`
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
