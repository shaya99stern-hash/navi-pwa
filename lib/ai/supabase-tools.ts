export const supabaseTools = {
  querySupabase: tool({
    description: "Query Supabase tables",
    inputSchema: z.object({
      table: z.string(),
      select: z.string().optional(),
      limit: z.number().optional(),
    }),
    execute: async (args) => {
      const { table, select = "*", limit = 10 } = args;

      onActivity?.(`Querying Supabase table: ${table}`);

      const { data, error } = await supabase
        .from(table)
        .select(select)
        .limit(limit);

      if (error) {
        return { success: false, error: error.message };
      }

      return {
        success: true,
        data,
      };
    },
  }),
};
