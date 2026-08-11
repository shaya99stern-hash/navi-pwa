/** Unit conversion. One table, one resolver, twelve slash commands. */
import type { Executor } from "../registry";
import { fail, ok, str } from "./text";

type Table = Record<string, number>;

/** Everything is expressed against one base unit per family. */
const FAMILIES: Record<string, { base: string; units: Table; aliases?: Record<string, string> }> = {
  length: {
    base: "m",
    units: { nm: 1e-9, um: 1e-6, mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, nmi: 1852 },
    aliases: { inch: "in", inches: "in", foot: "ft", feet: "ft", yard: "yd", yards: "yd", mile: "mi", miles: "mi", metre: "m", meter: "m", metres: "m", meters: "m", kilometre: "km", kilometer: "km" }
  },
  weight: {
    base: "kg",
    units: { mg: 1e-6, g: 0.001, kg: 1, t: 1000, oz: 0.028349523125, lb: 0.45359237, st: 6.35029318 },
    aliases: { gram: "g", grams: "g", kilogram: "kg", kilograms: "kg", pound: "lb", pounds: "lb", ounce: "oz", ounces: "oz", stone: "st", tonne: "t", ton: "t" }
  },
  volume: {
    base: "l",
    units: { ml: 0.001, cl: 0.01, l: 1, m3: 1000, tsp: 0.00492892159375, tbsp: 0.01478676478125, floz: 0.0295735295625, cup: 0.2365882365, pt: 0.473176473, qt: 0.946352946, gal: 3.785411784 },
    aliases: { litre: "l", liter: "l", litres: "l", liters: "l", gallon: "gal", gallons: "gal", pint: "pt", quart: "qt" }
  },
  area: {
    base: "m2",
    units: { mm2: 1e-6, cm2: 1e-4, m2: 1, ha: 10000, km2: 1e6, in2: 0.00064516, ft2: 0.09290304, yd2: 0.83612736, acre: 4046.8564224, mi2: 2589988.110336 },
    aliases: { hectare: "ha", acres: "acre" }
  },
  speed: {
    base: "mps",
    units: { mps: 1, kph: 0.277777778, mph: 0.44704, kn: 0.514444444, fps: 0.3048 },
    aliases: { "m/s": "mps", "km/h": "kph", kmh: "kph", knot: "kn", knots: "kn", "ft/s": "fps" }
  },
  data: {
    base: "b",
    units: { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, pb: 1e15, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4, bit: 0.125 },
    aliases: { byte: "b", bytes: "b", bits: "bit" }
  },
  pressure: {
    base: "pa",
    units: { pa: 1, kpa: 1000, bar: 100000, mbar: 100, atm: 101325, psi: 6894.757293, torr: 133.3223684, mmhg: 133.3223684 },
    aliases: {}
  },
  energy: {
    base: "j",
    units: { j: 1, kj: 1000, cal: 4.184, kcal: 4184, wh: 3600, kwh: 3.6e6, btu: 1055.05585262, ev: 1.602176634e-19 },
    aliases: { joule: "j", joules: "j", calorie: "cal", calories: "cal" }
  },
  angle: {
    base: "deg",
    units: { deg: 1, rad: 57.2957795131, grad: 0.9, turn: 360, arcmin: 1 / 60, arcsec: 1 / 3600 },
    aliases: { degree: "deg", degrees: "deg", radian: "rad", radians: "rad" }
  },
  time: {
    base: "s",
    units: { ms: 0.001, s: 1, min: 60, h: 3600, d: 86400, wk: 604800, mo: 2629800, yr: 31557600 },
    aliases: { sec: "s", secs: "s", second: "s", seconds: "s", minute: "min", minutes: "min", hour: "h", hours: "h", day: "d", days: "d", week: "wk", weeks: "wk", month: "mo", months: "mo", year: "yr", years: "yr" }
  }
};

