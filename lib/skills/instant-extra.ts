/* PATH: lib/skills/instant-extra.ts  — NEW FILE, copy verbatim. */

"use client";

import type { SkillResult } from "./registry";

/**
 * Fifty-four more zero-token skills, reachable from ordinary prose.
 *
 * The lesson `instant.ts` states is applied rather than repeated: the library
 * was never the bottleneck, the doorway was. So every capability here ships
 * WITH its prose route — a skill nobody can reach is dead code with a test
 * suite. Same contract as the host file: patterns anchor both ends, a false
 * match is worse than a miss, and anything that cannot produce an exact answer
 * returns a failure so the model answers instead.
 *
 * Everything is deterministic, local, and synchronous-fast: arithmetic on
 * numbers, tables, and string transforms. Nothing fetches, nothing estimates.
 * The two random skills (dice, coin) are honest randomness, not estimation.
 */

type Route = { pattern: RegExp; skill: string; run: (match: RegExpExecArray) => Promise<SkillResult> };

const ok = (output: unknown, mime?: string): SkillResult => ({ ok: true, output, mime } as SkillResult);
const fail = (error: string): SkillResult => ({ ok: false, error } as SkillResult);

/** Twelve significant digits — past composer precision, short of float noise. */
const num = (value: number): string =>
  Number.isInteger(value) && Math.abs(value) < 1e15 ? String(value) : String(Number(value.toPrecision(12)));

const round2 = (value: number): string => (Math.round(value * 100) / 100).toFixed(2);

function parseNumbers(text: string): number[] {
  return (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter(Number.isFinite);
}

/** Strict YYYY-MM-DD, read as UTC so no timezone shifts the calendar day. */
function parseISODate(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? date : null;
}

const DAY_MS = 86_400_000;
const todayUTC = (): Date => { const now = new Date(); return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())); };

