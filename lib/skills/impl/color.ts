/** Colour maths. All local, all exact — no eyeballing a hex value. */
import type { Executor } from "../registry";
import { fail, ok, str } from "./text";

type RGB = { r: number; g: number; b: number };

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", lime: "#00ff00", blue: "#0000ff",
  yellow: "#ffff00", cyan: "#00ffff", magenta: "#ff00ff", silver: "#c0c0c0", gray: "#808080",
  maroon: "#800000", olive: "#808000", green: "#008000", purple: "#800080", teal: "#008080",
  navy: "#000080", orange: "#ffa500", pink: "#ffc0cb", brown: "#a52a2a", gold: "#ffd700"
};

export function parseColor(raw: string): RGB | null {
  const value = raw.trim().toLowerCase();
  const named = NAMED[value];
  const hex = (named ?? value).replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return { r: parseInt(hex[0] + hex[0], 16), g: parseInt(hex[1] + hex[1], 16), b: parseInt(hex[2] + hex[2], 16) };
  }
  if (/^[0-9a-f]{6}$/.test(hex)) {
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(value);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  return null;
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const toHex = ({ r, g, b }: RGB) => `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("")}`;

/** WCAG relative luminance. */
function luminance({ r, g, b }: RGB): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function rgbToHsl({ r, g, b }: RGB) {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rr ? ((gg - bb) / d + (gg < bb ? 6 : 0))
    : max === gg ? (bb - rr) / d + 2
    : (rr - gg) / d + 4;
  return { h: h * 60, s, l };
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

const need = (input: Record<string, unknown>, key = "text") => parseColor(str(input, key));

export const hexToRgb: Executor = async (input) => {
  const c = need(input);
  if (!c) return fail("Give a colour as #rrggbb, #rgb, rgb(r,g,b) or a common name.");
  const { h, s, l } = rgbToHsl(c);
  return ok(`rgb(${c.r}, ${c.g}, ${c.b})\nhsl(${h.toFixed(0)}, ${(s * 100).toFixed(0)}%, ${(l * 100).toFixed(0)}%)\n${toHex(c)}`);
};

export const rgbToHexSkill: Executor = async (input) => {
  const c = need(input);
  if (!c) return fail("Give rgb(r, g, b) or three numbers.");
  return ok(toHex(c));
};

export const colorContrast: Executor = async (input) => {
  const a = parseColor(str(input, "foreground") || str(input));
  const b = parseColor(str(input, "background") || "#ffffff");
  if (!a || !b) return fail("Give foreground= and background= colours.");
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  const ratio = (hi + 0.05) / (lo + 0.05);
  const verdict = [
    `AA normal text (4.5:1): ${ratio >= 4.5 ? "pass" : "fail"}`,
    `AA large text (3:1): ${ratio >= 3 ? "pass" : "fail"}`,
    `AAA normal text (7:1): ${ratio >= 7 ? "pass" : "fail"}`
  ].join("\n");
  return ok(`Contrast ratio ${ratio.toFixed(2)}:1\n\n${verdict}`);
};

export const lightenDarken: Executor = async (input) => {
  const c = need(input);
  if (!c) return fail("Give a colour and amount= as a percentage.");
  const amount = Number(input.amount ?? 10) / 100;
  const { h, s, l } = rgbToHsl(c);
  const next = Math.max(0, Math.min(1, l + amount));
  return ok(toHex(hslToRgb(h, s, next)));
};

export const colorPalette: Executor = async (input) => {
  const c = need(input);
  if (!c) return fail("Give a base colour.");
  const { h, s, l } = rgbToHsl(c);
  const at = (deg: number) => toHex(hslToRgb((h + deg + 360) % 360, s, l));
  return ok([
    `base         ${toHex(c)}`,
    `complement   ${at(180)}`,
    `triad        ${at(120)}  ${at(240)}`,
    `analogous    ${at(-30)}  ${at(30)}`,
    `split        ${at(150)}  ${at(210)}`
  ].join("\n"));
};

export const hslConvert: Executor = async (input) => {
  const c = need(input);
  if (!c) return fail("Give a colour.");
  const { h, s, l } = rgbToHsl(c);
  return ok(`hsl(${h.toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%)`);
};

export const colorName: Executor = async (input) => {
  const c = need(input);
  if (!c) return fail("Give a colour.");
  let best = "";
  let bestDistance = Infinity;
  for (const [name, hex] of Object.entries(NAMED)) {
    const n = parseColor(hex)!;
    const d = (n.r - c.r) ** 2 + (n.g - c.g) ** 2 + (n.b - c.b) ** 2;
    if (d < bestDistance) { bestDistance = d; best = name; }
  }
  return ok(bestDistance === 0 ? best : `nearest: ${best} (${toHex(parseColor(NAMED[best])!)})`);
};

export const gradientCss: Executor = async (input) => {
  const parts = str(input).split(/[\s,]+/).map(parseColor).filter(Boolean) as RGB[];
  if (parts.length < 2) return fail("Give at least two colours.");
  const angle = Number(input.angle ?? 90);
  return ok(`background: linear-gradient(${angle}deg, ${parts.map(toHex).join(", ")});`);
};

export const colorBlindSim: Executor = async (input) => {
  const c = need(input);
  if (!c) return fail("Give a colour.");
  const sim = (m: number[][]) => toHex({
    r: m[0][0] * c.r + m[0][1] * c.g + m[0][2] * c.b,
    g: m[1][0] * c.r + m[1][1] * c.g + m[1][2] * c.b,
    b: m[2][0] * c.r + m[2][1] * c.g + m[2][2] * c.b
  });
  return ok([
    `protanopia   ${sim([[0.567, 0.433, 0], [0.558, 0.442, 0], [0, 0.242, 0.758]])}`,
    `deuteranopia ${sim([[0.625, 0.375, 0], [0.7, 0.3, 0], [0, 0.3, 0.7]])}`,
    `tritanopia   ${sim([[0.95, 0.05, 0], [0, 0.433, 0.567], [0, 0.475, 0.525]])}`
  ].join("\n"));
};

export const randomColor: Executor = async (input) => {
  const count = Math.min(50, Math.max(1, Number(input.count) || 1));
  const out = Array.from({ length: count }, () => {
    const b = crypto.getRandomValues(new Uint8Array(3));
    return toHex({ r: b[0], g: b[1], b: b[2] });
  });
  return ok(out.join("\n"));
};

export const colorMix: Executor = async (input) => {
  const colors = str(input).split(/[\s,]+/).map(parseColor).filter(Boolean) as RGB[];
  if (colors.length < 2) return fail("Give two colours to mix.");
  const weight = Math.max(0, Math.min(1, Number(input.weight ?? 0.5)));
  const [a, b] = colors;
  return ok(toHex({ r: a.r + (b.r - a.r) * weight, g: a.g + (b.g - a.g) * weight, b: a.b + (b.b - a.b) * weight }));
};

export const colorLuminance: Executor = async (input) => {
  const c = need(input);
  if (!c) return fail("Give a colour.");
  const l = luminance(c);
  return ok(`Relative luminance ${l.toFixed(4)} — treat as ${l > 0.5 ? "light" : "dark"}; pair with ${l > 0.5 ? "dark" : "light"} text.`);
};
