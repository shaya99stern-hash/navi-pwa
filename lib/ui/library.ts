import type { AttachmentMeta, GeneratedImagePayload, StoredChat } from "@/lib/ai/types";

/**
 * What the app already has, gathered into something you can look at.
 *
 * The manifest, the OG copy and the app's own subtitle all promise
 * "conversations, files, images". Files existed only as `AttachmentMeta`
 * stamped onto whichever chat they were sent in, and generated images only as
 * a card inside the thread that produced them — so something sent last Tuesday
 * was findable only by remembering which conversation it was in.
 *
 * Nothing new is stored. Both lists are folded out of the chats already in
 * IndexedDB, which is why this is a pure function over `StoredChat[]` rather
 * than a second copy of the data that could drift from the first.
 */

export type LibraryFile = {
  /** Stable within a render: the same file in the same chat keeps its key. */
  id: string;
  name: string;
  type: string;
  size: number;
  chatId: string;
  chatTitle: string;
  /** The chat's own timestamp. An attachment carries no date of its own. */
  sentAt: number;
};

export type LibraryImage = {
  id: string;
  title: string;
  alt: string;
  mimeType: GeneratedImagePayload["mimeType"];
  data: string;
  prompt: string;
  chatId: string;
  chatTitle: string;
  madeAt: number;
};

/** Which of the four groups a file's icon and tint come from. */
export type FileKind = "pdf" | "image" | "text" | "data";

export function fileKind(type: string, name: string): FileKind {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (type === "application/pdf" || extension === "pdf") return "pdf";
  if (type.startsWith("image/")) return "image";
  if (type === "text/csv" || type === "application/json" || extension === "csv" || extension === "json") return "data";
  return "text";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A date the way the drawer says it: this week by weekday, older by date.
 * Anything in the future — a clock that moved — reads as today rather than as
 * a date nobody can act on.
 */
export function formatWhen(at: number, now = Date.now()): string {
  const elapsed = now - at;
  if (elapsed < 0 || elapsed < 12 * 60 * 60 * 1000) return "Today";
  if (elapsed < 7 * 24 * 60 * 60 * 1000) {
    return new Date(at).toLocaleDateString(undefined, { weekday: "short" });
  }
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** True while the file was sent within the last seven days. */
export function isThisWeek(at: number, now = Date.now()): boolean {
  return now - at < 7 * 24 * 60 * 60 * 1000;
}

export function collectFiles(chats: StoredChat[]): LibraryFile[] {
  const files: LibraryFile[] = [];
  for (const chat of chats) {
    const attachments: AttachmentMeta[] = chat.attachments ?? [];
    attachments.forEach((attachment, index) => {
      files.push({
        id: `${chat.id}:${index}:${attachment.name}`,
        name: attachment.name,
        type: attachment.type,
        size: attachment.size,
        chatId: chat.id,
        chatTitle: chat.title,
        sentAt: chat.updatedAt
      });
    });
  }
  return files.sort((a, b) => b.sentAt - a.sentAt);
}

/**
 * Generated images are written into the reply as a ```navi-image fence, which
 * makes the message text the only place they exist. Parsing it back out is
 * what lets the gallery read straight off local state with nothing new stored.
 *
 * A malformed fence is skipped rather than thrown: one bad payload in a long
 * history should cost that image, not the whole screen.
 */
const IMAGE_FENCE = /```navi-image\s*\n([\s\S]*?)```/g;

export function collectImages(chats: StoredChat[]): LibraryImage[] {
  const images: LibraryImage[] = [];
  for (const chat of chats) {
    for (const message of chat.messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (part.type !== "text") continue;
        const text = part.text;
        if (!text.includes("navi-image")) continue;
        IMAGE_FENCE.lastIndex = 0;
        let match = IMAGE_FENCE.exec(text);
        while (match) {
          try {
            const payload = JSON.parse(match[1].trim()) as Partial<GeneratedImagePayload>;
            if (payload && typeof payload.data === "string" && typeof payload.id === "string") {
              images.push({
                id: `${chat.id}:${payload.id}`,
                title: typeof payload.title === "string" ? payload.title : "Untitled",
                alt: typeof payload.alt === "string" ? payload.alt : "",
                mimeType: payload.mimeType ?? "image/png",
                data: payload.data,
                prompt: typeof payload.prompt === "string" ? payload.prompt : "",
                chatId: chat.id,
                chatTitle: chat.title,
                madeAt: chat.updatedAt
              });
            }
          } catch {
            /* One unreadable payload, not one unreadable gallery. */
          }
          match = IMAGE_FENCE.exec(text);
        }
      }
    }
  }
  return images.sort((a, b) => b.madeAt - a.madeAt);
}

/** Total bytes on device, for the count beside the Files title. */
export function totalBytes(files: LibraryFile[]): number {
  return files.reduce((sum, file) => sum + file.size, 0);
}
