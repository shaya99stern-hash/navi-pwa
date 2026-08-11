/**
 * Wires implementations to catalog ids.
 *
 * These are imported statically rather than lazily. Splitting them out saves a
 * few kilobytes but makes every skill's first use depend on fetching a chunk,
 * which fails exactly when the offline promise matters most. The loader
 * signature stays async so a genuinely heavy skill — a PDF or YAML parser —
 * can still be code-split behind a dynamic import.
 *
 * Every skill in data/skills.json is registered here and actually runs; the
 * registry hides anything unimplemented from suggestions rather than offering
 * a menu of dead ends.
 */
import { register, type Executor } from "./registry";
import * as text from "./impl/text";
import * as encode from "./impl/encode";
import * as crypto from "./impl/crypto";
import * as datetime from "./impl/datetime";
import * as math from "./impl/math";
import * as data from "./impl/data";
import * as analysis from "./impl/analysis";
import * as color from "./impl/color";
import * as convert from "./impl/convert";
import * as finance from "./impl/finance";
import * as web from "./impl/web";
import * as markdown from "./impl/markdown";
import * as list from "./impl/list";
import * as validate from "./impl/validate";
import * as geo from "./impl/geo";
import * as random from "./impl/random";

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

/* color */
register("color.hex-to-rgb", async () => color.hexToRgb);
register("color.rgb-to-hex", async () => color.rgbToHexSkill);
register("color.color-contrast", async () => color.colorContrast);
register("color.lighten-darken", async () => color.lightenDarken);
register("color.color-palette", async () => color.colorPalette);
register("color.hsl-convert", async () => color.hslConvert);
register("color.color-name", async () => color.colorName);
register("color.gradient-css", async () => color.gradientCss);
register("color.color-blind-sim", async () => color.colorBlindSim);
register("color.random-color", async () => color.randomColor);
register("color.color-mix", async () => color.colorMix);
register("color.luminance", async () => color.colorLuminance);

/* convert */
register("convert.temperature-convert", async () => convert.temperatureConvert);
register("convert.length-convert", async () => convert.lengthConvert);
register("convert.weight-convert", async () => convert.weightConvert);
register("convert.volume-convert", async () => convert.volumeConvert);
register("convert.area-convert", async () => convert.areaConvert);
register("convert.speed-convert", async () => convert.speedConvert);
register("convert.data-size-convert", async () => convert.dataSizeConvert);
register("convert.pressure-convert", async () => convert.pressureConvert);
register("convert.energy-convert", async () => convert.energyConvert);
register("convert.angle-convert", async () => convert.angleConvert);
register("convert.time-convert", async () => convert.timeConvert);
register("convert.fuel-economy", async () => convert.fuelEconomy);

/* finance */
register("finance.compound-interest", async () => finance.compoundInterest);
register("finance.loan-payment", async () => finance.loanPayment);
register("finance.currency-format", async () => finance.currencyFormat);
register("finance.tip-calculate", async () => finance.tipCalculate);
register("finance.discount-calculate", async () => finance.discountCalculate);
register("finance.vat-calculate", async () => finance.vatCalculate);
register("finance.roi-calculate", async () => finance.roiCalculate);
register("finance.break-even", async () => finance.breakEven);
register("finance.depreciation", async () => finance.depreciation);
register("finance.margin-markup", async () => finance.marginMarkup);

/* web */
register("web.url-parse", async () => web.urlParse);
register("web.slug-to-title", async () => web.slugToTitle);
register("web.meta-tags", async () => web.metaTags);
register("web.http-status", async () => web.httpStatus);
register("web.mime-type", async () => web.mimeType);
register("web.user-agent-parse", async () => web.userAgentParse);
register("web.cookie-parse", async () => web.cookieParse);
register("web.cors-headers", async () => web.corsHeaders);
register("web.robots-txt", async () => web.robotsTxt);
register("web.sitemap-entry", async () => web.sitemapEntry);
register("web.favicon-sizes", async () => web.faviconSizes);
register("web.data-uri", async () => web.dataUri);
register("web.srcset-generate", async () => web.srcsetGenerate);
register("web.media-query", async () => web.mediaQuery);

/* markdown */
register("markdown.md-to-text", async () => markdown.mdToText);
register("markdown.md-table", async () => markdown.mdTable);
register("markdown.md-escape", async () => markdown.mdEscape);
register("markdown.md-link-list", async () => markdown.mdLinkList);
register("markdown.md-heading-tree", async () => markdown.mdHeadingTree);
register("markdown.md-checklist", async () => markdown.mdChecklist);
register("markdown.md-footnotes", async () => markdown.mdFootnotes);
register("markdown.md-code-fence", async () => markdown.mdCodeFence);
register("markdown.md-badge", async () => markdown.mdBadge);
register("markdown.md-toc-links", async () => markdown.mdTocLinks);
register("markdown.md-blockquote", async () => markdown.mdBlockquote);
register("markdown.md-strip-formatting", async () => markdown.mdStripFormatting);

/* list */
register("list.list-unique", async () => list.listUnique);
register("list.list-intersect", async () => list.listIntersect);
register("list.list-difference", async () => list.listDifference);
register("list.list-union", async () => list.listUnion);
register("list.list-shuffle", async () => list.listShuffle);
register("list.list-chunk", async () => list.listChunk);
register("list.list-flatten", async () => list.listFlatten);
register("list.list-zip", async () => list.listZip);
register("list.list-rotate", async () => list.listRotate);
register("list.list-sample", async () => list.listSample);
register("list.list-frequency", async () => list.listFrequency);
register("list.list-partition", async () => list.listPartition);

/* validate */
register("validate.email-validate", async () => validate.emailValidate);
register("validate.url-validate", async () => validate.urlValidate);
register("validate.ip-validate", async () => validate.ipValidate);
register("validate.credit-card-validate", async () => validate.creditCardValidate);
register("validate.iban-validate", async () => validate.ibanValidate);
register("validate.isbn-validate", async () => validate.isbnValidate);
register("validate.mac-address-validate", async () => validate.macAddressValidate);
register("validate.hex-color-validate", async () => validate.hexColorValidate);
register("validate.semver-compare", async () => validate.semverCompare);
register("validate.phone-format", async () => validate.phoneFormat);
register("validate.postcode-validate", async () => validate.postcodeValidate);
register("validate.checksum-verify", async () => validate.checksumVerify);
register("validate.cron-describe", async () => validate.cronDescribe);
register("validate.json-schema-lite", async () => validate.jsonSchemaLite);

/* geo */
register("geo.haversine-distance", async () => geo.haversineDistance);
register("geo.bearing-calculate", async () => geo.bearingCalculate);
register("geo.coordinate-convert", async () => geo.coordinateConvert);
register("geo.bounding-box", async () => geo.boundingBox);
register("geo.geohash-encode", async () => geo.geohashEncode);
register("geo.utm-convert", async () => geo.utmConvert);
register("geo.timezone-offset", async () => geo.timezoneOffset);
register("geo.country-code", async () => geo.countryCode);

/* random */
register("random.dice-roll", async () => random.diceRoll);
register("random.coin-flip", async () => random.coinFlip);
register("random.random-pick", async () => random.randomPick);
register("random.random-string", async () => random.randomString);
register("random.weighted-pick", async () => random.weightedPick);
register("random.shuffle-seed", async () => random.shuffleSeed);
