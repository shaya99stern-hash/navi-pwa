import { tool } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const supabaseTools = {
  querySupabase: tool({
    description: "Query Supabase tables and return rows from a database table.",
    inputSchema: z.object({
      table: z.string().describe("The Supabase table name to query"),
      select: z
        .string()
        .optional()
        .describe("Columns to select, defaults to all columns"),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of rows to return"),
    }),
    execute: async ({ table, select = "*", limit = 10 }) => {
      const supabase = await createClient();

      try {
        const { data, error } = await supabase
          .from(table)
          .select(select)
          .limit(limit);

        if (error) {
          return {
            success: false,
            error: error.message,
          };
        }

        return {
          success: true,
          data: data ?? [],
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    },
  }),
};
