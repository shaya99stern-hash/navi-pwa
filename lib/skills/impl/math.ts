import type { Executor } from "../registry";
import { fail, ok, str } from "./text";

/**
 * Recursive-descent evaluator. Deliberately not `eval` or `new Function`:
 * this runs strings the user typed, and a real parser cannot reach anything
 * outside the grammar below.
 */
const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round, sqrt: Math.sqrt,
  cbrt: Math.cbrt, ln: Math.log, log: Math.log10, log2: Math.log2, exp: Math.exp,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  min: Math.min, max: Math.max, pow: Math.pow, sign: Math.sign, trunc: Math.trunc
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

export function evaluateExpression(source: string, variables: Record<string, number> = {}): number {
  let index = 0;
  const text = source.replace(/\s+/g, "");
  if (!text) throw new Error("empty expression");

  const peek = () => text[index];
  const eat = (char: string) => { if (text[index] === char) { index += 1; return true; } return false; };

  function parseExpression(): number {
    let value = parseTerm();
    for (;;) {
      if (eat("+")) value += parseTerm();
      else if (eat("-")) value -= parseTerm();
      else return value;
    }
  }

  function parseTerm(): number {
    let value = parseFactor();
    for (;;) {
      if (eat("*")) value *= parseFactor();
      else if (eat("/")) {
        const divisor = parseFactor();
        if (divisor === 0) throw new Error("division by zero");
        value /= divisor;
      } else if (eat("%")) {
        const divisor = parseFactor();
        if (divisor === 0) throw new Error("division by zero");
        value %= divisor;
      } else return value;
    }
  }

  function parseFactor(): number {
    const base = parseUnary();
    // Right-associative, so 2^3^2 is 512 rather than 64.
    if (eat("^")) return Math.pow(base, parseFactor());
    return base;
  }

  function parseUnary(): number {
    if (eat("-")) return -parseUnary();
    if (eat("+")) return parseUnary();
    return parsePrimary();
  }

  function parsePrimary(): number {
    if (eat("(")) {
      const value = parseExpression();
      if (!eat(")")) throw new Error("missing closing bracket");
      return value;
    }
    const number = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(index));
    if (number) {
      index += number[0].length;
      return parseFloat(number[0]);
    }
    const name = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(text.slice(index));
    if (!name) throw new Error(`unexpected character "${peek() ?? "end of input"}"`);
    index += name[0].length;
    const identifier = name[0].toLowerCase();
    if (eat("(")) {
      const args: number[] = [];
      if (!eat(")")) {
        do { args.push(parseExpression()); } while (eat(","));
        if (!eat(")")) throw new Error("missing closing bracket");
      }
      const fn = FUNCTIONS[identifier];
      if (!fn) throw new Error(`unknown function "${identifier}"`);
      return fn(...args);
    }
    if (identifier in variables) return variables[identifier];
    if (identifier in CONSTANTS) return CONSTANTS[identifier];
    throw new Error(`unknown name "${identifier}"`);
  }

  const result = parseExpression();
  if (index < text.length) throw new Error(`unexpected "${text.slice(index)}"`);
  if (!Number.isFinite(result)) throw new Error("result is not a finite number");
  return result;
}

export const expressionEvaluate: Executor = async (input) => {
  const source = str(input, "expression") || str(input);
  try {
    const variables: Record<string, number> = {};
    if (input.variables && typeof input.variables === "object") {
      for (const [key, value] of Object.entries(input.variables as Record<string, unknown>)) {
        const n = Number(value);
        if (Number.isFinite(n)) variables[key.toLowerCase()] = n;
      }
    }
    const value = evaluateExpression(source, variables);
    return ok(`${source} = ${value}`);
  } catch (error) {
    return fail(`Could not evaluate: ${(error as Error).message}`);
  }
};

const UNITS: Record<string, Record<string, number>> = {
  length: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, nmi: 1852 },
  mass: { mg: 1e-6, g: 0.001, kg: 1, t: 1000, oz: 0.028349523125, lb: 0.45359237, st: 6.35029318 },
  volume: { ml: 0.001, l: 1, m3: 1000, tsp: 0.00492892, tbsp: 0.0147868, cup: 0.236588, pt: 0.473176, qt: 0.946353, gal: 3.785412 },
  data: { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 },
  speed: { mps: 1, kph: 0.277778, mph: 0.44704, kn: 0.514444 },
  time: { ms: 0.001, s: 1, min: 60, h: 3600, d: 86400, wk: 604800 }
};

