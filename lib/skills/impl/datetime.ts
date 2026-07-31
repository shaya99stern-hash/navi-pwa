import type { Executor } from "../registry";
import { fail, ok, str } from "./text";

function parseDate(value: unknown, fallbackToNow = false): Date | null {
  if (value === undefined || value === null || value === "") return fallbackToNow ? new Date() : null;
  if (typeof value === "number") return new Date(value < 1e11 ? value * 1000 : value);
  const text = String(value).trim();
  if (/^\d{9,}$/.test(text)) {
    const n = Number(text);
    return new Date(text.length <= 10 ? n * 1000 : n);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const timestampConvert: Executor = async (input) => {
  const date = parseDate(input.value ?? str(input), true);
  if (!date) return fail("Could not read that as a date or timestamp.");
  return ok({
    iso: date.toISOString(),
    unixSeconds: Math.floor(date.getTime() / 1000),
    unixMilliseconds: date.getTime(),
    utc: date.toUTCString(),
    relative: describeRelative(date)
  }, "application/json");
};

function describeRelative(date: Date): string {
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const units: Array<[string, number]> = [
    ["year", 31_536_000_000], ["month", 2_592_000_000], ["day", 86_400_000],
    ["hour", 3_600_000], ["minute", 60_000], ["second", 1000]
  ];
  for (const [name, ms] of units) {
    if (abs >= ms) {
      const n = Math.round(abs / ms);
      return diff < 0 ? `${n} ${name}${n === 1 ? "" : "s"} ago` : `in ${n} ${name}${n === 1 ? "" : "s"}`;
    }
  }
  return "just now";
}

export const timezoneConvert: Executor = async (input) => {
  const date = parseDate(input.value ?? str(input), true);
  if (!date) return fail("Could not read that as a date.");
  const zones = Array.isArray(input.zones)
    ? (input.zones as string[])
    : String(input.zones ?? "UTC,America/New_York,Europe/London,Asia/Tokyo").split(",").map((z) => z.trim());
  const rows: Record<string, string> = {};
  for (const zone of zones) {
    try {
      rows[zone] = new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium", timeStyle: "long", timeZone: zone
      }).format(date);
    } catch {
      rows[zone] = "unknown time zone";
    }
  }
  return ok(rows, "application/json");
};

export const dateFormat: Executor = async (input) => {
  const date = parseDate(input.value ?? str(input), true);
  if (!date) return fail("Could not read that as a date.");
  const zone = input.timeZone ? String(input.timeZone) : undefined;
  try {
    return ok({
      iso: date.toISOString(),
      short: new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeZone: zone }).format(date),
      medium: new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: zone }).format(date),
      full: new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone: zone }).format(date),
      dayOfWeek: new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: zone }).format(date)
    }, "application/json");
  } catch {
    return fail(`Unknown time zone "${zone}".`);
  }
};

export const dateDifference: Executor = async (input) => {
  const from = parseDate(input.from ?? input.a);
  const to = parseDate(input.to ?? input.b, true);
  if (!from || !to) return fail("Provide two dates as `from` and `to`.");
  const ms = Math.abs(to.getTime() - from.getTime());
  return ok({
    from: from.toISOString(),
    to: to.toISOString(),
    milliseconds: ms,
    seconds: Math.floor(ms / 1000),
    minutes: Math.floor(ms / 60_000),
    hours: Math.floor(ms / 3_600_000),
    days: Math.floor(ms / 86_400_000),
    weeks: Math.floor(ms / 604_800_000),
    humanised: describeRelative(from.getTime() < to.getTime() ? from : to).replace(/^in /, "")
  }, "application/json");
};

