/** Chance. Uses crypto.getRandomValues, not Math.random. */
import type { Executor } from "../registry";
import { fail, ok, str } from "./text";

const randomInt = (max: number) => {
  /* Rejection sampling: taking a modulus of a raw 32-bit draw skews the low
     values, which is exactly the bias a dice roller must not have. */
  const limit = Math.floor(0xffffffff / max) * max;
  const buffer = new Uint32Array(1);
  let value = 0;
  do { crypto.getRandomValues(buffer); value = buffer[0]; } while (value >= limit);
  return value % max;
};

export const diceRoll: Executor = async (input) => {
  const spec = str(input).trim() || String(input.dice ?? "1d6");
  const m = /^(\d*)d(\d+)\s*([+-]\s*\d+)?$/i.exec(spec.replace(/\s+/g, ""));
  if (!m) return fail("Try /dice-roll 2d6+3");
  const count = Math.min(100, Number(m[1] || 1));
  const sides = Number(m[2]);
  if (sides < 2 || sides > 1000) return fail("Sides must be between 2 and 1000.");
  const modifier = m[3] ? Number(m[3].replace(/\s/g, "")) : 0;
  const rolls = Array.from({ length: count }, () => randomInt(sides) + 1);
  const total = rolls.reduce((a, b) => a + b, 0) + modifier;
  return ok(`${rolls.join(" + ")}${modifier ? ` ${modifier > 0 ? "+" : "-"} ${Math.abs(modifier)}` : ""} = ${total}`);
};

export const coinFlip: Executor = async (input) => {
  const count = Math.min(1000, Math.max(1, Number(input.count) || Number(str(input)) || 1));
  const flips = Array.from({ length: count }, () => (randomInt(2) ? "heads" : "tails"));
  if (count === 1) return ok(flips[0]);
  const heads = flips.filter((f) => f === "heads").length;
  return ok(`${flips.join(", ")}\n\n${heads} heads, ${count - heads} tails`);
};

export const randomPick: Executor = async (input) => {
  const items = str(input).split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
  if (items.length < 2) return fail("Give at least two options, comma- or newline-separated.");
  const count = Math.min(items.length, Math.max(1, Number(input.count) || 1));
  const pool = [...items];
  const picked: string[] = [];
  for (let i = 0; i < count; i += 1) picked.push(...pool.splice(randomInt(pool.length), 1));
  return ok(picked.join("\n"));
};

export const randomString: Executor = async (input) => {
  const length = Math.min(4096, Math.max(1, Number(input.length) || 16));
  const sets: Record<string, string> = {
    alnum: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
    alpha: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    numeric: "0123456789",
    hex: "0123456789abcdef",
    lower: "abcdefghijklmnopqrstuvwxyz"
  };
  const alphabet = sets[String(input.charset ?? "alnum")] ?? sets.alnum;
  const count = Math.min(100, Math.max(1, Number(input.count) || 1));
  const make = () => Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
  return ok(Array.from({ length: count }, make).join("\n"));
};

export const weightedPick: Executor = async (input) => {
  /* `apple:3, pear:1` — weights as integers, so the draw stays exact. */
  const entries = str(input).split(/\r?\n|,/).map((line) => {
    const m = /^(.*?)[:=]\s*([\d.]+)\s*$/.exec(line.trim());
    return m ? { label: m[1].trim(), weight: Number(m[2]) } : null;
  }).filter(Boolean) as { label: string; weight: number }[];
  if (entries.length < 2) return fail("Give options as label:weight, e.g. /weighted-pick apple:3, pear:1");
  const scale = 1000;
  const pool: string[] = [];
  for (const e of entries) for (let i = 0; i < Math.round(e.weight * scale) / scale * scale; i += 1) pool.push(e.label);
  if (!pool.length) return fail("Weights must be greater than zero.");
  return ok(pool[randomInt(pool.length)]);
};

export const shuffleSeed: Executor = async (input) => {
  const items = str(input).split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
  if (items.length < 2) return fail("Give at least two items.");
  const seed = input.seed !== undefined ? String(input.seed) : "";
  /* A seed makes the shuffle reproducible, which is the point when someone
     needs the same draw twice — mulberry32 over a cheap string hash. */
  let state = 0;
  for (const ch of seed) state = (state * 31 + ch.charCodeAt(0)) >>> 0;
  const next = seed
    ? () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    : () => randomInt(1e9) / 1e9;
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return ok(out.join("\n") + (seed ? `\n\n(seed "${seed}" — same seed, same order)` : ""));
};
