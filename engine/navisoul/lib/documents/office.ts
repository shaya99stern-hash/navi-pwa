import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

const MAX_TEXT = 2_000_000;
type Node = Record<string, any>;
const list = (value: any): any[] => value === undefined ? [] : Array.isArray(value) ? value : [value];

function xml(bytes: Uint8Array): Node {
  const text = new TextDecoder().decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("Unsupported XML declarations in document");
  return new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false }).parse(text);
}

function textNodes(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textNodes).join("");
  if (!value || typeof value !== "object") return "";
  return Object.entries(value).filter(([key]) => !key.startsWith("@_")).map(([key, child]) => textNodes(child) + (/^(w:p|w:tr)$/.test(key) ? "\n" : "")).join("");
}

/** Shared by the Astro engine and the production NaviOS document worker. */
export function extractOffice(buffer: ArrayBuffer, name: string): { text: string; warnings: string[] } {
  if (buffer.byteLength > 25_000_000) throw new Error("Office documents are limited to 25 MB");
  let expanded = 0;
  const files = unzipSync(new Uint8Array(buffer), { filter: file => {
    if (!/^(word\/document\.xml|xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml))$/.test(file.name)) return false;
    expanded += file.originalSize;
    if (expanded > 40_000_000 || file.originalSize > 20_000_000) throw new Error("Expanded document exceeds the safety limit");
    return true;
  } });
  let text = "";
  const warnings: string[] = [];
  if (/\.docx$/i.test(name)) {
    if (!files["word/document.xml"]) throw new Error("DOCX document.xml is missing");
    text = textNodes(xml(files["word/document.xml"]));
  } else if (/\.xlsx$/i.test(name)) {
    const shared = files["xl/sharedStrings.xml"] ? list(xml(files["xl/sharedStrings.xml"]).sst?.si).map(textNodes) : [];
    const sheets = Object.keys(files).filter(path => path.startsWith("xl/worksheets/")).sort();
    if (!sheets.length) throw new Error("XLSX worksheets are missing");
    for (const path of sheets) {
      text += `\n${path}\n`;
      for (const row of list(xml(files[path]).worksheet?.sheetData?.row)) {
        text += list(row.c).map(cell => `${cell["@_r"] ?? ""}: ${cell["@_t"] === "s" ? shared[Number(cell.v)] ?? "" : cell["@_t"] === "inlineStr" ? textNodes(cell.is) : String(cell.v ?? "")}`).join("\t") + "\n";
        if (text.length > MAX_TEXT) throw new Error("Extracted text exceeds 2 MB");
      }
    }
    warnings.push("Cached cell values only; formulas are not recalculated and date serials remain raw.");
  } else throw new Error("Expected a DOCX or XLSX document");
  if (text.length > MAX_TEXT) throw new Error("Extracted text exceeds 2 MB");
  if (!text.trim()) throw new Error("No readable text or cell values were found");
  return { text, warnings };
}
