/**
 * Types for `source.mjs`, which is plain JavaScript because most tests using it
 * are too. `allowJs` is off and the include list covers only .ts/.tsx, so a
 * TypeScript test importing it has nothing to go on without this.
 *
 * The name matters: TypeScript resolves `./source.mjs` to `./source.d.mts`
 * specifically. A `.d.ts` beside it is not consulted, and neither is an ambient
 * `declare module "./source.mjs"` — relative specifiers are not matched that way.
 */

/** File contents with block and line comments removed. Use for absence checks. */
export function stripComments(source: string): string;

/** Everything after the import block, so an identifier means its use. */
export function sourceBody(source: string): string;

/** Read a repository file, ready to assert against. */
export function read(relativePath: string): { source: string; body: string; code: string };

/** True when `first` genuinely appears before `second` in the file's body. */
export function orderedInBody(source: string, first: string, second: string): boolean;
