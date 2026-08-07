import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { supabase } from "@/lib/supabase";

export function buildSupabaseTools(onActivity?: (label: z.infer<any>) => void): ToolSet {
  return {
    supabaseQuery: tool({
      description: "Query or read rows from a Supabase table",
      parameters: z.object({
        table: z.string().describe("The name of the database table"),
        select: z.string().optional().describe("Columns to select, defaults to '*'"),
        limit: z.number().optional().describe("Max rows to return")
      }),
      execute: async ({ table, select = "*", limit = 10 }) => {
        onActivity?.(`Querying Supabase table: ${table}`);
        const { data, error } = await supabase.from(table).select(select).limit(limit);
        if (error) return { success: false, error: error.message };
        return { success: true, data };
      }
    }),
    supabaseUploadFile: tool({
      description: "Upload a file or data payload to Supabase Storage",
      parameters: z.object({
        bucket: z.string().describe("Storage bucket name"),
        path: z.string().describe("File path inside the bucket"),
        content: z.string().describe("Text content or data string to store")
      }),
      execute: async ({ bucket, path, content }) => {
        onActivity?.(`Uploading to Supabase Storage: ${bucket}/${path}`);
        const { data, error } = await supabase.storage.from(bucket).upload(path, content, { upsert: true });
        if (error) return { success: false, error: error.message };
        return { success: true, data };
      }
    })
  };
}
