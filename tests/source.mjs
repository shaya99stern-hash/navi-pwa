import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reading source in a test, without the four traps this session hit.
 *
 * Assertions that check *where* something appears, or that something is
 * absent, kept passing and failing for the wrong reason:
 *
 *  - `indexOf("convertToModelMessages")` matched the import on line 2 rather
 *    than the call eight hundred lines down, so an ordering check compared an
 *    import against a call.
 *  - `indexOf("MarkdownRenderer")` matched an import for the same reason.
 *  - `indexOf('stage: "stream"')` matched an earlier branch that has nothing
 *    to do with the one under test.
 *  - `/maximumScale/` matched the comment explaining that it is deliberately
 *    absent, reporting it as present.
 *
 * Each was a one-line fix and each would have recurred. These helpers close
 * the pattern: read the body when you mean the body, strip comments when you
 * mean code.
 */

/**
 * File contents with block and line comments removed. Use for absence checks.
 *
 * A block comment is only recognised where one can actually begin: at the
 * start of a line or after whitespace or an opening delimiter. The plain
 * `/\*` this used to look for also matched inside string literals — and one
 * such string has been sitting in the composer since it was written:
 *
 *     accept="image/\*"
 *
 * That is a false opener, and it stays harmless only until the number of real
 * `*​/` terminators after it changes. Adding one comment further down the file
 * re-pairs every delimiter after that point, and eleven kilobytes of JSX
 * silently disappear from what the tests are reading. The assertions that
 * broke were about the research switch — nowhere near either edit — and they
 * broke by passing a check for absence, which is the failure mode with no
 * symptom at all.
 */
export function stripComments(source) {
  return source
    .replace(/(^|[\s(){}[\],;=:?])\/\*[\s\S]*?\*\//g, "$1")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Everything after the import block, so an identifier means its use. */
export function sourceBody(source) {
  const lastImport = source.lastIndexOf("\nimport ");
  if (lastImport === -1) return source;
  const afterLine = source.indexOf("\n", lastImport + 1);
  return afterLine === -1 ? source : source.slice(afterLine);
}

/** Read a repository file, ready to assert against. */
export function read(relativePath) {
  /* Source-shape assertions are about tokens and layout, not the checkout's
     newline convention. Normalising here also keeps mixed-line-ending files
     from making a nearby, unrelated edit change what a test can see. */
  const source = readFileSync(join(process.cwd(), relativePath), "utf8").replace(/\r\n?/g, "\n");
  return { source, body: sourceBody(source), code: stripComments(source) };
}

/** True when `first` genuinely appears before `second` in the file's body. */
export function orderedInBody(source, first, second) {
  const body = sourceBody(source);
  const a = body.indexOf(first);
  const b = body.indexOf(second);
  return a > -1 && b > -1 && a < b;
}
