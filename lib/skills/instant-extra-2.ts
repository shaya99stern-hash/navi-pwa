/* PATH: lib/skills/instant-extra-2.ts  — NEW FILE, copy verbatim. */

"use client";

import type { SkillResult } from "./registry";

/**
 * The math-and-time pack: forty more zero-token skills, each with its prose
 * doorway. Same contract as `instant.ts` and `instant-extra.ts`: anchored
 * patterns, exact answers or an honest miss, nothing fetched, nothing
 * estimated. The time-zone skills read the device clock the way the existing
 * "what day is it" route does — deterministic from the clock, never from a
 * model's guess.
 */

type Route = { pattern: RegExp; skill: string; run: (match: RegExpExecArray) => Promise<SkillResult> };

const ok = (output: unknown, mime?: string): SkillResult => ({ ok: true, output, mime } as SkillResult);
const fail = (error: string): SkillResult => ({ ok: false, error } as SkillResult);

const num = (value: number): string =>
  Number.isInteger(value) && Math.abs(value) < 1e15 ? String(value) : String(Number(value.toPrecision(12)));
const round2 = (value: number): string => (Math.round(value * 100) / 100).toFixed(2);

function parseISODate(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? date : null;
}

/** "9:30", "17:15", "3pm", "3:45 pm" → minutes since midnight, or null. */
function parseClock(text: string): number | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === "pm" && hours !== 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
  } else if (hours > 23) return null;
  return hours * 60 + minutes;
}

