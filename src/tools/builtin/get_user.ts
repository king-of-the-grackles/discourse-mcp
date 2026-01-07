import { z } from "zod";
import type { RegisterFn } from "../types.js";

export const registerGetUser: RegisterFn = (server, ctx) => {
  const schema = z.object({
    username: z.string().min(1).describe("The Discourse username to look up (without @ symbol, e.g., 'codinghorror')"),
  });

  server.registerTool(
    "discourse_get_user",
    {
      title: "Get User",
      description: "Get information about a Discourse user by username. Returns name, trust level, join date, bio, and profile link.",
      inputSchema: schema.shape,
      annotations: {
        title: "Get Discourse User Info",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ username }, _extra: any) => {
      try {
        const { base, client } = ctx.siteState.ensureSelectedSite();
        const data = (await client.get(`/u/${encodeURIComponent(username)}.json`)) as any;
        const user = data?.user || data?.user_badges || data;
        const name = user?.name || username;
        const trust = user?.trust_level;
        const created = user?.created_at || user?.user?.created_at || "";
        const bio = user?.bio_raw || "";
        const lines = [
          `@${username} (${name})`,
          trust != null ? `Trust level: ${trust}` : undefined,
          created ? `Joined: ${created}` : undefined,
          bio ? "" : undefined,
          bio ? bio.slice(0, 1000) : undefined,
          `Profile: ${base}/u/${encodeURIComponent(username)}`,
        ].filter(Boolean) as string[];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to get user ${username}: ${e?.message || String(e)}` }], isError: true };
      }
    }
  );
};

