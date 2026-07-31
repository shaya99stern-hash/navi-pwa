import { tool, type ToolSet } from "ai";
import { z } from "zod";
import * as analysis from "../skills/impl/analysis";
import * as data from "../skills/impl/data";
import * as datetime from "../skills/impl/datetime";
import * as math from "../skills/impl/math";
import type { SkillResult } from "../skills/registry";

/**
 * A deliberately small set. Every one of these is something models get wrong by
 * approximating — arithmetic, unit conversion, date maths, counting — and every
 * one is a function that simply cannot be wrong. The implementations are the
 * same ones behind the slash commands, so they are already covered by tests.
 *
 * Kept short on purpose: tool choice degrades as the list grows, and a model
 * that ignores the calculator because it is buried is worse than no calculator.
 */
function render(result: SkillResult): string {
  if (!result.ok) return `Error: ${result.error ?? "unknown"}`;
  const { output } = result;
  return typeof output === "string" ? output : JSON.stringify(output, null, 2);
}

export function buildSkillTools(): ToolSet {
  return {
    calculate: tool({
      description:
        "Evaluate an arithmetic expression exactly. Use this for ANY calculation rather than working it out yourself — including percentages, totals, averages, and anything with more than two operands. Supports + - * / % ^, brackets, and sqrt, round, floor, ceil, abs, min, max, log, ln, sin, cos, tan, plus the constants pi and e.",
      inputSchema: z.object({
        expression: z.string().describe('The expression, for example "1240 * 0.17" or "sqrt(2) * 100".')
      }),
      execute: async ({ expression }) => render(await math.expressionEvaluate({ text: expression }))
    }),

    convert_units: tool({
      description:
        "Convert a value between units of length, mass, volume, data, speed, time, or temperature. Use it instead of recalling a conversion factor.",
      inputSchema: z.object({
        value: z.number().describe("The quantity to convert."),
        from: z.string().describe("Source unit, e.g. mi, kg, gb, c, tbsp."),
        to: z.string().describe("Target unit, e.g. km, lb, mib, f, ml.")
      }),
      execute: async ({ value, from, to }) => render(await math.unitConvert({ value, from, to }))
    }),

    date_calculate: tool({
      description:
        "Date arithmetic with a real calendar: the gap between two dates, shifting a date, counting working days, or an exact age. Use it for anything involving elapsed time — leap years, month lengths, and weekends are handled properly here and guessed badly otherwise.",
      inputSchema: z.object({
        mode: z.enum(["difference", "add", "business_days", "age", "week_number"])
          .describe("Which calculation to run."),
        from: z.string().optional().describe("Start date, ISO or unix. Defaults to now where sensible."),
        to: z.string().optional().describe("End date for difference and business_days."),
        years: z.number().optional(),
        months: z.number().optional(),
        days: z.number().optional(),
        hours: z.number().optional()
      }),
      execute: async ({ mode, from, to, years, months, days, hours }) => {
        if (mode === "difference") return render(await datetime.dateDifference({ from, to }));
        if (mode === "business_days") return render(await datetime.businessDays({ from, to }));
        if (mode === "age") return render(await datetime.ageCalculate({ birthday: from, on: to }));
        if (mode === "week_number") return render(await datetime.weekNumber({ value: from }));
        return render(await datetime.dateAddSubtract({ value: from, years, months, days, hours }));
      }
    }),

    inspect_text: tool({
      description:
        "Measure a passage of text: exact word, character, line and paragraph counts, reading time, readability grades, or the most frequent terms. Use it whenever the user asks how long something is or how hard it reads — counting by eye is unreliable.",
      inputSchema: z.object({
        text: z.string().describe("The text to measure."),
        measure: z.enum(["counts", "reading_time", "readability", "keywords"]).describe("Which measurement to return.")
      }),
      execute: async ({ text, measure }) => {
        if (measure === "reading_time") return render(await analysis.readingTime({ text }));
        if (measure === "readability") return render(await analysis.readabilityScore({ text }));
        if (measure === "keywords") return render(await analysis.keywordFrequency({ text }));
        const { wordCharCount } = await import("../skills/impl/text");
        return render(await wordCharCount({ text }));
      }
    }),

    transform_data: tool({
      description:
        "Validate, reformat, or convert structured data — JSON and CSV. Use it to check whether JSON is valid and where it breaks, rather than reading it by eye, and to convert between the two formats without transcription mistakes.",
      inputSchema: z.object({
        input: z.string().describe("The JSON or CSV document."),
        operation: z.enum(["validate_json", "format_json", "flatten_json", "json_to_csv", "csv_to_json"])
          .describe("What to do with it.")
      }),
      execute: async ({ input, operation }) => {
        if (operation === "validate_json") return render(await data.jsonValidate({ text: input }));
        if (operation === "format_json") return render(await data.jsonFormat({ text: input }));
        if (operation === "flatten_json") return render(await data.jsonFlatten({ text: input }));
        if (operation === "json_to_csv") return render(await data.jsonToCsv({ text: input }));
        return render(await data.csvToJson({ text: input }));
      }
    })
  };
}
