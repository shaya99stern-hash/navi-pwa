import type { Executor } from "../registry";
import { fail, ok, str } from "./text";

const bytes = (text: string) => new TextEncoder().encode(text);
const decode = (data: Uint8Array) => new TextDecoder().decode(data);

function toBase64(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export const base64: Executor = async (input) => {
  const text = str(input);
  if (input.decode) {
    try {
      return ok(decode(fromBase64(text)));
    } catch {
      return fail("That is not valid Base64.");
    }
  }
  const encoded = toBase64(bytes(text));
  return ok(input.urlSafe ? encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : encoded);
};

export const urlEncode: Executor = async (input) => {
  const text = str(input);
  if (input.decode) {
    try {
      return ok(decodeURIComponent(text));
    } catch {
      return fail("That is not a valid percent-encoded string.");
    }
  }
  return ok(encodeURIComponent(text));
};

const ENTITIES: Array<[string, string]> = [
  ["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]
];

export const htmlEntities: Executor = async (input) => {
  const text = str(input);
  if (input.decode) {
    return ok([...ENTITIES].reverse().reduce((acc, [plain, entity]) =>
      acc.split(entity).join(plain), text).replace(/&nbsp;/g, " "));
  }
  return ok(ENTITIES.reduce((acc, [plain, entity]) => acc.split(plain).join(entity), text));
};

export const hexConvert: Executor = async (input) => {
  const text = str(input);
  if (input.decode) {
    const clean = text.replace(/[^0-9a-f]/gi, "");
    if (clean.length % 2) return fail("Hex input must have an even number of digits.");
    return ok(decode(Uint8Array.from(clean.match(/../g) ?? [], (h) => parseInt(h, 16))));
  }
  return ok([...bytes(text)].map((b) => b.toString(16).padStart(2, "0")).join(" "));
};

export const binaryConvert: Executor = async (input) => {
  const text = str(input);
  const radix = input.octal ? 8 : 2;
  const width = input.octal ? 3 : 8;
  if (input.decode) {
    const parts = text.trim().split(/\s+/);
    if (parts.some((p) => !new RegExp(`^[0-${radix - 1}]+$`).test(p))) return fail("Input contains non-binary digits.");
    return ok(decode(Uint8Array.from(parts, (p) => parseInt(p, radix))));
  }
  return ok([...bytes(text)].map((b) => b.toString(radix).padStart(width, "0")).join(" "));
};

export const jwtDecode: Executor = async (input) => {
  const parts = str(input).trim().split(".");
  if (parts.length < 2) return fail("A JWT needs at least a header and a payload.");
  try {
    const [header, payload] = parts.map((p) => JSON.parse(decode(fromBase64(p))));
    const exp = typeof payload?.exp === "number" ? new Date(payload.exp * 1000).toISOString() : null;
    return ok({
      header,
      payload,
      expiresAt: exp,
      expired: exp ? Date.parse(exp) < Date.now() : null,
      note: "Decoded only. The signature is NOT verified, so treat these claims as untrusted."
    }, "application/json");
  } catch {
    return fail("That is not a decodable JWT.");
  }
};

export const rot13: Executor = async (input) => {
  const shift = ((Number(input.shift) || 13) % 26 + 26) % 26;
  return ok(str(input).replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + shift) % 26) + base);
  }));
};

export const queryString: Executor = async (input) => {
  const text = str(input).trim();
  if (input.build) {
    try {
      const object = JSON.parse(text) as Record<string, string>;
      return ok(new URLSearchParams(object).toString());
    } catch {
      return fail("Provide a JSON object to build a query string from.");
    }
  }
  const query = text.includes("?") ? text.slice(text.indexOf("?") + 1) : text;
  const params = new URLSearchParams(query);
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    out[key] = all.length > 1 ? all : all[0];
  }
  return ok(out, "application/json");
};

export const unicodeEscape: Executor = async (input) => {
  const text = str(input);
  if (input.decode) {
    return ok(text.replace(/\\u\{([0-9a-f]+)\}/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))));
  }
  return ok([...text].map((c) => {
    const code = c.codePointAt(0) ?? 0;
    if (code < 128) return c;
    return code > 0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, "0")}`;
  }).join(""));
};

const MORSE: Record<string, string> = {
  a: ".-", b: "-...", c: "-.-.", d: "-..", e: ".", f: "..-.", g: "--.", h: "....", i: "..", j: ".---",
  k: "-.-", l: ".-..", m: "--", n: "-.", o: "---", p: ".--.", q: "--.-", r: ".-.", s: "...", t: "-",
  u: "..-", v: "...-", w: ".--", x: "-..-", y: "-.--", z: "--..",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
  "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
  ".": ".-.-.-", ",": "--..--", "?": "..--..", "!": "-.-.--", "/": "-..-.", "-": "-....-", "@": ".--.-."
};
const FROM_MORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

export const morse: Executor = async (input) => {
  const text = str(input).trim();
  if (input.decode || /^[.\-/\s]+$/.test(text)) {
    return ok(text.split(/\s*\/\s*/).map((word) =>
      word.trim().split(/\s+/).map((code) => FROM_MORSE[code] ?? "").join("")).join(" ").trim());
  }
  return ok(text.toLowerCase().split(/\s+/).map((word) =>
    [...word].map((c) => MORSE[c] ?? "").filter(Boolean).join(" ")).join(" / "));
};
