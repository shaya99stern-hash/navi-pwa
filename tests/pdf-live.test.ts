import { extractPdfText } from "../lib/ai/document-text";

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/**
 * PDF extraction, run against real PDFs rather than against unpdf's type
 * definitions.
 *
 * The API was previously verified only by reading the package's own exports,
 * which proves the call compiles and nothing about whether text comes out. A
 * dead dependency once shipped in this app for exactly that reason. The fixture
 * is generated here rather than committed as a binary, so what is under test is
 * legible in the diff.
 */
function buildPdf(lines: string[]): Uint8Array {
  const content = lines
    .map((line, index) => `BT /F1 12 Tf 72 ${720 - index * 20} Td (${line.replace(/([()\\])/g, "\\$1")}) Tj ET`)
    .join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let index = 0; index < out.length; index += 1) bytes[index] = out.charCodeAt(index) & 0xff;
  return bytes;
}

async function main() {
  const extracted = await extractPdfText(buildPdf([
    "NaviOS PDF extraction proof",
    "The quick brown fox jumps over the lazy dog.",
    "Invoice total: 1240.50 EUR"
  ]));

  check("a real PDF yields text", extracted !== null, true);
  check("the page count is read", extracted?.pages, 1);
  check("the first line survives", extracted?.text.includes("NaviOS PDF extraction proof"), true);
  check("body text survives", extracted?.text.includes("quick brown fox"), true);
  /* Numbers and punctuation are what people actually attach PDFs to ask about,
     and they are the first thing a broken text layer mangles. */
  check("figures survive intact", extracted?.text.includes("1240.50"), true);
  check("a short document is not marked truncated", extracted?.truncated, false);

  /* Null is the signal to fall back to vision, not an error: for a scan,
     vision is the correct tool rather than a degraded one. */
  const scanned = await extractPdfText(buildPdf(["x"]));
  check("a near-empty text layer falls back to vision", scanned, null);

  const notPdf = await extractPdfText(new TextEncoder().encode("this is not a PDF at all"));
  check("a non-PDF falls back rather than throwing", notPdf, null);
  check("an empty buffer falls back rather than throwing", await extractPdfText(new Uint8Array()), null);

  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}

main().then(() => {}).catch((error) => { console.error(error); process.exit(1); });
