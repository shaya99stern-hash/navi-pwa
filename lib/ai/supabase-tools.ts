import { tool } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export const supabaseTools = {
  querySupabase: tool({
    description: "Query Supabase tables and return rows from a database table.",
    inputSchema: z.object({
      table: z.string().describe("The Supabase table name to query"),
      select: z.string().optional().describe("Columns to select"),
      limit: z.number().optional().describe("Maximum rows to return"),
    }),
    execute: async ({ table, select = "*", limit = 10 }) => {
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
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  }),
};
