/** Validators. Each says why something failed, not just that it did. */
import type { Executor } from "../registry";
import { fail, ok, str } from "./text";

export const emailValidate: Executor = async (input) => {
  const value = str(input).trim();
  if (!value) return fail("Give an address.");
  const shape = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
  const notes: string[] = [];
  if (value.includes("..")) notes.push("consecutive dots are not allowed");
  if (/^[.]|[.]@/.test(value)) notes.push("the local part cannot start or end with a dot");
  if (value.length > 254) notes.push("over the 254-character limit");
  const valid = shape && !notes.length;
  return ok(`${valid ? "Valid" : "Invalid"}: ${value}${notes.length ? `\n- ${notes.join("\n- ")}` : shape ? "" : "\n- not in local@domain.tld form"}`);
};

export const urlValidate: Executor = async (input) => {
  const value = str(input).trim();
  try {
    const u = new URL(value);
    return ok([`Valid URL`, `protocol ${u.protocol}`, `host     ${u.host}`, `path     ${u.pathname}`, u.search ? `query    ${u.search}` : "", u.hash ? `hash     ${u.hash}` : ""].filter(Boolean).join("\n"));
  } catch {
    return ok(`Invalid URL: ${value}\n- include a scheme, e.g. https://`);
  }
};

export const ipValidate: Executor = async (input) => {
  const value = str(input).trim();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (v4) {
    const parts = v4.slice(1).map(Number);
    if (parts.every((n) => n >= 0 && n <= 255)) {
      const [a, b] = parts;
      const kind = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ? "private"
        : a === 127 ? "loopback" : a === 169 && b === 254 ? "link-local" : "public";
      return ok(`Valid IPv4 (${kind})`);
    }
    return ok("Invalid IPv4 — each octet must be 0-255.");
  }
  if (/^[0-9a-f:]+$/i.test(value) && value.includes(":") && (value.match(/::/g) ?? []).length <= 1) {
    return ok("Valid IPv6");
  }
  return ok(`Invalid IP address: ${value}`);
};

/** Luhn — the same check used at every payment form. */
function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export const creditCardValidate: Executor = async (input) => {
  const digits = str(input).replace(/[\s-]/g, "");
  if (!/^\d{12,19}$/.test(digits)) return fail("Give 12-19 digits.");
  const brand = /^4/.test(digits) ? "Visa"
    : /^5[1-5]|^2[2-7]/.test(digits) ? "Mastercard"
    : /^3[47]/.test(digits) ? "American Express"
    : /^6(?:011|5)/.test(digits) ? "Discover"
    : /^3(?:0[0-5]|[68])/.test(digits) ? "Diners Club"
    : /^35/.test(digits) ? "JCB" : "unknown";
  return ok(`${luhn(digits) ? "Passes" : "Fails"} the Luhn check — ${brand}. A Luhn pass means well-formed, not that the account exists.`);
};

export const ibanValidate: Executor = async (input) => {
  const value = str(input).replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(value)) return fail("Give an IBAN, e.g. GB82WEST12345698765432.");
  const rearranged = value.slice(4) + value.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  return ok(`${remainder === 1 ? "Valid" : "Invalid"} IBAN — country ${value.slice(0, 2)}, ${value.length} characters.`);
};

export const isbnValidate: Executor = async (input) => {
  const value = str(input).replace(/[\s-]/g, "").toUpperCase();
  if (value.length === 10) {
    let sum = 0;
    for (let i = 0; i < 10; i += 1) {
      const c = value[i];
      const d = c === "X" && i === 9 ? 10 : Number(c);
      if (!Number.isFinite(d)) return fail("ISBN-10 digits must be 0-9, with an optional trailing X.");
      sum += d * (10 - i);
    }
    return ok(`${sum % 11 === 0 ? "Valid" : "Invalid"} ISBN-10`);
  }
  if (value.length === 13 && /^\d{13}$/.test(value)) {
    const sum = [...value].reduce((acc, c, i) => acc + Number(c) * (i % 2 ? 3 : 1), 0);
    return ok(`${sum % 10 === 0 ? "Valid" : "Invalid"} ISBN-13`);
  }
  return fail("Give a 10- or 13-character ISBN.");
};

export const macAddressValidate: Executor = async (input) => {
  const value = str(input).trim();
  if (!/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(value) && !/^[0-9a-f]{12}$/i.test(value)) {
    return ok(`Invalid MAC address: ${value}`);
  }
  const hex = value.replace(/[:-]/g, "").toLowerCase();
  const first = parseInt(hex.slice(0, 2), 16);
  return ok([
    "Valid MAC address",
    `normalised ${hex.match(/../g)!.join(":")}`,
    `${first & 0b10 ? "locally administered" : "globally unique"}, ${first & 1 ? "multicast" : "unicast"}`
  ].join("\n"));
};

