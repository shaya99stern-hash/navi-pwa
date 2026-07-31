/**
 * Wires implementations to catalog ids.
 *
 * These are imported statically rather than lazily. Splitting them out saves a
 * few kilobytes but makes every skill's first use depend on fetching a chunk,
 * which fails exactly when the offline promise matters most. The loader
 * signature stays async so a genuinely heavy skill — a PDF or YAML parser —
 * can still be code-split behind a dynamic import.
 *
 * The catalog in data/skills.json describes 200 skills. Only the ones
 * registered here actually run, and the registry hides the rest from
 * suggestions rather than offering a menu of dead ends.
 */
import { register, type Executor } from "./registry";
import * as text from "./impl/text";
import * as encode from "./impl/encode";
import * as crypto from "./impl/crypto";
import * as datetime from "./impl/datetime";
import * as math from "./impl/math";
import * as data from "./impl/data";
import * as analysis from "./impl/analysis";

/**
 * Skills that transform text are meaningless without any. Left unguarded they
 * quietly operate on the empty string — a bare /sha-hash returned the hash of
 * "" as though it were an answer, and /slugify produced a blank reply.
 */
function needsText(fn: Executor, usage: string): Executor {
  return async (input, signal) => {
    const supplied = typeof input.text === "string" ? input.text.trim() : String(input.text ?? "").trim();
    const hasNamedInput = Object.keys(input).some((key) => key !== "text" && input[key] !== "" && input[key] !== undefined);
    if (!supplied && !hasNamedInput) return { ok: false, error: `Nothing to work with. Try: ${usage}` };
    return fn(input, signal);
  };
}

register("text.change-case", async () => needsText(text.changeCase, "/change-case mode=snake Hello World"));
register("text.slugify", async () => needsText(text.slugify, "/slugify My Post Title"));
register("text.trim-whitespace", async () => needsText(text.trimWhitespace, "/trim-whitespace  spaced   out "));
register("text.dedupe-lines", async () => needsText(text.dedupeLines, "/dedupe-lines a b a"));
register("text.sort-lines", async () => needsText(text.sortLines, "/sort-lines c a b"));
register("text.reverse-text", async () => needsText(text.reverseText, "/reverse-text mode=words one two three"));
register("text.word-char-count", async () => needsText(text.wordCharCount, "/word-char-count some text here"));
register("text.wrap-text", async () => needsText(text.wrapText, "/wrap-text width=40 long text…"));
register("text.find-replace", async () => needsText(text.findReplace, "/find-replace find=a replace=b banana"));
register("text.join-lines", async () => needsText(text.joinLines, "/join-lines delimiter=, a b c"));
register("text.number-lines", async () => needsText(text.numberLines, "/number-lines first second"));
register("text.remove-empty-lines", async () => needsText(text.removeEmptyLines, "/remove-empty-lines <your text>"));
register("text.smart-quotes", async () => needsText(text.smartQuotes, '/smart-quotes "hello"'));
register("text.lorem-ipsum", async () => text.loremIpsum);
register("text.text-diff", async () => text.textDiff);
register("text.split-text", async () => needsText(text.splitText, "/split-text delimiter=, a,b,c"));

register("encode.base64-encode-decode", async () => needsText(encode.base64, "/base64-encode-decode hello"));
register("encode.url-encode-decode", async () => needsText(encode.urlEncode, "/url-encode-decode a b&c"));
register("encode.html-entity-escape", async () => needsText(encode.htmlEntities, "/html-entity-escape <b>hi</b>"));
register("encode.hex-convert", async () => needsText(encode.hexConvert, "/hex-convert hello"));
register("encode.binary-convert", async () => needsText(encode.binaryConvert, "/binary-convert hi"));
register("encode.jwt-decode", async () => needsText(encode.jwtDecode, "/jwt-decode eyJhbGc…"));
register("encode.rot13-caesar", async () => needsText(encode.rot13, "/rot13-caesar shift=13 secret"));
register("encode.query-string-parse", async () => needsText(encode.queryString, "/query-string-parse a=1&b=2"));
register("encode.unicode-escape", async () => needsText(encode.unicodeEscape, "/unicode-escape café"));
register("encode.morse-code", async () => needsText(encode.morse, "/morse-code sos"));

