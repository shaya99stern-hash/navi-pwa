/** Geography. Spherical-earth maths, accurate to a few metres over land. */
import type { Executor } from "../registry";
import { fail, ok, str } from "./text";

const R = 6371008.8; // IUGG mean earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Accepts "51.5, -0.12", "51.5 -0.12", or 51°30'N 0°07'W. */
function coords(text: string): [number, number][] {
  const dms = [...text.matchAll(/(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*["″]\s*)?([NSEW])/gi)];
  if (dms.length >= 2) {
    const values = dms.map((m) => {
      const v = Number(m[1]) + Number(m[2] ?? 0) / 60 + Number(m[3] ?? 0) / 3600;
      return /[SW]/i.test(m[4]) ? -v : v;
    });
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < values.length; i += 2) out.push([values[i], values[i + 1]]);
    return out;
  }
  const nums = (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

export const haversineDistance: Executor = async (input) => {
  const pts = coords(str(input));
  if (pts.length < 2) return fail("Give two points: /haversine-distance 51.5,-0.12 48.85,2.35");
  const [[lat1, lon1], [lat2, lon2]] = pts;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  const metres = 2 * R * Math.asin(Math.sqrt(a));
  return ok([
    `${(metres / 1000).toFixed(3)} km`,
    `${(metres / 1609.344).toFixed(3)} miles`,
    `${(metres / 1852).toFixed(3)} nautical miles`,
    `Great-circle distance on a sphere; ignores terrain and elevation.`
  ].join("\n"));
};

export const bearingCalculate: Executor = async (input) => {
  const pts = coords(str(input));
  if (pts.length < 2) return fail("Give two points.");
  const [[lat1, lon1], [lat2, lon2]] = pts;
  const dLon = rad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLon);
  const bearing = (deg(Math.atan2(y, x)) + 360) % 360;
  const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return ok(`${bearing.toFixed(1)}° (${points[Math.round(bearing / 22.5) % 16]}) — initial bearing; a great-circle track changes heading as you go.`);
};

export const coordinateConvert: Executor = async (input) => {
  const pts = coords(str(input));
  if (!pts.length) return fail("Give a latitude and longitude.");
  const [lat, lon] = pts[0];
  const toDms = (v: number, axis: "lat" | "lon") => {
    const hemi = axis === "lat" ? (v >= 0 ? "N" : "S") : v >= 0 ? "E" : "W";
    const abs = Math.abs(v);
    const d = Math.floor(abs);
    const m = Math.floor((abs - d) * 60);
    const s = ((abs - d) * 60 - m) * 60;
    return `${d}°${String(m).padStart(2, "0")}'${s.toFixed(2).padStart(5, "0")}"${hemi}`;
  };
  return ok([
    `decimal  ${lat.toFixed(6)}, ${lon.toFixed(6)}`,
    `DMS      ${toDms(lat, "lat")} ${toDms(lon, "lon")}`,
    `geo URI  geo:${lat.toFixed(6)},${lon.toFixed(6)}`
  ].join("\n"));
};

export const boundingBox: Executor = async (input) => {
  const pts = coords(str(input));
  if (!pts.length) return fail("Give a centre point and radius= in km.");
  const [lat, lon] = pts[0];
  const km = Number(input.radius) || 10;
  const dLat = deg(km * 1000 / R);
  const dLon = deg((km * 1000) / (R * Math.cos(rad(lat))));
  const f = (n: number) => n.toFixed(6);
  return ok([
    `south ${f(lat - dLat)}   north ${f(lat + dLat)}`,
    `west  ${f(lon - dLon)}   east  ${f(lon + dLon)}`,
    ``,
    `bbox=${f(lon - dLon)},${f(lat - dLat)},${f(lon + dLon)},${f(lat + dLat)}`,
    `A ${km} km box around ${f(lat)}, ${f(lon)}.`
  ].join("\n"));
};

export const geohashEncode: Executor = async (input) => {
  const pts = coords(str(input));
  if (!pts.length) return fail("Give a latitude and longitude.");
  const [lat, lon] = pts[0];
  const precision = Math.min(12, Math.max(1, Number(input.precision) || 9));
  const base32 = "0123456789bcdefghjkmnpqrstuvwxyz";
  let latRange = [-90, 90];
  let lonRange = [-180, 180];
  let hash = "";
  let bits = 0;
  let bit = 0;
  let even = true;
  while (hash.length < precision) {
    const range = even ? lonRange : latRange;
    const mid = (range[0] + range[1]) / 2;
    const value = even ? lon : lat;
    if (value > mid) { bits = (bits << 1) | 1; range[0] = mid; } else { bits <<= 1; range[1] = mid; }
    if (even) lonRange = range; else latRange = range;
    even = !even;
    if (++bit === 5) { hash += base32[bits]; bits = 0; bit = 0; }
  }
  return ok(`${hash}\n\nPrecision ${precision} ≈ ${[2500, 630, 78, 20, 2.4, 0.61, 0.076, 0.019, 0.0024][Math.min(8, precision - 1)]} km cell.`);
};

export const timezoneOffset: Executor = async (input) => {
  const zone = str(input).trim() || String(input.zone ?? "UTC");
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "longOffset", hour: "2-digit", minute: "2-digit", weekday: "short", day: "2-digit", month: "short" });
    return ok(`${zone}\n${fmt.format(now)}\n\nUTC now: ${now.toISOString().slice(0, 16).replace("T", " ")}`);
  } catch {
    return fail(`Unknown timezone "${zone}". Use an IANA name like Europe/London or America/New_York.`);
  }
};

const COUNTRIES: Record<string, string> = {
  US: "United States", GB: "United Kingdom", CA: "Canada", AU: "Australia", NZ: "New Zealand",
  IE: "Ireland", FR: "France", DE: "Germany", ES: "Spain", IT: "Italy", NL: "Netherlands",
  BE: "Belgium", CH: "Switzerland", AT: "Austria", SE: "Sweden", NO: "Norway", DK: "Denmark",
  FI: "Finland", PL: "Poland", PT: "Portugal", GR: "Greece", IL: "Israel", AE: "United Arab Emirates",
  IN: "India", CN: "China", JP: "Japan", KR: "South Korea", SG: "Singapore", BR: "Brazil",
  MX: "Mexico", AR: "Argentina", ZA: "South Africa", NG: "Nigeria", KE: "Kenya", EG: "Egypt"
};

export const countryCode: Executor = async (input) => {
  const q = str(input).trim();
  if (!q) return ok(Object.entries(COUNTRIES).map(([k, v]) => `${k}  ${v}`).join("\n"));
  const upper = q.toUpperCase();
  if (COUNTRIES[upper]) return ok(`${upper} — ${COUNTRIES[upper]}`);
  const hit = Object.entries(COUNTRIES).filter(([, name]) => name.toLowerCase().includes(q.toLowerCase()));
  return hit.length ? ok(hit.map(([k, v]) => `${k} — ${v}`).join("\n")) : ok(`No match for "${q}" in the built-in list.`);
};

export const utmConvert: Executor = async (input) => {
  const pts = coords(str(input));
  if (!pts.length) return fail("Give a latitude and longitude.");
  const [lat, lon] = pts[0];
  if (Math.abs(lat) > 84) return fail("UTM is undefined above 84°N or below 80°S — use UPS there.");
  const zone = Math.floor((lon + 180) / 6) + 1;
  const band = "CDEFGHJKLMNPQRSTUVWX"[Math.floor((lat + 80) / 8)] ?? "?";
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const lonOrigin = rad((zone - 1) * 6 - 180 + 3);
  const p = rad(lat);
  const l = rad(lon);
  const N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  const T = Math.tan(p) ** 2;
  const C = ep2 * Math.cos(p) ** 2;
  const A = Math.cos(p) * (l - lonOrigin);
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * p
    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * p)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * p)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * p));
  const easting = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  let northing = k0 * (M + N * Math.tan(p) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24 + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720));
  if (lat < 0) northing += 10000000;
  return ok(`${zone}${band} ${Math.round(easting)}E ${Math.round(northing)}N\n\nWGS84 / UTM zone ${zone}${lat >= 0 ? "N" : "S"}.`);
};