export const dateAddSubtract: Executor = async (input) => {
  const date = parseDate(input.value ?? str(input), true);
  if (!date) return fail("Could not read that as a date.");
  const result = new Date(date.getTime());
  const add = (n: unknown, fn: (v: number) => void) => { const v = Number(n); if (Number.isFinite(v)) fn(v); };
  add(input.years, (v) => result.setUTCFullYear(result.getUTCFullYear() + v));
  add(input.months, (v) => result.setUTCMonth(result.getUTCMonth() + v));
  add(input.days, (v) => result.setUTCDate(result.getUTCDate() + v));
  add(input.hours, (v) => result.setUTCHours(result.getUTCHours() + v));
  add(input.minutes, (v) => result.setUTCMinutes(result.getUTCMinutes() + v));
  return ok({ from: date.toISOString(), result: result.toISOString(), relative: describeRelative(result) }, "application/json");
};

export const businessDays: Executor = async (input) => {
  const from = parseDate(input.from ?? input.a, true);
  const to = parseDate(input.to ?? input.b);
  if (!from || !to) return fail("Provide two dates as `from` and `to`.");
  const [start, end] = from <= to ? [from, to] : [to, from];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  let business = 0;
  let weekend = 0;
  while (cursor.getTime() <= last) {
    const day = cursor.getUTCDay();
    if (day === 0 || day === 6) weekend += 1; else business += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return ok({ from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), businessDays: business, weekendDays: weekend, totalDays: business + weekend }, "application/json");
};

export const ageCalculate: Executor = async (input) => {
  const born = parseDate(input.birthday ?? input.value ?? str(input));
  if (!born) return fail("Provide a birth date.");
  const now = parseDate(input.on, true) as Date;
  if (born > now) return fail("That date is in the future.");
  let years = now.getUTCFullYear() - born.getUTCFullYear();
  let months = now.getUTCMonth() - born.getUTCMonth();
  let days = now.getUTCDate() - born.getUTCDate();
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) { years -= 1; months += 12; }
  const totalDays = Math.floor((now.getTime() - born.getTime()) / 86_400_000);
  return ok({ years, months, days, totalDays, note: `${years} years, ${months} months, ${days} days` }, "application/json");
};

export const durationParse: Executor = async (input) => {
  const text = str(input).trim() || String(input.value ?? "");
  if (!text) return fail("Provide a duration such as 1h30m or PT1H30M.");
  let seconds = 0;
  const iso = text.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/i);
  if (iso) {
    seconds = (Number(iso[1] || 0) * 86_400) + (Number(iso[2] || 0) * 3_600)
      + (Number(iso[3] || 0) * 60) + Number(iso[4] || 0);
  } else if (/^\d+(\.\d+)?$/.test(text)) {
    seconds = Number(text);
  } else {
    const matches = [...text.matchAll(/([\d.]+)\s*(w|d|h|m|s)/gi)];
    if (!matches.length) return fail("Could not read that as a duration.");
    const scale: Record<string, number> = { w: 604_800, d: 86_400, h: 3_600, m: 60, s: 1 };
    for (const [, value, unit] of matches) seconds += Number(value) * scale[unit.toLowerCase()];
  }
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = Math.round(seconds % 60);
  return ok({
    seconds,
    milliseconds: seconds * 1000,
    iso8601: `P${d ? `${d}D` : ""}T${h}H${m}M${s}S`,
    human: [d && `${d}d`, h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(" ") || "0s"
  }, "application/json");
};

export const weekNumber: Executor = async (input) => {
  const date = parseDate(input.value ?? str(input), true);
  if (!date) return fail("Could not read that as a date.");
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  const monday = new Date(target.getTime());
  monday.setUTCDate(target.getUTCDate() - 3);
  const sunday = new Date(monday.getTime());
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return ok({
    isoWeek: week,
    isoYear: target.getUTCFullYear(),
    weekStarts: monday.toISOString().slice(0, 10),
    weekEnds: sunday.toISOString().slice(0, 10)
  }, "application/json");
};

export const countdown: Executor = async (input) => {
  const target = parseDate(input.target ?? input.value ?? str(input));
  if (!target) return fail("Provide the target date or time.");
  const ms = target.getTime() - Date.now();
  if (ms <= 0) return ok(`${target.toISOString()} passed ${describeRelative(target)}.`);
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return ok(`${days}d ${hours}h ${minutes}m until ${target.toISOString()}`);
};
