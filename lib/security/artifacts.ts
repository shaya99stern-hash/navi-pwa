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
  let sanitized = svg;
  let previous: string;
  do {
    previous = sanitized;
    sanitized = sanitized
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, "")
      .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\b[^>]*>/gi, "");
  } while (sanitized !== previous);

  let attrSanitized = sanitized;
  do {
    previous = attrSanitized;
    attrSanitized = attrSanitized
      .replace(/(\s)on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+)/gi, "$1")
      .replace(/\s(?:href|xlink:href)\s*=\s*("|')\s*(?:https?:|javascript:|data:text\/html)[\s\S]*?\1/gi, "");
  } while (attrSanitized !== previous);

  return attrSanitized;
}

export function sanitizeArtifactHtml(html: string): string {
  const inlineScripts: string[] = [];
  const externalScriptPattern = /<script\b[^>]*\bsrc\s*=\s*("|')[^"']+\1[^>]*>[\s\S]*?<\/script>/gi;
  let withoutExternalScripts = html;
  let previous: string;
  do {
    previous = withoutExternalScripts;
    withoutExternalScripts = withoutExternalScripts.replace(externalScriptPattern, "");
  } while (withoutExternalScripts !== previous);
  const protectedHtml = withoutExternalScripts.replace(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi, (_full, script: string) => {
    const index = inlineScripts.push(script) - 1;
    return `__NAVI_INLINE_SCRIPT_${index}__`;
  });

  let sanitizedMarkup = protectedHtml;
  let markupPrevious: string;
  do {
    markupPrevious = sanitizedMarkup;
    sanitizedMarkup = sanitizedMarkup
      .replace(/<\/?(?:iframe|object|embed|base|link)\b[^>]*>/gi, "")
      .replace(/<meta\b[^>]*http-equiv\s*=\s*("|')?refresh\1?[^>]*>/gi, "")
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\s(?:action|formaction|target)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\s(?:href|src)\s*=\s*("|')\s*(?:https?:|javascript:|data:text\/html)[\s\S]*?\1/gi, "");
  } while (sanitizedMarkup !== markupPrevious);

  return sanitizedMarkup.replace(/__NAVI_INLINE_SCRIPT_(\d+)__/g, (_token, rawIndex: string) => {
    const script = inlineScripts[Number(rawIndex)] ?? "";
    return `<script>${script}</script>`;
  });
}

export function buildArtifactDocument(payload: ArtifactPayload, theme: "dark" | "light"): string {
  const background = theme === "dark" ? "#11141C" : "#FFFFFF";
  const foreground = theme === "dark" ? "#F5F7FB" : "#101623";
  const muted = theme === "dark" ? "#9AA4BA" : "#5B6578";
  const border = theme === "dark" ? "#2B3345" : "#D9E0EC";
  const surface = theme === "dark" ? "#181D28" : "#F4F7FB";
  const accent = "#4F7CFF";
  const content = payload.kind === "svg" ? sanitizeSvgText(payload.svg ?? "") : sanitizeArtifactHtml(payload.html ?? "");
  const rendered = payload.kind === "svg" ? `<div class="svg-wrap">${content}</div>` : content;
  const hasArtifactScript = payload.kind === "html" && /<script\b(?![^>]*\bsrc\s*=)/i.test(content);

  const fallbackInteractions = hasArtifactScript ? "" : `
    const getStatus = host => {
      let status = host.querySelector('[data-navi-status]');
      if (!status) {
        status = document.createElement('div');
        status.setAttribute('data-navi-status', 'true');
        status.setAttribute('role', 'status');
        host.appendChild(status);
      }
      return status;
    };
    document.addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!button || button.disabled) return;
      button.classList.add('navi-activated');
      button.setAttribute('aria-pressed', 'true');
      const host = button.closest('form,section,article,main,div') || document.body;
      const status = getStatus(host);
      const label = (button.textContent || 'Action').trim();
      status.textContent = button.dataset.result || button.dataset.success || label + ' completed.';
      send('artifact:interaction', { action: button.dataset.action || 'button', label });
      resize();
    });
    document.addEventListener('submit', event => {
      event.preventDefault();
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const status = getStatus(form);
      status.textContent = form.dataset.success || 'Submitted securely inside this artifact.';
      send('artifact:interaction', { action: form.dataset.action || 'submit' });
      resize();
    });
  `;

  const bridge = `
    const send = (type, extra = {}) => parent.postMessage({ type, id: ${JSON.stringify(payload.id)}, ...extra }, '*');
    const resize = () => send('artifact:resize', { height: Math.ceil(document.documentElement.scrollHeight) });
    ${fallbackInteractions}
    addEventListener('load', () => { send('artifact:ready', { height: Math.ceil(document.documentElement.scrollHeight) }); resize(); });
    new ResizeObserver(resize).observe(document.documentElement);
    addEventListener('error', event => send('artifact:error', { message: String(event.message || 'Artifact error') }));
  `;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="${theme}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline' blob:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;background:${background};color:${foreground};font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif}body{padding:16px;overflow:auto}*{box-sizing:border-box}.svg-wrap{display:flex;align-items:center;justify-content:center;min-height:180px}.svg-wrap svg{max-width:100%;height:auto}pre{overflow:auto;border:1px solid ${border};border-radius:12px;padding:12px}button,input,select,textarea{font:inherit}button{min-height:44px;border:1px solid ${border};border-radius:12px;background:${surface};color:inherit;padding:10px 14px;cursor:pointer;transition:transform .12s ease,background .12s ease,opacity .12s ease}button:active{transform:scale(.97)}button.navi-activated{background:${accent};border-color:${accent};color:#fff}input,select,textarea{width:100%;min-height:44px;border:1px solid ${border};border-radius:12px;background:${surface};color:${foreground};padding:10px 12px;outline:none}input:focus,select:focus,textarea:focus{border-color:${accent}}label{display:block;margin:10px 0 6px;color:${muted};font-size:13px}[data-navi-status]{margin-top:12px;border:1px solid ${border};border-radius:12px;background:${surface};padding:10px 12px;color:${foreground};font-size:14px}</style></head><body>${rendered}<script>${bridge}<\/script></body></html>`;
}