const clock = (totalMinutes: number): string => {
  const minutes = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  const twelve = hours % 12 || 12;
  return `${twelve}:${String(rest).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
};

/** Common city names → IANA zones, for prose. Unknown cities miss honestly. */
const CITY_ZONES: Record<string, string> = {
  "new york": "America/New_York", nyc: "America/New_York", boston: "America/New_York", miami: "America/New_York", toronto: "America/Toronto",
  chicago: "America/Chicago", dallas: "America/Chicago", houston: "America/Chicago", denver: "America/Denver",
  "los angeles": "America/Los_Angeles", la: "America/Los_Angeles", "san francisco": "America/Los_Angeles", seattle: "America/Los_Angeles", vancouver: "America/Vancouver",
  anchorage: "America/Anchorage", honolulu: "Pacific/Honolulu", "mexico city": "America/Mexico_City", "sao paulo": "America/Sao_Paulo",
  london: "Europe/London", dublin: "Europe/Dublin", paris: "Europe/Paris", berlin: "Europe/Berlin", madrid: "Europe/Madrid", rome: "Europe/Rome",
  amsterdam: "Europe/Amsterdam", zurich: "Europe/Zurich", stockholm: "Europe/Stockholm", athens: "Europe/Athens", moscow: "Europe/Moscow",
  jerusalem: "Asia/Jerusalem", "tel aviv": "Asia/Jerusalem", cairo: "Africa/Cairo", johannesburg: "Africa/Johannesburg", dubai: "Asia/Dubai",
  mumbai: "Asia/Kolkata", delhi: "Asia/Kolkata", bangkok: "Asia/Bangkok", singapore: "Asia/Singapore", "hong kong": "Asia/Hong_Kong",
  shanghai: "Asia/Shanghai", beijing: "Asia/Shanghai", seoul: "Asia/Seoul", tokyo: "Asia/Tokyo", sydney: "Australia/Sydney",
  melbourne: "Australia/Melbourne", auckland: "Pacific/Auckland", utc: "UTC", gmt: "UTC"
};

const zoneFor = (city: string): string | null => CITY_ZONES[city.trim().toLowerCase()] ?? null;

function zoneParts(zone: string, instant: Date): { minutes: number; label: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hours = Number(get("hour")) % 24;
  return { minutes: hours * 60 + Number(get("minute")), label: get("weekday") };
}

/* -- Exact combinatorics: integer at every step, refused past 2^53. ------- */
function choose(n: number, k: number): number | null {
  if (k < 0 || k > n) return 0;
  let result = 1;
  const pick = Math.min(k, n - k);
  for (let i = 1; i <= pick; i += 1) {
    result = (result * (n - pick + i)) / i;
    if (result > 9e15) return null;
  }
  return Math.round(result);
}

function gcd(a: number, b: number): number { while (b) [a, b] = [b, a % b]; return a; }

export const EXTRA_MATH_TIME_ROUTES: Route[] = [
  /* -- Combinatorics and roots -------------------------------------------- */
  {
    pattern: /^(\d{1,4})\s+choose\s+(\d{1,4})\s*\??$|^combinations\s+of\s+(\d{1,4})\s+from\s+(\d{1,4})\s*\??$/i,
    skill: "math.combinations",
    run: async (m) => {
      const n = Number(m[1] ?? m[4]), k = Number(m[2] ?? m[3]);
      const result = choose(n, k);
      return result === null ? fail("Too large to state exactly.") : ok(`C(${n}, ${k}) = ${result}`);
    }
  },
  {
    pattern: /^permutations\s+of\s+(\d{1,4})\s+from\s+(\d{1,4})\s*\??$/i,
    skill: "math.permutations",
    run: async (m) => {
      const k = Number(m[1]), n = Number(m[2]);
      if (k > n) return ok(`P(${n}, ${k}) = 0`);
      let result = 1;
      for (let i = 0; i < k; i += 1) { result *= n - i; if (result > 9e15) return fail("Too large to state exactly."); }
      return ok(`P(${n}, ${k}) = ${result}`);
    }
  },
  {
    pattern: /^(square|cube|(\d{1,2})(?:st|nd|rd|th))\s+root\s+of\s+(-?\d+(?:\.\d+)?)\s*\??$/i,
    skill: "math.nth-root",
    run: async (m) => {
      const degree = m[1].toLowerCase() === "square" ? 2 : m[1].toLowerCase() === "cube" ? 3 : Number(m[2]);
      const value = Number(m[3]);
      if (degree < 2) return fail("Roots start at the square root.");
      if (value < 0 && degree % 2 === 0) return fail("An even root of a negative number is not real.");
      const root = value < 0 ? -((-value) ** (1 / degree)) : value ** (1 / degree);
      const nearest = Math.round(root);
      return ok(Math.abs(nearest ** degree - value) < 1e-6 ? String(nearest) : num(root));
    }
  },
  {
    pattern: /^log\s+base\s+(\d+(?:\.\d+)?)\s+of\s+(\d+(?:\.\d+)?)\s*\??$/i,
    skill: "math.log",
    run: async (m) => {
      const base = Number(m[1]), value = Number(m[2]);
      if (base <= 0 || base === 1 || value <= 0) return fail("Needs a positive base ≠ 1 and a positive argument.");
      const result = Math.log(value) / Math.log(base);
      const nearest = Math.round(result);
      return ok(Math.abs(base ** nearest - value) < 1e-6 ? String(nearest) : num(result));
    }
  },
  {
    pattern: /^is\s+(\d{1,15})\s+a\s+power\s+of\s+(\d{1,6})\s*\??$/i,
    skill: "math.power-check",
    run: async (m) => {
      const value = Number(m[1]), base = Number(m[2]);
      if (base < 2) return fail("Needs a base of at least 2.");
      let current = 1, exponent = 0;
      while (current < value) { current *= base; exponent += 1; }
      return ok(current === value ? `Yes: ${base}^${exponent} = ${value}.` : `No.`);
    }
  },
  {
    pattern: /^digit\s+sum\s+of\s+(\d{1,18})\s*\??$/i,
    skill: "math.digit-sum",
    run: async (m) => ok(String(m[1].split("").reduce((sum, digit) => sum + Number(digit), 0)))
  },
  {
    pattern: /^reverse\s+(?:the\s+)?number\s+(\d{1,18})\s*\??$/i,
    skill: "math.reverse-number",
    run: async (m) => ok(m[1].split("").reverse().join("").replace(/^0+(?=\d)/, ""))
  },
  {
    pattern: /^round\s+(-?\d+(?:\.\d+)?)\s+to\s+(\d{1,2})\s+decimals?(?:\s+places?)?\s*\??$/i,
    skill: "math.round-to",
    run: async (m) => ok(Number(m[1]).toFixed(Number(m[2])))
  },
  /* -- Fractions ----------------------------------------------------------- */
  {
    pattern: /^(-?0?\.\d{1,10})\s+as\s+a\s+fraction\s*\??$/i,
    skill: "math.decimal-to-fraction",
    run: async (m) => {
      const value = Number(m[1]);
      const decimals = m[1].split(".")[1].length;
      const denominator = 10 ** decimals;
      const numerator = Math.round(Math.abs(value) * denominator);
      const divisor = gcd(numerator, denominator);
      return ok(`${value < 0 ? "-" : ""}${numerator / divisor}/${denominator / divisor}`);
    }
  },
  {
    pattern: /^simplify\s+(?:the\s+)?fraction\s+(\d+)\s*\/\s*(\d+)\s*\??$/i,
    skill: "math.simplify-fraction",
    run: async (m) => {
      const numerator = Number(m[1]), denominator = Number(m[2]);
      if (!denominator) return fail("Division by zero.");
      const divisor = gcd(numerator, denominator);
      return ok(`${numerator / divisor}/${denominator / divisor}`);
    }
  },
  {
    pattern: /^(\d+)\s*\/\s*(\d+)\s+as\s+a\s+decimal\s*\??$/i,
    skill: "math.fraction-to-decimal",
    run: async (m) => (Number(m[2]) ? ok(num(Number(m[1]) / Number(m[2]))) : fail("Division by zero."))
  },
  /* -- Number presentation --------------------------------------------------- */
  {
    pattern: /^(?:format\s+)?(-?\d{4,18})\s+with\s+(?:commas|thousands\s+separators?)\s*\??$/i,
    skill: "math.thousands",
    run: async (m) => ok(Number(m[1]).toLocaleString("en-US"))
  },
  {
    pattern: /^(-?\d+(?:\.\d+)?)\s+in\s+scientific\s+notation\s*\??$/i,
    skill: "math.to-scientific",
    run: async (m) => ok(Number(m[1]).toExponential().replace(/e\+?/, " × 10^"))
  },
  {
    pattern: /^(-?\d+(?:\.\d+)?e[+-]?\d+)\s+as\s+a\s+(?:plain\s+)?number\s*\??$/i,
    skill: "math.from-scientific",
    run: async (m) => { const value = Number(m[1]); return Number.isFinite(value) ? ok(value.toLocaleString("en-US", { maximumFractionDigits: 12, useGrouping: false })) : fail("Not a number."); }
  },
  {
    pattern: /^ordinal\s+(?:of|for)\s+(\d{1,9})\s*\??$/i,
    skill: "math.ordinal",
    run: async (m) => {
      const value = Number(m[1]);
      const tens = value % 100, ones = value % 10;
      const suffix = tens >= 11 && tens <= 13 ? "th" : ones === 1 ? "st" : ones === 2 ? "nd" : ones === 3 ? "rd" : "th";
      return ok(`${value}${suffix}`);
    }
  },
  /* -- Geometry ---------------------------------------------------------------- */
  {
    pattern: /^(?:what(?:'s| is)\s+)?(?:the\s+)?area\s+of\s+a\s+circle\s+with\s+radius\s+(\d+(?:\.\d+)?)\s*\??$/i,
    skill: "geometry.circle-area",
    run: async (m) => ok(num(Math.PI * Number(m[1]) ** 2))
  },
  {
    pattern: /^(?:what(?:'s| is)\s+)?(?:the\s+)?circumference\s+of\s+a\s+circle\s+with\s+(radius|diameter)\s+(\d+(?:\.\d+)?)\s*\??$/i,
    skill: "geometry.circumference",
    run: async (m) => ok(num(Math.PI * Number(m[2]) * (m[1].toLowerCase() === "radius" ? 2 : 1)))
  },
  {
    pattern: /^(?:what(?:'s| is)\s+)?(?:the\s+)?volume\s+of\s+a\s+sphere\s+with\s+radius\s+(\d+(?:\.\d+)?)\s*\??$/i,
    skill: "geometry.sphere-volume",
    run: async (m) => ok(num((4 / 3) * Math.PI * Number(m[1]) ** 3))
  },
  {
    pattern: /^(?:what(?:'s| is)\s+)?(?:the\s+)?volume\s+of\s+a\s+cylinder\s+with\s+radius\s+(\d+(?:\.\d+)?)\s+and\s+height\s+(\d+(?:\.\d+)?)\s*\??$/i,
    skill: "geometry.cylinder-volume",
    run: async (m) => ok(num(Math.PI * Number(m[1]) ** 2 * Number(m[2])))
  },
  {
    pattern: /^(?:what(?:'s| is)\s+)?(?:the\s+)?area\s+of\s+a\s+triangle\s+with\s+base\s+(\d+(?:\.\d+)?)\s+and\s+height\s+(\d+(?:\.\d+)?)\s*\??$/i,
    skill: "geometry.triangle-area",
    run: async (m) => ok(num((Number(m[1]) * Number(m[2])) / 2))
  },
  {
    pattern: /^(?:what(?:'s| is)\s+)?(?:the\s+)?hypotenuse\s+of\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)\s*\??$/i,
    skill: "geometry.hypotenuse",
    run: async (m) => ok(num(Math.hypot(Number(m[1]), Number(m[2]))))
  },
  {
    pattern: /^distance\s+between\s+\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s+and\s+\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s*\??$/i,
    skill: "geometry.point-distance",
    run: async (m) => ok(num(Math.hypot(Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2]))))
  },
  {
    pattern: /^slope\s+between\s+\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s+and\s+\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s*\??$/i,
    skill: "geometry.slope",
    run: async (m) => {
      const run_ = Number(m[3]) - Number(m[1]);
      return run_ === 0 ? ok("Undefined (vertical line).") : ok(num((Number(m[4]) - Number(m[2])) / run_));
    }
  },
  /* -- Money ------------------------------------------------------------------------ */
  {
    pattern: /^add\s+(\d+(?:\.\d+)?)\s*%\s+(?:vat|tax)\s+to\s+\$?(\d+(?:\.\d+)?)\s*\??$/i,
    skill: "finance.tax-add",
    run: async (m) => ok({ gross: round2(Number(m[2]) * (1 + Number(m[1]) / 100)), taxAmount: round2(Number(m[2]) * (Number(m[1]) / 100)) })
  },
  {
    pattern: /^remove\s+(\d+(?:\.\d+)?)\s*%\s+(?:vat|tax)\s+from\s+\$?(\d+(?:\.\d+)?)\s*\??$/i,
    skill: "finance.tax-remove",
    run: async (m) => {
      const net = Number(m[2]) / (1 + Number(m[1]) / 100);
      return ok({ net: round2(net), taxAmount: round2(Number(m[2]) - net) });
    }
  },
  {
    pattern: /^price\s+with\s+(\d+(?:\.\d+)?)\s*%\s+markup\s+on\s+(?:cost\s+)?\$?(\d+(?:\.\d+)?)\s*\??$/i,
    skill: "finance.markup",
    run: async (m) => ok(round2(Number(m[2]) * (1 + Number(m[1]) / 100)))
  },
  {
    pattern: /^margin\s+if\s+cost\s+\$?(\d+(?:\.\d+)?)\s+(?:and\s+)?price\s+\$?(\d+(?:\.\d+)?)\s*\??$/i,
    skill: "finance.margin",
    run: async (m) => {
      const price = Number(m[2]);
      return price ? ok(`${num(Number((((price - Number(m[1])) / price) * 100).toFixed(4)))}%`) : fail("Price cannot be zero.");
    }
  },
  {
    pattern: /^break[- ]?even\s+if\s+fixed\s+costs?\s+\$?(\d+(?:\.\d+)?)\s+price\s+\$?(\d+(?:\.\d+)?)\s+(?:and\s+)?(?:unit\s+)?cost\s+\$?(\d+(?:\.\d+)?)\s*\??$/i,
    skill: "finance.break-even",
    run: async (m) => {
      const contribution = Number(m[2]) - Number(m[3]);
      return contribution > 0 ? ok(`${Math.ceil(Number(m[1]) / contribution)} units`) : fail("Price must exceed unit cost.");
    }
  },
  {
    pattern: /^simple\s+interest\s+on\s+\$?(\d+(?:\.\d+)?)\s+at\s+(\d+(?:\.\d+)?)\s*%\s+(?:for\s+)?(\d+(?:\.\d+)?)\s+years?\s*\??$/i,
    skill: "finance.simple-interest",
    run: async (m) => {
      const interest = Number(m[1]) * (Number(m[2]) / 100) * Number(m[3]);
      return ok({ interest: round2(interest), total: round2(Number(m[1]) + interest) });
    }
  },
  {
    pattern: /^save\s+\$?(\d+(?:\.\d+)?)\s+in\s+(\d{1,3})\s+months?\s*\??$/i,
    skill: "finance.savings-goal",
    run: async (m) => (Number(m[2]) ? ok(`$${round2(Number(m[1]) / Number(m[2]))} per month`) : fail("Needs at least one month."))
  },
  /* -- Body and pace ------------------------------------------------------------------- */
  {
    pattern: /^bmi\s+(?:for|at)\s+(\d+(?:\.\d+)?)\s*kg\s+and\s+(\d+(?:\.\d+)?)\s*m\s*\??$/i,
    skill: "health.bmi",
    run: async (m) => {
      const height = Number(m[2]);
      return height ? ok(num(Number((Number(m[1]) / height ** 2).toFixed(1)))) : fail("Height cannot be zero.");
    }
  },
  {
    pattern: /^pace\s+for\s+(?:a\s+)?(\d+(?:\.\d+)?)\s*k(?:m)?\s+in\s+(\d{1,3})(?::(\d{2}))?\s+min(?:ute)?s?\s*\??$/i,
    skill: "health.pace",
    run: async (m) => {
      const km = Number(m[1]);
      if (!km) return fail("Distance cannot be zero.");
      const totalSeconds = (Number(m[2]) * 60 + Number(m[3] ?? 0)) / km;
      return ok(`${Math.floor(totalSeconds / 60)}:${String(Math.round(totalSeconds % 60)).padStart(2, "0")} per km`);
    }
  },
  /* -- Clocks and calendars --------------------------------------------------------------- */
  {
    pattern: /^(?:what(?:'s| is)\s+)?(?:the\s+)?time\s+in\s+([a-z ]{2,20})\s*\??$/i,
    skill: "time.in-zone",
    run: async (m) => {
      const zone = zoneFor(m[1]);
      if (!zone) return fail("Not a city this table knows.");
      return ok(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true, weekday: "short" }).format(new Date()));
    }
  },
  {
    pattern: /^(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+in\s+([a-z ]{2,20})\s+(?:to|in)\s+([a-z ]{2,20})\s*\??$/i,
    skill: "time.zone-convert",
    run: async (m) => {
      const minutes = parseClock(m[1]);
      const fromZone = zoneFor(m[2]), toZone = zoneFor(m[3]);
      if (minutes === null) return fail("Could not read that time.");
      if (!fromZone || !toZone) return fail("Not a city this table knows.");
      const instant = new Date();
      const delta = minutes - zoneParts(fromZone, instant).minutes;
      const converted = new Date(instant.getTime() + delta * 60_000);
      const target = zoneParts(toZone, converted);
      return ok(`${clock(target.minutes)} in ${m[3].trim()}${target.label ? ` (${target.label})` : ""}`);
    }
  },
  {
    pattern: /^utc\s+offset\s+(?:of|for)\s+([a-z ]{2,20})\s*\??$/i,
    skill: "time.utc-offset",
    run: async (m) => {
      const zone = zoneFor(m[1]);
      if (!zone) return fail("Not a city this table knows.");
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(new Date());
      return ok(parts.find((part) => part.type === "timeZoneName")?.value ?? "Unknown");
    }
  },
  {
    pattern: /^hours\s+between\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+and\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*\??$/i,
    skill: "time.hours-between",
    run: async (m) => {
      const start = parseClock(m[1]), end = parseClock(m[2]);
      if (start === null || end === null) return fail("Could not read those times.");
      const minutes = ((end - start) + 1440) % 1440;
      return ok(`${Math.floor(minutes / 60)}h ${minutes % 60}m`);
    }
  },
  {
    pattern: /^(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+plus\s+(\d{1,3})\s+hours?\s*\??$/i,
    skill: "time.add-hours",
    run: async (m) => {
      const start = parseClock(m[1]);
      return start === null ? fail("Could not read that time.") : ok(clock(start + Number(m[2]) * 60));
    }
  },
  {
    pattern: /^(\d{1,5})\s+minutes\s+in\s+hours(?:\s+and\s+minutes)?\s*\??$/i,
    skill: "time.minutes-to-hours",
    run: async (m) => {
      const minutes = Number(m[1]);
      return ok(`${Math.floor(minutes / 60)}h ${minutes % 60}m`);
    }
  },
  {
    pattern: /^business\s+days\s+between\s+(\d{4}-\d{2}-\d{2})\s+and\s+(\d{4}-\d{2}-\d{2})\s*\??$/i,
    skill: "time.business-days",
    run: async (m) => {
      const start = parseISODate(m[1]), end = parseISODate(m[2]);
      if (!start || !end) return fail("Use YYYY-MM-DD.");
      const [from, to] = start <= end ? [start, end] : [end, start];
      let count = 0;
      for (let at = from.getTime() + 86_400_000; at <= to.getTime(); at += 86_400_000) {
        const day = new Date(at).getUTCDay();
        if (day !== 0 && day !== 6) count += 1;
      }
      return ok(`${count} business day${count === 1 ? "" : "s"} (weekdays after ${m[1]}, through ${m[2]})`);
    }
  },
  {
    pattern: /^(?:what|which)\s+quarter\s+is\s+(\d{4}-\d{2}-\d{2})\s*\??$/i,
    skill: "time.quarter",
    run: async (m) => {
      const date = parseISODate(m[1]);
      return date ? ok(`Q${Math.ceil((date.getUTCMonth() + 1) / 3)} ${date.getUTCFullYear()}`) : fail("Use YYYY-MM-DD.");
    }
  },
  {
    pattern: /^(?:how many\s+)?days\s+in\s+([a-z]+)\s+(\d{4})\s*\??$/i,
    skill: "time.days-in-month",
    run: async (m) => {
      const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
      const index = months.indexOf(m[1].toLowerCase());
      return index === -1 ? fail("Not a month name.") : ok(String(new Date(Date.UTC(Number(m[2]), index + 1, 0)).getUTCDate()));
    }
  }
];

export const EXTRA_MATH_TIME_COUNT = EXTRA_MATH_TIME_ROUTES.length;
