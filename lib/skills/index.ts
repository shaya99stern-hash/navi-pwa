"use client";

import "./executors";
import { match, resolveSlash, run, type Skill, type SkillResult } from "./registry";

export { match, resolveSlash, run, SKILLS, available, categories, getSkill, isImplemented } from "./registry";
export type { Skill, SkillResult } from "./registry";

/**
 * `key=value` pairs become named inputs, everything else becomes `text`.
 * Quotes keep spaces together, so `/find-replace find="a b" replace=c` works.
 */
export function parseArguments(tail: string): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const free: string[] = [];
  const tokens = tail.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];

  for (const token of tokens) {
    const pair = /^([a-zA-Z][a-zA-Z0-9_]*)=(.*)$/s.exec(token);
    if (!pair) {
      free.push(token.replace(/^["']|["']$/g, ""));
      continue;
    }
    const raw = pair[2].replace(/^["']|["']$/g, "");
    input[pair[1]] = raw === "true" ? true
      : raw === "false" ? false
      : raw !== "" && Number.isFinite(Number(raw)) && String(Number(raw)) === raw ? Number(raw)
      : raw;
  }
  if (free.length) input.text = free.join(" ");
  return input;
}

export type SlashInvocation = { skill: Skill; input: Record<string, unknown> };

/** Recognises a leading slash command, or returns null so the model handles it. */
export function parseSlashCommand(source: string): SlashInvocation | null {
  const text = source.trim();
  if (!text.startsWith("/")) return null;
  const skill = resolveSlash(text);
  if (!skill) return null;
  const tail = text.slice(text.split(/\s+/)[0].length).trim();
  return { skill, input: parseArguments(tail) };
}

export function formatSkillResult(result: SkillResult): string {
  if (!result.ok) return `**Could not run that.** ${result.error ?? "Unknown error."}`;
  const { output, mime } = result;
  if (typeof output === "string") {
    // A blank reply reads as the app having failed silently, so name the
    // empty result instead of rendering an empty bubble.
    if (!output.length) return "_That produced an empty result._";
    // Multi-line or code-ish output reads better fenced.
    return output.includes("\n") ? `\`\`\`\n${output}\n\`\`\`` : output;
  }
  if (output === undefined || output === null) return "_That produced no result._";
  const json = JSON.stringify(output, null, 2);
  return `\`\`\`${mime === "application/json" ? "json" : ""}\n${json}\n\`\`\``;
}

export async function runSlash(invocation: SlashInvocation, signal?: AbortSignal): Promise<string> {
  const result = await run(invocation.skill.id, invocation.input, signal);
  return formatSkillResult(result);
}

/** Suggestions for the composer while the user is typing. */
export function suggest(query: string, limit = 6): Skill[] {
  return match(query, limit);
}