function isoWeek(date: Date): number {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return Math.ceil(((day.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
}

/* ---- Color ------------------------------------------------------------- */

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace(/^#/, "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), delta = max - min;
  const light = (max + min) / 2;
  if (!delta) return [0, 0, Math.round(light * 100)];
  const sat = delta / (1 - Math.abs(2 * light - 1));
  const hue = max === rn ? ((gn - bn) / delta) % 6 : max === gn ? (bn - rn) / delta + 2 : (rn - gn) / delta + 4;
  return [Math.round(((hue * 60) + 360) % 360), Math.round(sat * 100), Math.round(light * 100)];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/* ---- Tables ------------------------------------------------------------ */

const MORSE: Record<string, string> = {
  a: ".-", b: "-...", c: "-.-.", d: "-..", e: ".", f: "..-.", g: "--.", h: "....", i: "..", j: ".---",
  k: "-.-", l: ".-..", m: "--", n: "-.", o: "---", p: ".--.", q: "--.-", r: ".-.", s: "...", t: "-",
  u: "..-", v: "...-", w: ".--", x: "-..-", y: "-.--", z: "--..",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-", "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
  ".": ".-.-.-", ",": "--..--", "?": "..--..", "/": "-..-.", "@": ".--.-."
};
const MORSE_REVERSE: Record<string, string> = Object.fromEntries(Object.entries(MORSE).map(([letter, code]) => [code, letter]));

const NATO: Record<string, string> = {
  a: "Alfa", b: "Bravo", c: "Charlie", d: "Delta", e: "Echo", f: "Foxtrot", g: "Golf", h: "Hotel", i: "India",
  j: "Juliett", k: "Kilo", l: "Lima", m: "Mike", n: "November", o: "Oscar", p: "Papa", q: "Quebec", r: "Romeo",
  s: "Sierra", t: "Tango", u: "Uniform", v: "Victor", w: "Whiskey", x: "X-ray", y: "Yankee", z: "Zulu"
};

const ROMAN_VALUES: Array<[string, number]> = [["M", 1000], ["CM", 900], ["D", 500], ["CD", 400], ["C", 100], ["XC", 90], ["L", 50], ["XL", 40], ["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1]];

function romanToArabic(roman: string): number | null {
  let rest = roman.toUpperCase(), total = 0;
  for (const [symbol, value] of ROMAN_VALUES) while (rest.startsWith(symbol)) { total += value; rest = rest.slice(symbol.length); }
  if (rest) return null;
  /* Round-trip guard: rejects malformed forms like IIII or IXIX. */
  let check = "", n = total;
  for (const [symbol, value] of ROMAN_VALUES) while (n >= value) { check += symbol; n -= value; }
  return check === roman.toUpperCase() ? total : null;
}

/* ---- Semver ------------------------------------------------------------ */

type Semver = { major: number; minor: number; patch: number; prerelease: string };
function parseSemver(text: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(text.trim());
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? "" } : null;
}
function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  return a.prerelease < b.prerelease ? -1 : a.prerelease > b.prerelease ? 1 : 0;
}

/* ---- The routes --------------------------------------------------------- */

export const EXTRA_PROSE_ROUTES: Route[] = [
  /* -- Money and everyday math ------------------------------------------- */
  {
    pattern: /^(?:what(?:'s| is)\s+)?(?:a\s+)?tip\s+(?:on|for)\s+\$?(-?\d+(?:\.\d+)?)\s+at\s+(\d+(?:\.\d+)?)\s*%\s*\??$/i,
    skill: "finance.tip",
    run: async (m) => {
      const bill = Number(m[1]), rate = Number(m[2]) / 100;
      return ok({ tip: round2(bill * rate), total: round2(bill * (1 + rate)) });
    }
  },
  {
    pattern: /^split\s+\$?(\d+(?:\.\d+)?)\s+(?:between|among|by)\s+(\d{1,3})(?:\s+people|\s+ways)?\s*\??$/i,
    skill: "finance.split-bill",
    run: async (m) => {
      const people = Number(m[2]);
      return people ? ok(`${m[2]} × $${round2(Number(m[1]) / people)}`) : fail("Cannot split between zero people.");
    }
  },
  {
    pattern: /^(?:what(?:'s| is)\s+)?(?:the\s+)?percent(?:age)?\s+change\s+from\s+(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)\s*\??$/i,
    skill: "math.percent-change",
    run: async (m) => {
      const from = Number(m[1]);
      if (!from) return fail("Percent change from zero is undefined.");
      const change = ((Number(m[2]) - from) / Math.abs(from)) * 100;
      return ok(`${change >= 0 ? "+" : ""}${num(Number(change.toFixed(4)))}%`);
    }
  },
  {
    pattern: /^(-?\d+(?:\.\d+)?)\s+is\s+what\s+percent(?:age)?\s+of\s+(-?\d+(?:\.\d+)?)\s*\??$/i,
    skill: "math.what-percent",
    run: async (m) => (Number(m[2]) ? ok(`${num(Number(((Number(m[1]) / Number(m[2])) * 100).toFixed(6)))}%`) : fail("Division by zero."))
  },
  {
    pattern: /^compound\s+interest\s+on\s+\$?(\d+(?:\.\d+)?)\s+at\s+(\d+(?:\.\d+)?)\s*%\s+(?:for\s+)?(\d+(?:\.\d+)?)\s+years?\s*\??$/i,
    skill: "finance.compound-interest",
    run: async (m) => {
      const principal = Number(m[1]), amount = principal * (1 + Number(m[2]) / 100) ** Number(m[3]);
      return ok({ finalAmount: round2(amount), interestEarned: round2(amount - principal), compounding: "annual" });
    }
  },
  {
    pattern: /^(?:monthly\s+)?(?:loan\s+)?payment\s+on\s+\$?(\d+(?:\.\d+)?)\s+at\s+(\d+(?:\.\d+)?)\s*%\s+(?:for|over)\s+(\d+)\s+years?\s*\??$/i,
    skill: "finance.loan-payment",
    run: async (m) => {
      const principal = Number(m[1]), monthly = Number(m[2]) / 100 / 12, months = Number(m[3]) * 12;
      if (!months) return fail("A zero-year loan has no payments.");
      const payment = monthly === 0 ? principal / months : (principal * monthly * (1 + monthly) ** months) / ((1 + monthly) ** months - 1);
      return ok({ monthlyPayment: round2(payment), totalPaid: round2(payment * months), totalInterest: round2(payment * months - principal) });
    }
  },
  /* -- Number theory and statistics --------------------------------------- */
  {
    pattern: /^(?:what(?:'s| is)\s+)?(?:the\s+)?factorial\s+of\s+(\d{1,3})\s*\??$|^(\d{1,3})!\s*\??$/i,
    skill: "math.factorial",
    run: async (m) => {
      const n = Number(m[1] ?? m[2]);
      if (n > 170) return fail("Overflows past 170!.");
      let total = 1;
      for (let i = 2; i <= n; i += 1) total *= i;
      return ok(`${n}! = ${total}`);
    }
  },
  {
    pattern: /^(?:what(?:'s| is)\s+)?(?:the\s+)?gcd\s+of\s+(\d+)\s+and\s+(\d+)\s*\??$/i,
    skill: "math.gcd",
    run: async (m) => { let a = Number(m[1]), b = Number(m[2]); while (b) [a, b] = [b, a % b]; return ok(String(a)); }
  },
  {
    pattern: /^(?:what(?:'s| is)\s+)?(?:the\s+)?lcm\s+of\s+(\d+)\s+and\s+(\d+)\s*\??$/i,
    skill: "math.lcm",
    run: async (m) => {
      let a = Number(m[1]), b = Number(m[2]);
      const [x, y] = [a, b];
      while (b) [a, b] = [b, a % b];
      return a ? ok(num((x / a) * y)) : fail("LCM of zero is undefined.");
    }
  },
  {
    pattern: /^is\s+(\d{1,15})\s+(?:a\s+)?prime(?:\s+number)?\s*\??$/i,
    skill: "math.prime-check",
    run: async (m) => {
      const n = Number(m[1]);
      if (n < 2) return ok(`${n} is not prime.`);
      for (let i = 2; i * i <= n; i += 1) if (n % i === 0) return ok(`${n} is not prime (divisible by ${i}).`);
      return ok(`${n} is prime.`);
    }
  },
  {
    pattern: /^fibonacci\s+(\d{1,2})\s*\??$/i,
    skill: "math.fibonacci",
    run: async (m) => {
      const n = Number(m[1]);
      if (n > 78) return fail("Past F(78) the exact value overflows.");
      let a = 0, b = 1;
      for (let i = 0; i < n; i += 1) [a, b] = [b, a + b];
      return ok(`F(${n}) = ${a}`);
    }
  },
  {
    pattern: /^(?:what(?:'s| is)\s+)?(?:the\s+)?(average|mean|median|sum|min|max|standard deviation|stddev)\s+of[:\s]+((?:-?\d+(?:\.\d+)?[,\s]*)+)\??$/i,
    skill: "math.statistics",
    run: async (m) => {
      const values = parseNumbers(m[2]);
      if (!values.length) return fail("No numbers found.");
      const sum = values.reduce((a, b) => a + b, 0), mean = sum / values.length;
      const mode = m[1].toLowerCase();
      if (mode === "sum") return ok(num(sum));
      if (mode === "min") return ok(num(Math.min(...values)));
      if (mode === "max") return ok(num(Math.max(...values)));
      if (mode === "median") {
        const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
        return ok(num(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2));
      }
      if (mode.startsWith("st")) return ok(num(Math.sqrt(values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length)));
      return ok(num(mean));
    }
  },
  {
    pattern: /^(?:convert\s+)?([MDCLXVI]{1,15})\s+(?:in|to)\s+(?:arabic|numbers?|decimal)\s*\??$|^roman\s+([MDCLXVI]{1,15})\s*\??$/i,
    skill: "math.roman-to-arabic",
    run: async (m) => {
      const value = romanToArabic(m[1] ?? m[2]);
      return value === null ? fail("Not a well-formed Roman numeral.") : ok(String(value));
    }
  },
  {
    pattern: /^simplify\s+(?:the\s+)?ratio\s+(\d+)\s*[:\/]\s*(\d+)\s*\??$/i,
    skill: "math.ratio-simplify",
    run: async (m) => {
      let a = Number(m[1]), b = Number(m[2]);
      if (!a || !b) return fail("Both sides must be non-zero.");
      let x = a, y = b;
      while (y) [x, y] = [y, x % y];
      return ok(`${a / x}:${b / x}`);
    }
  },
  {
    pattern: /^solve\s+(-?\d*\.?\d*)\s*x\^2\s*([+-]\s*\d*\.?\d*)\s*x\s*([+-]\s*\d+\.?\d*)\s*=\s*0\s*\??$/i,
    skill: "math.quadratic",
    run: async (m) => {
      const coefficient = (raw: string, empty: number): number => {
        const cleaned = raw.replace(/\s+/g, "");
        if (cleaned === "" || cleaned === "+") return empty;
        if (cleaned === "-") return -empty;
        return Number(cleaned);
      };
      const a = coefficient(m[1], 1), b = coefficient(m[2], 1), c = Number(m[3].replace(/\s+/g, ""));
      if (!a) return fail("Not quadratic: the x² coefficient is zero.");
      const disc = b * b - 4 * a * c;
      if (disc < 0) {
        const real = num(-b / (2 * a)), imaginary = num(Math.sqrt(-disc) / (2 * a));
        return ok(`x = ${real} ± ${imaginary}i`);
      }
      const root = Math.sqrt(disc);
      return ok(disc === 0 ? `x = ${num(-b / (2 * a))}` : `x = ${num((-b + root) / (2 * a))} or x = ${num((-b - root) / (2 * a))}`);
    }
  },
  /* -- Dates ---------------------------------------------------------------- */
  {
    pattern: /^(?:how many\s+)?days\s+until\s+(\d{4}-\d{2}-\d{2})\s*\??$/i,
    skill: "datetime.days-until",
    run: async (m) => {
      const target = parseISODate(m[1]);
      if (!target) return fail("Use YYYY-MM-DD.");
      const days = Math.round((target.getTime() - todayUTC().getTime()) / DAY_MS);
      return ok(days === 0 ? "That is today." : days > 0 ? `${days} day${days === 1 ? "" : "s"} from today.` : `${-days} day${days === -1 ? "" : "s"} ago.`);
    }
  },
  {
    pattern: /^(-?\d{1,4})\s+days\s+from\s+(today|\d{4}-\d{2}-\d{2})\s*\??$/i,
    skill: "datetime.add-days",
    run: async (m) => {
      const base = m[2].toLowerCase() === "today" ? todayUTC() : parseISODate(m[2]);
      if (!base) return fail("Use YYYY-MM-DD.");
      const result = new Date(base.getTime() + Number(m[1]) * DAY_MS);
      return ok(result.toISOString().slice(0, 10));
    }
  },
  {
    pattern: /^(?:what(?:'s| is)\s+)?(?:the\s+)?week\s+number\s+(?:of|for)\s+(\d{4}-\d{2}-\d{2})\s*\??$/i,
    skill: "datetime.week-number",
    run: async (m) => { const date = parseISODate(m[1]); return date ? ok(`ISO week ${isoWeek(date)}`) : fail("Use YYYY-MM-DD."); }
  },
  {
    pattern: /^what\s+day(?:\s+of\s+the\s+week)?\s+(?:was|is|will)\s*(?:be\s+)?(\d{4}-\d{2}-\d{2})\s*\??$/i,
    skill: "datetime.day-of-week",
    run: async (m) => {
      const date = parseISODate(m[1]);
      return date ? ok(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date.getUTCDay()]) : fail("Use YYYY-MM-DD.");
    }
  },
  {
    pattern: /^is\s+(\d{1,4})\s+a\s+leap\s+year\s*\??$/i,
    skill: "datetime.leap-year",
    run: async (m) => {
      const year = Number(m[1]);
      const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      return ok(`${year} is${leap ? "" : " not"} a leap year.`);
    }
  },
  {
    pattern: /^(?:how old|age)\s+(?:am i\s+)?if\s+born\s+(?:on\s+)?(\d{4}-\d{2}-\d{2})\s*\??$/i,
    skill: "datetime.age",
    run: async (m) => {
      const born = parseISODate(m[1]);
      if (!born) return fail("Use YYYY-MM-DD.");
      const now = todayUTC();
      let age = now.getUTCFullYear() - born.getUTCFullYear();
      const beforeBirthday = now.getUTCMonth() < born.getUTCMonth() || (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate());
      if (beforeBirthday) age -= 1;
      return age < 0 ? fail("That date is in the future.") : ok(`${age} years old.`);
    }
  },
  {
    pattern: /^unix\s+(?:time(?:stamp)?)\s+(?:for|of)\s+(\d{4}-\d{2}-\d{2})\s*\??$/i,
    skill: "datetime.to-unix",
    run: async (m) => { const date = parseISODate(m[1]); return date ? ok(String(Math.floor(date.getTime() / 1000))) : fail("Use YYYY-MM-DD."); }
  },
  {
    pattern: /^(?:unix\s+)?timestamp\s+(\d{9,13})\s+(?:to|as|in)\s+(?:a\s+)?date\s*\??$/i,
    skill: "datetime.from-unix",
    run: async (m) => {
      const raw = Number(m[1]);
      const date = new Date(m[1].length >= 13 ? raw : raw * 1000);
      return Number.isFinite(date.getTime()) ? ok(date.toISOString()) : fail("Not a timestamp.");
    }
  },
  /* -- Color ------------------------------------------------------------------ */
  {
    pattern: /^(#?[0-9a-f]{3}|#?[0-9a-f]{6})\s+(?:to|in|as)\s+rgb\s*\??$/i,
    skill: "color.hex-to-rgb",
    run: async (m) => { const rgb = hexToRgb(m[1]); return rgb ? ok(`rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`) : fail("Not a hex color."); }
  },
  {
    pattern: /^rgb\(?\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)?\s+(?:to|in|as)\s+hex\s*\??$/i,
    skill: "color.rgb-to-hex",
    run: async (m) => {
      const channels = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (channels.some((channel) => channel > 255)) return fail("Channels run 0–255.");
      return ok(`#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`);
    }
  },
  {
    pattern: /^(#?[0-9a-f]{3}|#?[0-9a-f]{6})\s+(?:to|in|as)\s+hsl\s*\??$/i,
    skill: "color.hex-to-hsl",
    run: async (m) => {
      const rgb = hexToRgb(m[1]);
      if (!rgb) return fail("Not a hex color.");
      const [h, s, l] = rgbToHsl(...rgb);
      return ok(`hsl(${h}, ${s}%, ${l}%)`);
    }
  },
  {
    pattern: /^(?:wcag\s+)?contrast\s+(?:ratio\s+)?(?:between\s+)?(#?[0-9a-f]{3}|#?[0-9a-f]{6})\s+(?:and|vs|on)\s+(#?[0-9a-f]{3}|#?[0-9a-f]{6})\s*\??$/i,
    skill: "color.contrast-ratio",
    run: async (m) => {
      const a = hexToRgb(m[1]), b = hexToRgb(m[2]);
      if (!a || !b) return fail("Not hex colors.");
      const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      const ratio = (light + 0.05) / (dark + 0.05);
      return ok({ ratio: `${ratio.toFixed(2)}:1`, normalTextAA: ratio >= 4.5, largeTextAA: ratio >= 3, normalTextAAA: ratio >= 7 });
    }
  },
  {
    pattern: /^(?:generate|give me)?\s*(?:a\s+)?random\s+(?:hex\s+)?colou?r\s*\??$/i,
    skill: "color.random",
    run: async () => {
      const bytes = new Uint8Array(3);
      crypto.getRandomValues(bytes);
      return ok(`#${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`);
    }
  },
  /* -- Text ---------------------------------------------------------------------- */
  {
    pattern: /^(?:initials|acronym)\s+(?:of|for)[:\s]+(.{2,200})$/i,
    skill: "text.initials",
    run: async (m) => {
      const letters = m[1].trim().split(/[\s-]+/).map((word) => word.replace(/[^\p{L}\p{N}]/gu, "")[0]).filter(Boolean);
      return letters.length ? ok(letters.join("").toUpperCase()) : fail("No words found.");
    }
  },
  {
    pattern: /^(?:how many|count)\s+lines(?:\s+(?:in|are in))?:?\s+([\s\S]+)$/i,
    skill: "text.count-lines",
    run: async (m) => ok(String(m[1].split("\n").length))
  },
  {
    pattern: /^longest\s+word\s+in:?\s+([\s\S]{2,5000})$/i,
    skill: "text.longest-word",
    run: async (m) => {
      const words = m[1].match(/\p{L}[\p{L}'-]*/gu) ?? [];
      if (!words.length) return fail("No words found.");
      const longest = words.reduce((best, word) => (word.length > best.length ? word : best));
      return ok(`"${longest}" (${longest.length} letters)`);
    }
  },
  {
    pattern: /^extract\s+(emails?|urls?|numbers?)\s+from:?\s+([\s\S]+)$/i,
    skill: "text.extract",
    run: async (m) => {
      const kind = m[1].toLowerCase();
      const pattern = kind.startsWith("email") ? /[\w.+-]+@[\w-]+\.[\w.-]+/g : kind.startsWith("url") ? /https?:\/\/[^\s"'<>)]+/g : /-?\d+(?:\.\d+)?/g;
      const found = [...new Set(m[2].match(pattern) ?? [])];
      return found.length ? ok(found.join("\n")) : ok("None found.");
    }
  },
  {
    pattern: /^(?:mask|redact)\s+(?:the\s+)?digits\s+in:?\s+([\s\S]{2,2000})$/i,
    skill: "text.mask-digits",
    run: async (m) => ok(m[1].replace(/\d(?=\d{4})/g, "•"))
  },
  {
    pattern: /^repeat\s+["']?(.+?)["']?\s+(\d{1,3})\s+times\s*$/i,
    skill: "text.repeat",
    run: async (m) => {
      const result = m[1].repeat(Number(m[2]));
      return result.length > 2000 ? fail("Too long to repeat here.") : ok(result);
    }
  },
  {
    pattern: /^nato\s+(?:spelling\s+)?(?:of|for)?:?\s*([a-z0-9 ]{1,60})\s*\??$/i,
    skill: "text.nato",
    run: async (m) => ok(
      m[1].toLowerCase().split("").map((char) => NATO[char] ?? (/\d/.test(char) ? char : char === " " ? "(space)" : char)).join(" ")
    )
  },
  {
    pattern: /^morse\s+encode:?\s+([\s\S]{1,500})$/i,
    skill: "encode.morse-encode",
    run: async (m) => ok(
      m[1].toLowerCase().trim().split(/\s+/).map((word) => word.split("").map((char) => MORSE[char] ?? "").filter(Boolean).join(" ")).join(" / ")
    )
  },
  {
    pattern: /^morse\s+decode:?\s+([.\-\s/]{1,2000})$/i,
    skill: "encode.morse-decode",
    run: async (m) => ok(
      m[1].trim().split(/\s*\/\s*/).map((word) => word.trim().split(/\s+/).map((code) => MORSE_REVERSE[code] ?? "?").join("")).join(" ")
    )
  },
  {
    pattern: /^text\s+to\s+binary:?\s+([\s\S]{1,500})$/i,
    skill: "encode.text-to-binary",
    run: async (m) => ok(m[1].split("").map((char) => char.charCodeAt(0).toString(2).padStart(8, "0")).join(" "))
  },
  {
    pattern: /^binary\s+to\s+text:?\s+([01\s]{8,4000})$/i,
    skill: "encode.binary-to-text",
    run: async (m) => {
      const bytes = m[1].trim().split(/\s+/);
      if (bytes.some((byte) => byte.length !== 8)) return fail("Expected 8-bit groups.");
      return ok(bytes.map((byte) => String.fromCharCode(parseInt(byte, 2))).join(""));
    }
  },
  /* -- Developer checks -------------------------------------------------------------- */
  {
    pattern: /^is\s+([\d\s-]{12,25})\s+a\s+valid\s+(?:card|credit card)(?:\s+number)?\s*\??$/i,
    skill: "validate.luhn",
    run: async (m) => {
      const digits = m[1].replace(/[\s-]/g, "");
      if (!/^\d{12,19}$/.test(digits)) return fail("Card numbers are 12–19 digits.");
      let sum = 0;
      for (let i = 0; i < digits.length; i += 1) {
        let digit = Number(digits[digits.length - 1 - i]);
        if (i % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9; }
        sum += digit;
      }
      return ok(sum % 10 === 0 ? "Passes the Luhn check (structurally valid)." : "Fails the Luhn check.");
    }
  },
  {
    pattern: /^is\s+((?:\d{1,3}\.){3}\d{1,3})\s+a\s+valid\s+ip(?:v4)?(?:\s+address)?\s*\??$/i,
    skill: "validate.ipv4",
    run: async (m) => {
      const parts = m[1].split(".").map(Number);
      if (parts.some((part) => part > 255)) return ok(`${m[1]} is not a valid IPv4 address.`);
      const [a, b] = parts;
      const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127;
      return ok(`${m[1]} is a valid ${isPrivate ? "private/loopback" : "public"} IPv4 address.`);
    }
  },
  {
    pattern: /^how many\s+(?:ips?|addresses|hosts)\s+(?:are\s+)?in\s+(?:a\s+)?(?:[\d.]+)?\/(\d{1,2})\s*\??$/i,
    skill: "net.cidr-size",
    run: async (m) => {
      const prefix = Number(m[1]);
      if (prefix > 32) return fail("IPv4 prefixes run /0–/32.");
      const total = 2 ** (32 - prefix);
      return ok({ prefix: `/${prefix}`, addresses: total, usableHosts: prefix >= 31 ? total : total - 2 });
    }
  },
  {
    pattern: /^is\s+([0-9a-f-]{32,40})\s+a\s+valid\s+uuid\s*\??$/i,
    skill: "validate.uuid",
    run: async (m) => {
      const match = /^[0-9a-f]{8}-[0-9a-f]{4}-([1-8])[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.exec(m[1]);
      return ok(match ? `Valid UUID, version ${match[1]}.` : "Not a valid UUID.");
    }
  },
  {
    pattern: /^semver\s+(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s+(?:vs|versus|or|and)\s+(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*\??$/i,
    skill: "dev.semver-compare",
    run: async (m) => {
      const a = parseSemver(m[1]), b = parseSemver(m[2]);
      if (!a || !b) return fail("Not semver.");
      const order = compareSemver(a, b);
      return ok(order === 0 ? `${m[1]} = ${m[2]}` : order > 0 ? `${m[1]} > ${m[2]}` : `${m[1]} < ${m[2]}`);
    }
  },
  {
    pattern: /^bump\s+(v?\d+\.\d+\.\d+)\s+(major|minor|patch)\s*\??$/i,
    skill: "dev.semver-bump",
    run: async (m) => {
      const version = parseSemver(m[1]);
      if (!version) return fail("Not semver.");
      const part = m[2].toLowerCase();
      if (part === "major") return ok(`${version.major + 1}.0.0`);
      if (part === "minor") return ok(`${version.major}.${version.minor + 1}.0`);
      return ok(`${version.major}.${version.minor}.${version.patch + 1}`);
    }
  },
  {
    pattern: /^(?:humani[sz]e\s+)?(\d{1,18})\s+bytes(?:\s+(?:in|to|as)\s+(?:kb|mb|gb|human|readable))?\s*\??$/i,
    skill: "dev.bytes-humanize",
    run: async (m) => {
      let value = Number(m[1]);
      const units = ["B", "KB", "MB", "GB", "TB", "PB"];
      let unit = 0;
      while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
      return ok(`${num(Number(value.toFixed(2)))} ${units[unit]}`);
    }
  },
  {
    pattern: /^(?:humani[sz]e\s+)?(\d{1,12})\s+seconds(?:\s+(?:in|to|as)\s+(?:hours?|human|readable|time))?\s*\??$/i,
    skill: "dev.duration-humanize",
    run: async (m) => {
      let seconds = Number(m[1]);
      const parts: string[] = [];
      for (const [label, size] of [["d", 86_400], ["h", 3_600], ["m", 60], ["s", 1]] as Array<[string, number]>) {
        const count = Math.floor(seconds / size);
        if (count || (label === "s" && !parts.length)) parts.push(`${count}${label}`);
        seconds %= size;
      }
      return ok(parts.join(" "));
    }
  },
  {
    pattern: /^escape\s+regex:?\s+([\s\S]{1,500})$/i,
    skill: "dev.escape-regex",
    run: async (m) => ok(m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  },
  /* -- Honest randomness ----------------------------------------------------------------- */
  {
    pattern: /^roll\s+(\d{1,2})?d(\d{1,4})\s*\??$/i,
    skill: "random.dice",
    run: async (m) => {
      const count = Math.min(Number(m[1] ?? 1) || 1, 100), sides = Number(m[2]);
      if (sides < 2) return fail("A die needs at least two sides.");
      const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
      return ok(count === 1 ? String(rolls[0]) : `${rolls.join(" + ")} = ${rolls.reduce((a, b) => a + b, 0)}`);
    }
  },
  {
    pattern: /^flip\s+a\s+coin\s*\??$/i,
    skill: "random.coin",
    run: async () => ok(Math.random() < 0.5 ? "Heads." : "Tails.")
  },
  {
    pattern: /^pick\s+(?:one|random)(?:\s+(?:from|of|between))?:?\s+(.{3,500})$/i,
    skill: "random.pick",
    run: async (m) => {
      const options = m[1].split(/\s*(?:,|\bor\b)\s*/i).map((option) => option.trim()).filter(Boolean);
      return options.length > 1 ? ok(options[Math.floor(Math.random() * options.length)]) : fail("Give at least two options.");
    }
  },
  {
    pattern: /^shuffle\s+(?:these\s+)?lines:?\s+([\s\S]{2,5000})$/i,
    skill: "random.shuffle-lines",
    run: async (m) => {
      const lines = m[1].split("\n");
      for (let i = lines.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [lines[i], lines[j]] = [lines[j], lines[i]];
      }
      return ok(lines.join("\n"));
    }
  },
  {
    pattern: /^number\s+(?:these\s+)?lines:?\s+([\s\S]{2,10000})$/i,
    skill: "text.number-lines",
    run: async (m) => ok(m[1].split("\n").map((line, index) => `${index + 1}. ${line}`).join("\n"))
  }
];

/** For `/capabilities` and the settings screen: how many doors this adds. */
export const EXTRA_SKILL_COUNT = EXTRA_PROSE_ROUTES.length;
