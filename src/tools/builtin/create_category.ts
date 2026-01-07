import { z } from "zod";
import type { RegisterFn } from "../types.js";

let lastCategoryAt = 0;

export const registerCreateCategory: RegisterFn = (server, ctx, opts) => {
  if (!opts.allowWrites) return; // disabled by default

  const schema = z.object({
    name: z.string().min(1).max(100).describe("Category name (1-100 characters)"),
    color: z.string().regex(/^[0-9a-fA-F]{6}$/).optional().describe("Background color as 6-digit hex without # (e.g., 'FF5733')"),
    text_color: z.string().regex(/^[0-9a-fA-F]{6}$/).optional().describe("Text color as 6-digit hex without # (e.g., 'FFFFFF')"),
    emoji: z.string().optional().describe("Category emoji icon (e.g., '📚' or 'books')"),
    icon: z.string().optional().describe("Font Awesome icon name (e.g., 'book', 'cog')"),
    parent_category_id: z.number().int().positive().optional().describe("Parent category ID for creating subcategories"),
    description: z.string().min(1).max(10000).optional().describe("Category description shown to users"),
  });

  server.registerTool(
    "discourse_create_category",
    {
      title: "Create Category",
      description: "Create a new category in Discourse. Requires admin API key and write permissions. Rate limited to 1 request per second.",
      inputSchema: schema.shape,
      annotations: {
        title: "Create Discourse Category",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input: any, _extra: any) => {
      const { name, color, text_color, emoji, icon, parent_category_id, description } = schema.parse(input);

      // Simple 1 req/sec rate limit
      const now = Date.now();
      if (now - lastCategoryAt < 1000) {
        const wait = 1000 - (now - lastCategoryAt);
        await new Promise((r) => setTimeout(r, wait));
      }
      lastCategoryAt = Date.now();

      try {
        const { base, client } = ctx.siteState.ensureSelectedSite();

        const payload: any = { name };
        if (color) payload.color = color;
        if (text_color) payload.text_color = text_color;
        if (parent_category_id) payload.parent_category_id = parent_category_id;
        if (description) payload.description = description;
        if (emoji) payload.emoji = emoji;
        if (icon) payload.icon = icon;
        if (emoji) {
          payload.style_type = 2;
        } else if (icon) {
          payload.style_type = 1;
        }

        const data: any = await client.post(`/categories.json`, payload);
        const category = data?.category || data;

        const id = category?.id;
        const slug = category?.slug || (category?.name ? String(category.name).toLowerCase().replace(/\s+/g, "-") : undefined);
        const title = category?.name || name;

        const link = id && slug ? `${base}/c/${slug}/${id}` : `${base}/categories`;
        return { content: [{ type: "text", text: `Created category "${title}": ${link}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to create category: ${e?.message || String(e)}` }], isError: true };
      }
    }
  );
};