export const unitConvert: Executor = async (input) => {
  const value = Number(input.value);
  const from = String(input.from ?? "").toLowerCase().trim();
  const to = String(input.to ?? "").toLowerCase().trim();
  if (!Number.isFinite(value) || !from || !to) return fail("Provide `value`, `from`, and `to`.");

  const temperature = ["c", "f", "k", "celsius", "fahrenheit", "kelvin"];
  if (temperature.includes(from) && temperature.includes(to)) {
    const toC = from.startsWith("c") ? value : from.startsWith("f") ? (value - 32) * 5 / 9 : value - 273.15;
    const out = to.startsWith("c") ? toC : to.startsWith("f") ? toC * 9 / 5 + 32 : toC + 273.15;
    return ok(`${value}°${from[0].toUpperCase()} = ${Math.round(out * 1e6) / 1e6}°${to[0].toUpperCase()}`);
  }

  for (const [dimension, table] of Object.entries(UNITS)) {
    if (from in table && to in table) {
      const out = (value * table[from]) / table[to];
      return ok(`${value} ${from} = ${Math.round(out * 1e9) / 1e9} ${to}  (${dimension})`);
    }
  }
  return fail(`No shared dimension for "${from}" and "${to}". Known units: ${Object.values(UNITS).flatMap((t) => Object.keys(t)).join(", ")}.`);
};

export const percentage: Executor = async (input) => {
  const mode = String(input.mode ?? "of");
  const a = Number(input.a ?? input.value);
  const b = Number(input.b ?? input.total);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return fail("Provide numbers `a` and `b`.");
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  switch (mode) {
    case "change": {
      if (a === 0) return fail("Percent change from zero is undefined.");
      return ok(`${a} → ${b} is a change of ${round(((b - a) / Math.abs(a)) * 100)}%`);
    }
    case "increase": return ok(`${a} increased by ${b}% = ${round(a * (1 + b / 100))}`);
    case "decrease": return ok(`${a} decreased by ${b}% = ${round(a * (1 - b / 100))}`);
    case "reverse": return ok(`${a} is ${b}% of ${round((a / b) * 100)}`);
    case "is-what": {
      if (b === 0) return fail("Cannot divide by zero.");
      return ok(`${a} is ${round((a / b) * 100)}% of ${b}`);
    }
    default: return ok(`${a}% of ${b} = ${round((a / 100) * b)}`);
  }
};

export const baseConvert: Executor = async (input) => {
  const from = Math.min(36, Math.max(2, Number(input.from) || 10));
  const to = Math.min(36, Math.max(2, Number(input.to) || 16));
  const text = (str(input, "value") || str(input)).trim().replace(/^0[bxo]/i, "");
  const value = parseInt(text, from);
  if (Number.isNaN(value)) return fail(`"${text}" is not a valid base-${from} number.`);
  return ok({ input: text, fromBase: from, toBase: to, result: value.toString(to), decimal: value }, "application/json");
};

