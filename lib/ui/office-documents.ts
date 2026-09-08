export const isOfficeDocument = (file: Pick<File, "name">) => /\.(docx|xlsx)$/i.test(file.name);

export async function prepareOfficeDocument(file: File): Promise<File> {
  if (!isOfficeDocument(file)) return file;
  const buffer = await file.arrayBuffer();
  const result = await new Promise<{ text: string; warnings: string[] }>((resolve, reject) => {
    const worker = new Worker(new URL("../workers/office-parser.ts", import.meta.url), { type: "module" });
    const finish = () => { clearTimeout(timer); worker.terminate(); };
    const timer = setTimeout(() => { finish(); reject(new Error(`${file.name}: extraction timed out`)); }, 20_000);
    worker.onerror = () => { finish(); reject(new Error(`${file.name}: the document worker could not run`)); };
    worker.onmessage = event => { finish(); event.data.ok ? resolve(event.data) : reject(new Error(`${file.name}: ${event.data.error}`)); };
    worker.postMessage({ name: file.name, buffer }, [buffer]);
  });
  const truncated = result.text.length > 58_000;
  const header = `Text extracted on device from ${file.name}.\n${result.warnings.join("\n")}\n${truncated ? "Only the first 58,000 characters are included. Ask for a smaller document to review the rest.\n" : ""}\n`;
  return new File([header + result.text.slice(0, 58_000)], `${file.name}.txt`, { type: "text/plain", lastModified: file.lastModified });
}
