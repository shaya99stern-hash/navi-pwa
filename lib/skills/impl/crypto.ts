import type { Executor } from "../registry";
import { fail, ok, str } from "./text";

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const shaHash: Executor = async (input) => {
  const requested = String(input.algorithm ?? "SHA-256").toUpperCase().replace(/^SHA(\d)/, "SHA-$1");
  const allowed = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"];
  if (!allowed.includes(requested)) return fail(`Choose one of ${allowed.join(", ")}.`);
  const digest = await crypto.subtle.digest(requested, new TextEncoder().encode(str(input)));
  return ok(`${requested}: ${hex(digest)}`);
};

export const hmacSign: Executor = async (input) => {
  const secret = str(input, "secret");
  if (!secret) return fail("A shared secret is required.");
  const algorithm = String(input.algorithm ?? "SHA-256").toUpperCase().replace(/^SHA(\d)/, "SHA-$1");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: algorithm }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(str(input)));
  return ok(`HMAC-${algorithm}: ${hex(signature)}`);
};

export const uuidGenerate: Executor = async (input) => {
  const count = Math.min(100, Math.max(1, Number(input.count) || 1));
  if (input.version === 7 || input.version === "7") {
    // Time-ordered, so generated ids sort by creation.
    const ids = Array.from({ length: count }, () => {
      const now = BigInt(Date.now());
      const random = crypto.getRandomValues(new Uint8Array(10));
      const time = now.toString(16).padStart(12, "0");
      const rest = [...random].map((b) => b.toString(16).padStart(2, "0")).join("");
      const v = `${time}7${rest.slice(0, 3)}${((parseInt(rest.slice(3, 4), 16) & 0x3) | 0x8).toString(16)}${rest.slice(4, 19)}`;
      return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20, 32)}`;
    });
    return ok(ids.join("\n"));
  }
  return ok(Array.from({ length: count }, () => crypto.randomUUID()).join("\n"));
};

const NANO_ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

export const nanoId: Executor = async (input) => {
  const size = Math.min(64, Math.max(4, Number(input.size) || 21));
  const count = Math.min(100, Math.max(1, Number(input.count) || 1));
  const alphabetLen = NANO_ALPHABET.length;
  const mask = (2 << Math.floor(Math.log2(alphabetLen - 1))) - 1;
  const step = Math.ceil((1.6 * mask * size) / alphabetLen);
  const makeId = () => {
    let id = "";
    while (id.length < size) {
      const bytes = crypto.getRandomValues(new Uint8Array(step));
      for (const byte of bytes) {
        const index = byte & mask;
        if (index < alphabetLen) {
          id += NANO_ALPHABET[index];
          if (id.length === size) break;
        }
      }
    }
    return id;
  };
  const ids = Array.from({ length: count }, () => makeId());
  return ok(ids.join("\n"));
};

export const randomBytes: Executor = async (input) => {
  const size = Math.min(1024, Math.max(1, Number(input.size) || 32));
  const data = crypto.getRandomValues(new Uint8Array(size));
  if (input.base64) {
    let binary = "";
    for (const byte of data) binary += String.fromCharCode(byte);
    return ok(btoa(binary));
  }
  return ok([...data].map((b) => b.toString(16).padStart(2, "0")).join(""));
};

const SETS = {
  lower: "abcdefghijkmnopqrstuvwxyz",
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  digits: "23456789",
  symbols: "!@#$%^&*-_=+?"
};

export const passwordGenerate: Executor = async (input) => {
  const length = Math.min(128, Math.max(8, Number(input.length) || 20));
  const count = Math.min(20, Math.max(1, Number(input.count) || 1));
  let alphabet = SETS.lower + SETS.upper;
  if (input.digits !== false) alphabet += SETS.digits;
  if (input.symbols !== false) alphabet += SETS.symbols;
  const randomIndex = (max: number) => {
    const range = 0x100000000;
    const limit = Math.floor(range / max) * max;
    let value: number;
    do {
      value = crypto.getRandomValues(new Uint32Array(1))[0];
    } while (value >= limit);
    return value % max;
  };
  const make = () => {
    let out = "";
    for (let i = 0; i < length; i++) out += alphabet[randomIndex(alphabet.length)];
    return out;
  };
  const entropy = Math.round(length * Math.log2(alphabet.length));
  return ok(`${Array.from({ length: count }, make).join("\n")}\n\n— about ${entropy} bits of entropy each`);
};

const WORDS = ("able acid army atom aunt band bank barn beam bell belt bird blue boat bolt bond bone book "
  + "cake calm camp cave city clay club coal coin cold cork corn crop dark dawn deep desk dish dock door dove "
  + "dust east edge exit face fair farm fern film fire fish flag flat foam fork fort frog fuel gate gift glow "
  + "gold grid hall hand harp hawk heat herb hill hive hold hope horn iron jade jazz kite lake lamp lawn leaf "
  + "lens lime lion loom luck mane mask mast maze mesh mile mint mist moon moss nest note oak oath onyx opal "
  + "oven palm park pearl pine pond pool port quilt raft rain reed reef ridge rock root rope rose sage salt "
  + "sand seed ship silk snow soil star stem stone surf swan tide tile tone tree tusk vine wave wind wing wolf").split(/\s+/);

export const passphraseGenerate: Executor = async (input) => {
  const words = Math.min(12, Math.max(3, Number(input.words) || 5));
  const separator = String(input.separator ?? "-");
  const picks = crypto.getRandomValues(new Uint32Array(words));
  const phrase = [...picks].map((n) => WORDS[n % WORDS.length]).join(separator);
  const entropy = Math.round(words * Math.log2(WORDS.length));
  return ok(`${phrase}\n\n— about ${entropy} bits of entropy from a ${WORDS.length}-word list`);
};

export const passwordStrength: Executor = async (input) => {
  const password = str(input);
  if (!password) return fail("Nothing to score.");
  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/[0-9]/.test(password)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(password)) pool += 33;
  const unique = new Set(password).size;
  const entropy = Math.round(password.length * Math.log2(pool || 1));
  const notes: string[] = [];
  if (password.length < 12) notes.push("shorter than 12 characters");
  if (unique < password.length / 2) notes.push("many repeated characters");
  if (/^[a-zA-Z]+$/.test(password)) notes.push("letters only");
  if (/(.)\1{2,}/.test(password)) notes.push("contains a run of the same character");
  if (/^\d+$/.test(password)) notes.push("digits only");
  const verdict = entropy < 40 ? "weak" : entropy < 60 ? "fair" : entropy < 80 ? "strong" : "very strong";
  return ok({
    length: password.length,
    uniqueCharacters: unique,
    estimatedEntropyBits: entropy,
    verdict,
    weaknesses: notes,
    note: "Entropy is estimated from character classes alone. A common word or a reused password scores far lower in reality."
  }, "application/json");
};

function base32Decode(value: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = value.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let acc = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("not base32");
    acc = (acc << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((acc >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export const totpCode: Executor = async (input) => {
  const secret = str(input, "secret") || str(input);
  if (!secret) return fail("A base32 shared secret is required.");
  let key: Uint8Array;
  try {
    key = base32Decode(secret);
  } catch {
    return fail("The secret must be base32, as shown by the service you are pairing with.");
  }
  const step = Math.max(1, Number(input.period) || 30);
  const counter = Math.floor(Date.now() / 1000 / step);
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigUint64(0, BigInt(counter));
  const imported = await crypto.subtle.importKey(
    "raw", key as unknown as ArrayBuffer, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", imported, buffer));
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  const digits = Math.min(8, Math.max(6, Number(input.digits) || 6));
  const code = String(binary % 10 ** digits).padStart(digits, "0");
  const remaining = step - (Math.floor(Date.now() / 1000) % step);
  return ok(`${code}\n\n— valid for another ${remaining}s`);
};