export const descriptiveStats: Executor = async (input) => {
  const numbers = (str(input).match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  if (!numbers.length) return fail("No numbers found.");
  const sorted = [...numbers].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const quantile = (q: number) => {
    const pos = (n - 1) * q;
    const low = Math.floor(pos);
    return sorted[low] + (sorted[Math.min(low + 1, n - 1)] - sorted[low]) * (pos - low);
  };
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const counts = new Map<number, number>();
  for (const v of sorted) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = Math.max(...counts.values());
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return ok({
    count: n, sum: round(sum), mean: round(mean), median: round(quantile(0.5)),
    mode: top > 1 ? [...counts].filter(([, c]) => c === top).map(([v]) => v) : null,
    min: sorted[0], max: sorted[n - 1], range: round(sorted[n - 1] - sorted[0]),
    populationStdDev: round(Math.sqrt(variance)),
    sampleStdDev: n > 1 ? round(Math.sqrt((variance * n) / (n - 1))) : null,
    q1: round(quantile(0.25)), q3: round(quantile(0.75))
  }, "application/json");
};

export const numberFormat: Executor = async (input) => {
  const value = Number(input.value ?? str(input).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(value)) return fail("Provide a number.");
  const decimals = Number.isFinite(Number(input.decimals)) ? Number(input.decimals) : undefined;
  const currency = input.currency ? String(input.currency).toUpperCase() : undefined;
  try {
    return ok(new Intl.NumberFormat(String(input.locale ?? "en-US"), {
      style: currency ? "currency" : "decimal",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals ?? (currency ? 2 : 20)
    }).format(value));
  } catch {
    return fail("Unknown locale or currency code.");
  }
};

export const randomNumber: Executor = async (input) => {
  const min = Number.isFinite(Number(input.min)) ? Number(input.min) : 1;
  const max = Number.isFinite(Number(input.max)) ? Number(input.max) : 100;
  const count = Math.min(1000, Math.max(1, Number(input.count) || 1));
  if (min > max) return fail("`min` must not exceed `max`.");
  const picks = crypto.getRandomValues(new Uint32Array(count));
  const values = [...picks].map((n) => input.float
    ? min + (n / 2 ** 32) * (max - min)
    : min + (n % (Math.floor(max) - Math.ceil(min) + 1)));
  return ok(values.map((v) => (input.float ? Math.round(v * 1e6) / 1e6 : v)).join(", "));
};

export const primeFactor: Executor = async (input) => {
  const value = Math.floor(Number(input.value ?? str(input)));
  if (!Number.isFinite(value) || value < 2) return fail("Provide a whole number of 2 or more.");
  if (value > 2 ** 48) return fail("That number is too large to factor here.");
  const factors: number[] = [];
  let remaining = value;
  for (let d = 2; d * d <= remaining; d += d === 2 ? 1 : 2) {
    while (remaining % d === 0) { factors.push(d); remaining /= d; }
  }
  if (remaining > 1) factors.push(remaining);
  const counts = new Map<number, number>();
  for (const f of factors) counts.set(f, (counts.get(f) ?? 0) + 1);
  return ok({
    value,
    isPrime: factors.length === 1,
    factors,
    factorisation: [...counts].map(([f, c]) => (c > 1 ? `${f}^${c}` : `${f}`)).join(" × ")
  }, "application/json");
};

export const interestCalculate: Executor = async (input) => {
  const principal = Number(input.principal);
  const rate = Number(input.rate);
  const years = Number(input.years);
  if (![principal, rate, years].every(Number.isFinite)) return fail("Provide `principal`, `rate` (percent), and `years`.");
  const perYear = Math.max(1, Number(input.compoundsPerYear) || 12);
  const simple = principal * (1 + (rate / 100) * years);
  const compound = principal * (1 + rate / 100 / perYear) ** (perYear * years);
  const round = (v: number) => Math.round(v * 100) / 100;
  return ok({
    principal, ratePercent: rate, years, compoundsPerYear: perYear,
    simpleTotal: round(simple), simpleInterest: round(simple - principal),
    compoundTotal: round(compound), compoundInterest: round(compound - principal)
  }, "application/json");
};

export const aspectRatio: Executor = async (input) => {
  const ratio = String(input.ratio ?? "16:9").split(/[:/x]/).map(Number);
  if (ratio.length !== 2 || !ratio.every(Number.isFinite) || ratio[1] === 0) return fail("Provide a ratio like 16:9.");
  const [rw, rh] = ratio;
  const width = Number(input.width);
  const height = Number(input.height);
  if (Number.isFinite(width)) return ok(`${width} × ${Math.round((width * rh) / rw)} at ${rw}:${rh}`);
  if (Number.isFinite(height)) return ok(`${Math.round((height * rw) / rh)} × ${height} at ${rw}:${rh}`);
  return fail("Provide either `width` or `height`.");
};

const ROMAN: Array<[number, string]> = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
];

export const romanNumerals: Executor = async (input) => {
  const text = (str(input, "value") || str(input)).trim().toUpperCase();
  if (/^[MDCLXVI]+$/.test(text)) {
    let total = 0;
    let position = 0;
    for (const [value, numeral] of ROMAN) {
      while (text.startsWith(numeral, position)) { total += value; position += numeral.length; }
    }
    if (position !== text.length) return fail("That is not a well-formed Roman numeral.");
    return ok(`${text} = ${total}`);
  }
  const value = Math.floor(Number(text));
  if (!Number.isFinite(value) || value < 1 || value > 3999) return fail("Provide 1–3999, or a Roman numeral.");
  let remaining = value;
  let out = "";
  for (const [amount, numeral] of ROMAN) {
    while (remaining >= amount) { out += numeral; remaining -= amount; }
  }
  return ok(`${value} = ${out}`);
};
