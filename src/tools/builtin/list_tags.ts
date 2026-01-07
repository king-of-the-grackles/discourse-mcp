import type { RegisterFn } from "../types.js";
import { z } from "zod";

export const registerListTags: RegisterFn = (server, ctx) => {
  const schema = z.object({}).strict();
  server.registerTool(
    "discourse_list_tags",
    {
      title: "List Tags",
      description: "List all available tags on the Discourse site (if tagging is enabled). Returns tag names and usage counts. Use tags in search queries with #tagname.",
      inputSchema: schema.shape,
      annotations: {
        title: "List Discourse Tags",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (_args, _extra: any) => {
      try {
        const { client } = ctx.siteState.ensureSelectedSite();
        const data = (await client.get(`/tags.json`)) as any;
        const tags: any[] = data?.tags || [];
        const lines = tags.map((t) => `- ${t.id} (${t.count ?? 0})`);
        const text = lines.length ? lines.join("\n") : "No tags found or tags disabled.";
        return { content: [{ type: "text", text }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to list tags: ${e?.message || String(e)}` }], isError: true };
      }
    }
  );
};

