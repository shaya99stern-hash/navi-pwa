/// <reference lib="webworker" />
import { extractOffice } from "../../engine/navisoul/lib/documents/office";
self.addEventListener("message", (event: MessageEvent<{ name: string; buffer: ArrayBuffer }>) => {
  try { self.postMessage({ ok: true, ...extractOffice(event.data.buffer, event.data.name) }); }
  catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : "Document extraction failed" }); }
});
