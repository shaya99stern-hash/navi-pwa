import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { decodeBase64Url, encodeRfc822, googleWritesEnabled } from "../google/oauth";

/**
 * Gmail and Calendar, as tools the model can call.
 *
 * Reads are always offered once an account is connected. Composing is not:
 * `gmail_send` and `calendar_create` appear only when the deployment sets
 * `NAVI_GOOGLE_ALLOW_WRITES=true`, which is the same posture repository writes
 * take. Sending mail is irreversible and leaves the device, and a model doing
 * that on its own judgement from a phone is a different product.
 *
 * `gmail_draft` sits deliberately on the read side of that line. A draft is
 * reversible, stays inside the account, and is what "write me an email" almost
 * always means — so the useful half of composing survives with writes off.
 */

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_BODY_CHARS = 12_000;
const MAX_ITEMS = 15;

type Announce = (label: string) => void;

export type GoogleToolContext = {
  /** A live access token, already traded for the stored refresh token. */
  accessToken?: string;
};

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const forward = () => controller.abort();
  outer?.addEventListener("abort", forward);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", forward);
  }
}

function clip(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}\n\n[…truncated, ${value.length - limit} more characters]` : value;
}

async function googleFetch(
  token: string,
  url: string,
  signal: AbortSignal,
  init?: { method?: string; body?: unknown }
): Promise<any> {
  const response = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {})
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal,
    cache: "no-store"
  });

  /* 403 here almost always means the grant predates a scope change rather than
     that anything is wrong with the request, so say which it is — the fix is a
     reconnect, and "Google returned 403" sends people to the wrong place. */
  if (response.status === 401 || response.status === 403) {
    throw new Error("This Google connection does not cover that. Reconnect the account in Connectors to grant it.");
  }
  if (response.status === 404) throw new Error("Not found.");
  if (!response.ok) throw new Error(`The request was refused (${response.status}).`);
  return response.json();
}

/** Gmail nests the readable body somewhere inside a part tree; find it. */
function extractBody(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  for (const part of payload.parts ?? []) {
    if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data);
  }
  for (const part of payload.parts ?? []) {
    const nested = extractBody(part);
    if (nested) return nested;
  }
  return "";
}

function header(payload: any, name: string): string {
  const match = (payload?.headers ?? []).find(
    (entry: { name?: string }) => entry.name?.toLowerCase() === name.toLowerCase()
  );
  return match?.value ?? "";
}

export function buildGoogleTools(onActivity?: Announce, context?: GoogleToolContext): ToolSet {
  const token = context?.accessToken?.trim();
  if (!token) return {};

  const tools: ToolSet = {};
  const say = (label: string) => onActivity?.(label);
  const call = (url: string, signal: AbortSignal, init?: { method?: string; body?: unknown }) =>
    googleFetch(token, url, signal, init);

  tools.gmail_search = tool({
    description:
      "Search the user's Gmail and return matching messages as sender, subject, date and snippet. Use Gmail's own query syntax (from:, subject:, has:attachment, newer_than:7d, is:unread). Call this before gmail_read to find the message id.",
    inputSchema: z.object({
      query: z.string().describe('A Gmail search query, for example "from:stripe newer_than:30d".'),
      limit: z.number().int().min(1).max(MAX_ITEMS).optional().describe("How many messages to return. Defaults to 10.")
    }),
    execute: async ({ query, limit }, { abortSignal }) =>
      withTimeout(async (signal) => {
        say("Searching mail");
        const count = Math.min(limit ?? 10, MAX_ITEMS);
        const list = await call(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${count}`,
          signal
        );
        const ids: string[] = (list.messages ?? []).map((message: { id: string }) => message.id);
        if (!ids.length) return { query, messages: [], note: "No messages matched." };

        /* Gmail's list endpoint returns ids only, so each message costs a second
           request. Metadata format keeps those small — the body is what
           gmail_read is for. */
        const messages = await Promise.all(
          ids.map(async (id) => {
            const detail = await call(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
              signal
            );
            return {
              id,
              from: header(detail.payload, "From"),
              subject: header(detail.payload, "Subject"),
              date: header(detail.payload, "Date"),
              snippet: detail.snippet ?? "",
              unread: (detail.labelIds ?? []).includes("UNREAD")
            };
          })
        );
        return { query, messages };
      }, abortSignal)
  });

  tools.gmail_read = tool({
    description:
      "Read one Gmail message in full, including its body text. Takes a message id from gmail_search. Use when the snippet is not enough to answer.",
    inputSchema: z.object({
      messageId: z.string().describe("The message id returned by gmail_search.")
    }),
    execute: async ({ messageId }, { abortSignal }) =>
      withTimeout(async (signal) => {
        say("Reading a message");
        const detail = await call(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
          signal
        );
        return {
          id: messageId,
          from: header(detail.payload, "From"),
          to: header(detail.payload, "To"),
          subject: header(detail.payload, "Subject"),
          date: header(detail.payload, "Date"),
          body: clip(extractBody(detail.payload) || detail.snippet || "", MAX_BODY_CHARS)
        };
      }, abortSignal)
  });

  tools.gmail_draft = tool({
    description:
      "Save a draft email in the user's Gmail. Nothing is sent — the draft waits in their account for them to review. Prefer this whenever the user asks you to write an email.",
    inputSchema: z.object({
      to: z.string().describe("Recipient address."),
      subject: z.string().describe("Subject line."),
      body: z.string().describe("Plain-text body."),
      cc: z.string().optional().describe("Optional Cc address.")
    }),
    execute: async ({ to, subject, body, cc }, { abortSignal }) =>
      withTimeout(async (signal) => {
        say("Saving a draft");
        const created = await call("https://gmail.googleapis.com/gmail/v1/users/me/drafts", signal, {
          method: "POST",
          body: { message: { raw: encodeRfc822({ to, subject, body, cc }) } }
        });
        return { draftId: created.id ?? null, to, subject, saved: true, sent: false };
      }, abortSignal)
  });

  tools.calendar_list_events = tool({
    description:
      "List upcoming events from the user's primary Google Calendar. Use for questions about their schedule, availability, or what is coming up.",
    inputSchema: z.object({
      days: z.number().int().min(1).max(90).optional().describe("How many days ahead to look. Defaults to 7."),
      query: z.string().optional().describe("Optional free-text filter on event titles.")
    }),
    execute: async ({ days, query }, { abortSignal }) =>
      withTimeout(async (signal) => {
        say("Checking the calendar");
        const now = new Date();
        const until = new Date(now.getTime() + (days ?? 7) * 24 * 60 * 60 * 1000);
        const parameters = new URLSearchParams({
          timeMin: now.toISOString(),
          timeMax: until.toISOString(),
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: String(MAX_ITEMS)
        });
        if (query) parameters.set("q", query);

        const result = await call(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?${parameters.toString()}`,
          signal
        );
        const events = (result.items ?? []).map((item: any) => ({
          id: item.id,
          title: item.summary ?? "(no title)",
          start: item.start?.dateTime ?? item.start?.date ?? "",
          end: item.end?.dateTime ?? item.end?.date ?? "",
          location: item.location ?? "",
          allDay: Boolean(item.start?.date)
        }));
        return { from: now.toISOString(), to: until.toISOString(), events };
      }, abortSignal)
  });

  /* Everything past this point leaves the device irreversibly. */
  if (!googleWritesEnabled()) return tools;

  tools.gmail_send = tool({
    description:
      "Send an email from the user's Gmail immediately. This cannot be undone. Only use when the user has clearly asked to send rather than to draft; otherwise use gmail_draft.",
    inputSchema: z.object({
      to: z.string().describe("Recipient address."),
      subject: z.string().describe("Subject line."),
      body: z.string().describe("Plain-text body."),
      cc: z.string().optional().describe("Optional Cc address.")
    }),
    execute: async ({ to, subject, body, cc }, { abortSignal }) =>
      withTimeout(async (signal) => {
        say("Sending mail");
        const result = await call("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", signal, {
          method: "POST",
          body: { raw: encodeRfc822({ to, subject, body, cc }) }
        });
        return { messageId: result.id ?? null, to, subject, sent: true };
      }, abortSignal)
  });

  tools.calendar_create_event = tool({
    description:
      "Create an event on the user's primary Google Calendar. Times must be ISO 8601 with an offset, for example 2026-08-06T14:00:00-04:00.",
    inputSchema: z.object({
      title: z.string().describe("Event title."),
      start: z.string().describe("ISO 8601 start time with a UTC offset."),
      end: z.string().describe("ISO 8601 end time with a UTC offset."),
      description: z.string().optional().describe("Optional longer description."),
      location: z.string().optional().describe("Optional location.")
    }),
    execute: async ({ title, start, end, description, location }, { abortSignal }) =>
      withTimeout(async (signal) => {
        say("Adding to the calendar");
        const created = await call("https://www.googleapis.com/calendar/v3/calendars/primary/events", signal, {
          method: "POST",
          body: {
            summary: title,
            description,
            location,
            start: { dateTime: start },
            end: { dateTime: end }
          }
        });
        return { eventId: created.id ?? null, title, start, end, link: created.htmlLink ?? null };
      }, abortSignal)
  });

  return tools;
}
