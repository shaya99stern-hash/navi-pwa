import type { ArtifactPayload } from "../ai/types";

const MAX_ARTIFACT_BYTES = 180_000;

export function validateArtifactPayload(value: unknown): { ok: true; payload: ArtifactPayload } | { ok: false; error: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "Artifact payload must be an object." };
  const candidate = value as Partial<ArtifactPayload>;
  if (typeof candidate.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(candidate.id)) return { ok: false, error: "Artifact id is invalid." };
  if (typeof candidate.title !== "string" || candidate.title.trim().length < 1 || candidate.title.length > 120) return { ok: false, error: "Artifact title is invalid." };
  if (candidate.kind !== "html" && candidate.kind !== "svg") return { ok: false, error: "Artifact kind must be html or svg." };
  const content = candidate.kind === "html" ? candidate.html : candidate.svg;
  if (typeof content !== "string" || content.length < 1) return { ok: false, error: "Artifact content is missing." };
  if (new TextEncoder().encode(content).byteLength > MAX_ARTIFACT_BYTES) return { ok: false, error: "Artifact is too large." };
  return {
    ok: true,
    payload: {
      id: candidate.id,
      title: candidate.title.trim(),
      kind: candidate.kind,
      html: candidate.kind === "html" ? content : undefined,
      svg: candidate.kind === "svg" ? content : undefined,
      height: typeof candidate.height === "number" ? Math.min(900, Math.max(180, candidate.height)) : 360
    }
  };
}

export function sanitizeSvgText(svg: string): string {
  return svg
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:href|xlink:href)\s*=\s*("|')\s*(?:https?:|javascript:|data:text\/html)[\s\S]*?\1/gi, "");
}

export function sanitizeArtifactHtml(html: string): string {
  return html
    .replace(/<\/?(?:iframe|object|embed|form|base)\b[^>]*>/gi, "")
    .replace(/<meta\b[^>]*http-equiv\s*=\s*("|')?refresh\1?[^>]*>/gi, "")
    .replace(/<script\b[^>]*\bsrc\s*=\s*("|')[^"']+\1[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

export function buildArtifactDocument(payload: ArtifactPayload, theme: "dark" | "light"): string {
  const background = theme === "dark" ? "#11141C" : "#FFFFFF";
  const foreground = theme === "dark" ? "#F5F7FB" : "#101623";
  const border = theme === "dark" ? "#262D3E" : "#D9E0EC";
  const content = payload.kind === "svg" ? sanitizeSvgText(payload.svg ?? "") : sanitizeArtifactHtml(payload.html ?? "");
  const rendered = payload.kind === "svg" ? `<div class="svg-wrap">${content}</div>` : content;
  const bridge = `
    const send = (type, extra = {}) => parent.postMessage({ type, id: ${JSON.stringify(payload.id)}, ...extra }, '*');
    const resize = () => send('artifact:resize', { height: Math.ceil(document.documentElement.scrollHeight) });
    addEventListener('load', () => { send('artifact:ready', { height: Math.ceil(document.documentElement.scrollHeight) }); resize(); });
    new ResizeObserver(resize).observe(document.documentElement);
    addEventListener('error', event => send('artifact:error', { message: String(event.message || 'Artifact error') }));
  `;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline' blob:; connect-src https:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;background:${background};color:${foreground};font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif}body{padding:16px;overflow:hidden}*{box-sizing:border-box}.svg-wrap{display:flex;align-items:center;justify-content:center;min-height:180px}.svg-wrap svg{max-width:100%;height:auto}pre{overflow:auto;border:1px solid ${border};border-radius:12px;padding:12px}button{min-height:40px;border:1px solid ${border};border-radius:12px;background:transparent;color:inherit;padding:8px 12px}</style></head><body>${rendered}<script>${bridge}<\/script></body></html>`;
}