register("crypto.sha-hash", async () => needsText(crypto.shaHash, "/sha-hash algorithm=SHA-256 hello"));
register("crypto.hmac-sign", async () => crypto.hmacSign);
register("crypto.uuid-generate", async () => crypto.uuidGenerate);
register("crypto.nano-id", async () => crypto.nanoId);
register("crypto.random-bytes", async () => crypto.randomBytes);
register("crypto.password-generate", async () => crypto.passwordGenerate);
register("crypto.passphrase-generate", async () => crypto.passphraseGenerate);
register("crypto.password-strength", async () => needsText(crypto.passwordStrength, "/password-strength hunter2"));
register("crypto.totp-code", async () => crypto.totpCode);

register("datetime.timestamp-convert", async () => datetime.timestampConvert);
register("datetime.timezone-convert", async () => datetime.timezoneConvert);
register("datetime.date-format", async () => datetime.dateFormat);
register("datetime.date-difference", async () => datetime.dateDifference);
register("datetime.date-add-subtract", async () => datetime.dateAddSubtract);
register("datetime.business-days", async () => datetime.businessDays);
register("datetime.age-calculate", async () => datetime.ageCalculate);
register("datetime.duration-parse", async () => datetime.durationParse);
register("datetime.week-number", async () => datetime.weekNumber);
register("datetime.countdown", async () => datetime.countdown);

register("math.expression-evaluate", async () => needsText(math.expressionEvaluate, "/expression-evaluate 2+3*4"));
register("math.unit-convert", async () => math.unitConvert);
register("math.percentage", async () => math.percentage);
register("math.base-convert", async () => math.baseConvert);
register("math.descriptive-stats", async () => math.descriptiveStats);
register("math.number-format", async () => math.numberFormat);
register("math.random-number", async () => math.randomNumber);
register("math.prime-factor", async () => math.primeFactor);
register("math.interest-calculate", async () => math.interestCalculate);
register("math.aspect-ratio", async () => math.aspectRatio);
register("math.roman-numerals", async () => math.romanNumerals);

register("data-format.json-format", async () => needsText(data.jsonFormat, "/json-format {\"a\":1}"));
register("data-format.json-minify", async () => needsText(data.jsonMinify, "/json-minify {\"a\": 1}"));
register("data-format.json-validate", async () => needsText(data.jsonValidate, "/json-validate {\"a\":1}"));
register("data-format.json-flatten", async () => needsText(data.jsonFlatten, "/json-flatten {\"a\":{\"b\":1}}"));
register("data-format.json-path-query", async () => data.jsonPathQuery);
register("data-format.json-diff", async () => data.jsonDiff);
register("data-format.csv-to-json", async () => needsText(data.csvToJson, "/csv-to-json name,age…"));
register("data-format.json-to-csv", async () => needsText(data.jsonToCsv, "/json-to-csv [{\"a\":1}]"));
register("data-format.ndjson-split", async () => needsText(data.ndjsonSplit, "/ndjson-split [1,2,3]"));

register("regex.regex-test", async () => analysis.regexTest);
register("regex.regex-extract", async () => analysis.regexExtract);
register("regex.regex-replace", async () => analysis.regexReplace);
register("regex.regex-escape", async () => needsText(analysis.regexEscape, "/regex-escape a.b*c"));
register("regex.glob-to-regex", async () => analysis.globToRegex);
register("regex.common-patterns", async () => analysis.commonPatterns);

register("text-analysis.reading-time", async () => needsText(analysis.readingTime, "/reading-time <your text>"));
register("text-analysis.keyword-frequency", async () => needsText(analysis.keywordFrequency, "/keyword-frequency <your text>"));
register("text-analysis.n-gram-extract", async () => needsText(analysis.nGramExtract, "/n-gram-extract <your text>"));
register("text-analysis.levenshtein-distance", async () => analysis.levenshteinDistance);
register("text-analysis.fuzzy-match", async () => analysis.fuzzyMatch);
register("text-analysis.readability-score", async () => needsText(analysis.readabilityScore, "/readability-score <your text>"));
register("text-analysis.outline-extract", async () => needsText(analysis.outlineExtract, "/outline-extract # Heading…"));
register("text-analysis.table-of-contents", async () => needsText(analysis.tableOfContents, "/table-of-contents # Heading…"));
register("text-analysis.todo-extract", async () => needsText(analysis.todoExtract, "/todo-extract - [ ] task"));
register("text-analysis.frontmatter-parse", async () => needsText(analysis.frontmatterParse, "/frontmatter-parse --- title: x ---"));
register("text-analysis.language-detect", async () => needsText(analysis.languageDetect, "/language-detect some text"));

export {};
