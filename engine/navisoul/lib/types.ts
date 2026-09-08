export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ToolCall = { id: string; name: string; arguments: unknown };
export type ToolResult = { id: string; name: string; ok: boolean; value?: unknown; error?: { code: string; message: string; retryable: boolean } };
export type Message = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] };
export type ArtifactKind = 'html' | 'react' | 'vue' | 'svg' | 'mermaid' | 'latex' | 'markdown';
export type Artifact = { id: string; title: string; kind: ArtifactKind; source: string; version: number; hash: string; parentHash?: string; createdAt: number };
export type EngineEvent = { type: 'status'; message: string } | { type: 'text'; text: string } | { type: 'reset'; reason: string } | { type: 'artifact'; artifact: Artifact } | { type: 'tool'; name: string; state: 'running' | 'done' | 'failed' } | { type: 'error'; message: string } | { type: 'done' };
