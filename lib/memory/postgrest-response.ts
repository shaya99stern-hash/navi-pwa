/**
 * Read a successful PostgREST response without turning an empty success body
 * into a JSON parse failure.
 *
 * `Prefer: return=minimal` normally answers 204, but proxies and PostgREST
 * configurations can preserve the successful request as 200 with no body.
 * Both forms mean the write completed.
 */
export async function readPostgrestPayload(response: Response): Promise<unknown | null> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text.trim()) return null;
  return JSON.parse(text);
}