/** `12 ft to m`, `12ft m`, or amount=/from=/to= — people type all three. */
function readRequest(input: Record<string, unknown>, family: keyof typeof FAMILIES) {
  const spec = FAMILIES[family];
  const norm = (u: string) => {
    const key = u.trim().toLowerCase().replace(/[.\s]/g, "");
    return spec.aliases?.[key] ?? key;
  };
  let amount = Number(input.amount);
  let from = input.from ? norm(String(input.from)) : "";
  let to = input.to ? norm(String(input.to)) : "";
  const text = str(input);
  if (text) {
    const m = /(-?[\d.]+)\s*([a-z°µ/2-3]+)?\s*(?:to|in|->|→|as)?\s*([a-z°µ/2-3]+)?/i.exec(text);
    if (m) {
      if (!Number.isFinite(amount)) amount = Number(m[1]);
      if (!from && m[2]) from = norm(m[2]);
      if (!to && m[3]) to = norm(m[3]);
    }
  }
  return { amount, from, to, spec };
}

function convert(family: keyof typeof FAMILIES): Executor {
  return async (input) => {
    const { amount, from, to, spec } = readRequest(input, family);
    const names = Object.keys(spec.units).join(", ");
    if (!Number.isFinite(amount)) return fail(`Give an amount. Units: ${names}.`);
    if (!spec.units[from]) return fail(`Unknown source unit "${from || "?"}". Units: ${names}.`);
    if (!spec.units[to]) return fail(`Unknown target unit "${to || "?"}". Units: ${names}.`);
    const result = (amount * spec.units[from]) / spec.units[to];
    const rounded = Math.abs(result) >= 1e-4 && Math.abs(result) < 1e15
      ? Number(result.toPrecision(10)).toString()
      : result.toExponential(6);
    return ok(`${amount} ${from} = ${rounded} ${to}`);
  };
}

export const lengthConvert = convert("length");
export const weightConvert = convert("weight");
export const volumeConvert = convert("volume");
export const areaConvert = convert("area");
export const speedConvert = convert("speed");
export const dataSizeConvert = convert("data");
export const pressureConvert = convert("pressure");
export const energyConvert = convert("energy");
export const angleConvert = convert("angle");
export const timeConvert = convert("time");

/** Temperature is offset, not scale, so it cannot use the table above. */
export const temperatureConvert: Executor = async (input) => {
  const text = str(input);
  const m = /(-?[\d.]+)\s*°?\s*([cfk])\b/i.exec(text);
  const amount = Number(input.amount ?? (m ? m[1] : NaN));
  const from = String(input.from ?? (m ? m[2] : "")).toLowerCase().replace("°", "");
  if (!Number.isFinite(amount) || !"cfk".includes(from)) return fail("Try /temperature-convert 21C — units are C, F or K.");
  const c = from === "c" ? amount : from === "f" ? (amount - 32) * 5 / 9 : amount - 273.15;
  const round = (n: number) => Number(n.toFixed(2));
  return ok(`${round(c)} °C = ${round(c * 9 / 5 + 32)} °F = ${round(c + 273.15)} K`);
};

export const fuelEconomy: Executor = async (input) => {
  const text = str(input);
  const m = /(-?[\d.]+)/.exec(text);
  const amount = Number(input.amount ?? (m ? m[1] : NaN));
  if (!Number.isFinite(amount) || amount <= 0) return fail("Give a figure, e.g. /fuel-economy 35 from=mpguk");
  const from = String(input.from ?? (/l\/?100/i.test(text) ? "l100km" : /mpgus/i.test(text) ? "mpgus" : "mpguk")).toLowerCase();
  const l100 = from === "l100km" ? amount
    : from === "mpgus" ? 235.214583 / amount
    : from === "kmpl" ? 100 / amount
    : 282.480936 / amount;
  const r = (n: number) => Number(n.toFixed(2));
  return ok(`${r(l100)} L/100km = ${r(282.480936 / l100)} mpg (UK) = ${r(235.214583 / l100)} mpg (US) = ${r(100 / l100)} km/L`);
};
