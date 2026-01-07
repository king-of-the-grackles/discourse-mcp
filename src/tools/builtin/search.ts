import { z } from "zod";
import type { RegisterFn } from "../types.js";

export const registerSearch: RegisterFn = (server, ctx) => {
  const schema = z.object({
    query: z.string().min(1).describe("Search query text (e.g., 'how to install plugin'). Supports Discourse search operators like @username, #tag, category:name, status:open, order:latest"),
    with_private: z.boolean().optional().describe("Include private messages and topics in search results (requires authentication). Default: false"),
    max_results: z.number().int().min(1).max(50).optional().describe("Maximum number of results to return (1-50). Default: 10"),
  });

  server.registerTool(
    "discourse_search",
    {
      title: "Search Discourse",
      description: "Search Discourse site content including topics, posts, and users. Use search operators like @username, #tag, category:name for filtered results.",
      inputSchema: schema.shape,
      annotations: {
        title: "Search Discourse Content",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args, _extra: any) => {
      const { query, with_private = false, max_results = 10 } = args;
      const { base, client } = ctx.siteState.ensureSelectedSite();
      const q = new URLSearchParams();
      q.set("expanded", "true");
      const fullQuery = ctx.defaultSearchPrefix ? `${ctx.defaultSearchPrefix} ${query}` : query;
      q.set("q", fullQuery);
      try {
        const data = (await client.get(`/search.json?${q.toString()}`)) as any;
        const topics: any[] = data?.topics || [];
        const posts: any[] = data?.posts || [];

        const items = (topics.map((t) => ({
          type: "topic" as const,
          id: t.id,
          title: t.title,
          slug: t.slug,
        })) as Array<{ type: "topic"; id: number; title: string; slug: string }>).slice(0, max_results);

        const lines: string[] = [];
        lines.push(`Top results for "${query}":`);
        let idx = 1;
        for (const it of items) {
          const url = `${base}/t/${it.slug}/${it.id}`;
          lines.push(`${idx}. ${it.title} – ${url}`);
          idx++;
        }

        const jsonFooter = {
          results: items.map((it) => ({ id: it.id, url: `${base}/t/${it.slug}/${it.id}`, title: it.title })),
        };
        const text = lines.join("\n") + "\n\n```json\n" + JSON.stringify(jsonFooter) + "\n```\n";
        return { content: [{ type: "text", text }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Search failed: ${e?.message || String(e)}` }], isError: true };
      }
    }
  );
};

