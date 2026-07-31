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
import { register } from "./registry";
import * as text from "./impl/text";
import * as encode from "./impl/encode";
import * as crypto from "./impl/crypto";
import * as datetime from "./impl/datetime";
import * as math from "./impl/math";
import * as data from "./impl/data";
import * as analysis from "./impl/analysis";

register("text.change-case", async () => text.changeCase);
register("text.slugify", async () => text.slugify);
register("text.trim-whitespace", async () => text.trimWhitespace);
register("text.dedupe-lines", async () => text.dedupeLines);
register("text.sort-lines", async () => text.sortLines);
register("text.reverse-text", async () => text.reverseText);
register("text.word-char-count", async () => text.wordCharCount);
register("text.wrap-text", async () => text.wrapText);
register("text.find-replace", async () => text.findReplace);
register("text.join-lines", async () => text.joinLines);
register("text.number-lines", async () => text.numberLines);
register("text.remove-empty-lines", async () => text.removeEmptyLines);
register("text.smart-quotes", async () => text.smartQuotes);
register("text.lorem-ipsum", async () => text.loremIpsum);
register("text.text-diff", async () => text.textDiff);
register("text.split-text", async () => text.splitText);

register("encode.base64-encode-decode", async () => encode.base64);
register("encode.url-encode-decode", async () => encode.urlEncode);
register("encode.html-entity-escape", async () => encode.htmlEntities);
register("encode.hex-convert", async () => encode.hexConvert);
register("encode.binary-convert", async () => encode.binaryConvert);
register("encode.jwt-decode", async () => encode.jwtDecode);
register("encode.rot13-caesar", async () => encode.rot13);
register("encode.query-string-parse", async () => encode.queryString);
register("encode.unicode-escape", async () => encode.unicodeEscape);
register("encode.morse-code", async () => encode.morse);

register("crypto.sha-hash", async () => crypto.shaHash);
register("crypto.hmac-sign", async () => crypto.hmacSign);
register("crypto.uuid-generate", async () => crypto.uuidGenerate);
register("crypto.nano-id", async () => crypto.nanoId);
register("crypto.random-bytes", async () => crypto.randomBytes);
register("crypto.password-generate", async () => crypto.passwordGenerate);
register("crypto.passphrase-generate", async () => crypto.passphraseGenerate);
register("crypto.password-strength", async () => crypto.passwordStrength);
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

register("math.expression-evaluate", async () => math.expressionEvaluate);
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

register("data-format.json-format", async () => data.jsonFormat);
register("data-format.json-minify", async () => data.jsonMinify);
register("data-format.json-validate", async () => data.jsonValidate);
register("data-format.json-flatten", async () => data.jsonFlatten);
register("data-format.json-path-query", async () => data.jsonPathQuery);
register("data-format.json-diff", async () => data.jsonDiff);
register("data-format.csv-to-json", async () => data.csvToJson);
register("data-format.json-to-csv", async () => data.jsonToCsv);
register("data-format.ndjson-split", async () => data.ndjsonSplit);

register("regex.regex-test", async () => analysis.regexTest);
register("regex.regex-extract", async () => analysis.regexExtract);
register("regex.regex-replace", async () => analysis.regexReplace);
register("regex.regex-escape", async () => analysis.regexEscape);
register("regex.glob-to-regex", async () => analysis.globToRegex);
register("regex.common-patterns", async () => analysis.commonPatterns);

register("text-analysis.reading-time", async () => analysis.readingTime);
register("text-analysis.keyword-frequency", async () => analysis.keywordFrequency);
register("text-analysis.n-gram-extract", async () => analysis.nGramExtract);
register("text-analysis.levenshtein-distance", async () => analysis.levenshteinDistance);
register("text-analysis.fuzzy-match", async () => analysis.fuzzyMatch);
register("text-analysis.readability-score", async () => analysis.readabilityScore);
register("text-analysis.outline-extract", async () => analysis.outlineExtract);
register("text-analysis.table-of-contents", async () => analysis.tableOfContents);
register("text-analysis.todo-extract", async () => analysis.todoExtract);
register("text-analysis.frontmatter-parse", async () => analysis.frontmatterParse);
register("text-analysis.language-detect", async () => analysis.languageDetect);

export {};