export const hexColorValidate: Executor = async (input) => {
  const value = str(input).trim();
  const okShape = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
  return ok(okShape ? `Valid hex colour (${value.replace(/^#?/, "#")})` : `Invalid hex colour: ${value}`);
};

export const semverCompare: Executor = async (input) => {
  const found = str(input).match(/\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?/gi) ?? [];
  if (found.length < 2) return fail("Give two versions, e.g. /semver-compare 1.2.3 1.10.0");
  const parse = (v: string) => {
    const [core, pre] = v.split("-");
    return { nums: core.split(".").map(Number), pre: pre ?? "" };
  };
  const [a, b] = found.map(parse);
  let cmp = 0;
  for (let i = 0; i < 3 && !cmp; i += 1) cmp = Math.sign(a.nums[i] - b.nums[i]);
  /* A prerelease sorts below its own release — 1.0.0-rc1 < 1.0.0. */
  if (!cmp) cmp = a.pre === b.pre ? 0 : !a.pre ? 1 : !b.pre ? -1 : a.pre < b.pre ? -1 : 1;
  return ok(cmp === 0 ? `${found[0]} equals ${found[1]}` : cmp > 0 ? `${found[0]} is newer than ${found[1]}` : `${found[0]} is older than ${found[1]}`);
};

export const phoneFormat: Executor = async (input) => {
  const digits = str(input).replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 7) return fail("Give at least 7 digits.");
  const country = String(input.country ?? "").toUpperCase();
  const bare = digits.replace(/\D/g, "");
  if (country === "US" || bare.length === 10) {
    const n = bare.slice(-10);
    return ok(`(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}\nE.164: +1${n}`);
  }
  return ok(`E.164: ${digits.startsWith("+") ? digits : `+${bare}`}\nGrouped: ${bare.replace(/(\d{2,4})(?=\d)/g, "$1 ").trim()}`);
};

export const cronDescribe: Executor = async (input) => {
  const parts = str(input).trim().split(/\s+/);
  if (parts.length < 5) return fail("Give five fields: minute hour day-of-month month day-of-week.");
  const [min, hour, dom, mon, dow] = parts;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const every = (f: string, unit: string) => f === "*" ? `every ${unit}` : f.startsWith("*/") ? `every ${f.slice(2)} ${unit}s` : `${unit} ${f}`;
  const time = min !== "*" && hour !== "*" ? `at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}` : `${every(min, "minute")}, ${every(hour, "hour")}`;
  const dowText = dow === "*" ? "" : ` on ${dow.split(",").map((d) => days[Number(d) % 7] ?? d).join(", ")}`;
  const domText = dom === "*" ? "" : ` on day ${dom} of the month`;
  const monText = mon === "*" ? "" : ` in month ${mon}`;
  return ok(`${time}${dowText}${domText}${monText}. Times follow the server's timezone unless the scheduler says otherwise.`);
};

export const postcodeValidate: Executor = async (input) => {
  const value = str(input).trim().toUpperCase();
  const patterns: [string, RegExp][] = [
    ["UK", /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/],
    ["US ZIP", /^\d{5}(-\d{4})?$/],
    ["Canada", /^[A-Z]\d[A-Z]\s*\d[A-Z]\d$/],
    ["Netherlands", /^\d{4}\s*[A-Z]{2}$/],
    ["Germany/France/Spain", /^\d{5}$/],
    ["Australia", /^\d{4}$/]
  ];
  const hit = patterns.find(([, re]) => re.test(value));
  return ok(hit ? `Looks like a valid ${hit[0]} postcode.` : `No known postcode format matches "${value}".`);
};

export const checksumVerify: Executor = async (input) => {
  const text = str(input);
  const expected = String(input.expected ?? "").trim().toLowerCase();
  if (!text) return fail("Give text and expected= to compare against.");
  const algorithm = String(input.algorithm ?? "SHA-256").toUpperCase().replace(/^SHA(\d)/, "SHA-$1");
  const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(text));
  const actual = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!expected) return ok(`${algorithm}: ${actual}`);
  return ok(actual === expected ? `Match — ${algorithm} ${actual}` : `NO MATCH\nexpected ${expected}\nactual   ${actual}`);
};

export const jsonSchemaLite: Executor = async (input) => {
  const text = str(input);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch (error) { return fail(`Not valid JSON: ${(error as Error).message}`); }
  const describe = (value: unknown, depth = 0): string => {
    const pad = "  ".repeat(depth);
    if (Array.isArray(value)) return `array<${value.length ? describe(value[0], depth).trim() : "unknown"}>`;
    if (value === null) return "null";
    if (typeof value !== "object") return typeof value;
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return "object";
    return `{\n${entries.map(([k, v]) => `${pad}  ${k}: ${describe(v, depth + 1)}`).join("\n")}\n${pad}}`;
  };
  return ok(describe(parsed));
};
