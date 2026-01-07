/**
 * MCP tool for discovering Discourse communities via ChromaDB semantic search.
 * Supports two query modes:
 * 1. Text search: semantic search by query string
 * 2. Nearest neighbors: find communities similar to a known one
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import { getChromaCollection } from "../../chroma/client.js";
import {
  calculateConfidenceFromDistance,
  classifyMatchTier,
  calculateConfidenceStats,
  calculateTierDistribution,
} from "../../chroma/scoring.js";
import type {
  Community,
  DiscourseMetadata,
  SearchResponse,
  SimilarToReference,
} from "../../chroma/types.js";

/**
 * Build ChromaDB where clause from filter parameters.
 */
function buildWhereClause(filters: {
  min_users?: number;
  engagement_tier?: string;
  locale?: string;
}): Record<string, unknown> | undefined {
  const clauses: Record<string, unknown>[] = [];

  if (filters.min_users !== undefined) {
    clauses.push({ users_count: { $gte: filters.min_users } });
  }
  if (filters.engagement_tier) {
    clauses.push({ engagement_tier: filters.engagement_tier });
  }
  if (filters.locale) {
    clauses.push({ locale: filters.locale });
  }

  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

/**
 * Transform ChromaDB results into Community objects with confidence scoring.
 */
function transformResults(
  ids: string[],
  metadatas: (Record<string, unknown> | null)[],
  distances: (number | null)[]
): Community[] {
  const communities: Community[] = [];

  for (let i = 0; i < ids.length; i++) {
    const metadata = metadatas[i] as unknown as DiscourseMetadata | null;
    const distance = distances[i];

    if (!metadata || distance === null) continue;

    communities.push({
      id: metadata.id || ids[i],
      title: metadata.title || "Unknown",
      url: metadata.url || "",
      description: metadata.description || metadata.excerpt || "",
      users_count: metadata.users_count || 0,
      active_users_30_days: metadata.active_users_30_days || 0,
      engagement_tier: metadata.engagement_tier || "unknown",
      categories: metadata.categories || "",
      tags: metadata.tags || "",
      confidence: Number(calculateConfidenceFromDistance(distance).toFixed(3)),
      distance: Number(distance.toFixed(4)),
      match_tier: classifyMatchTier(distance),
    });
  }

  return communities;
}

/**
 * Resolve a URL or ID to a ChromaDB document ID.
 */
async function resolveToDocumentId(
  collection: Awaited<ReturnType<typeof getChromaCollection>>,
  input: string
): Promise<{ id: string; metadata: DiscourseMetadata }> {
  // If already looks like an ID (e.g., "discover_1376")
  if (input.startsWith("discover_")) {
    const result = await collection.get({
      ids: [input],
      include: ["metadatas"],
    });

    if (!result.ids?.[0]) {
      throw new Error(`Community not found with ID: ${input}`);
    }

    return {
      id: result.ids[0],
      metadata: result.metadatas?.[0] as unknown as DiscourseMetadata,
    };
  }

  // Normalize URL (remove trailing slash)
  const normalizedUrl = input.replace(/\/$/, "");

  // Search by URL in metadata
  const result = await collection.get({
    where: { url: normalizedUrl },
    include: ["metadatas"],
  });

  if (!result.ids?.[0]) {
    // Try with trailing slash
    const resultWithSlash = await collection.get({
      where: { url: normalizedUrl + "/" },
      include: ["metadatas"],
    });

    if (!resultWithSlash.ids?.[0]) {
      throw new Error(`Community not found with URL: ${input}`);
    }

    return {
      id: resultWithSlash.ids[0],
      metadata: resultWithSlash.metadatas?.[0] as unknown as DiscourseMetadata,
    };
  }

  return {
    id: result.ids[0],
    metadata: result.metadatas?.[0] as unknown as DiscourseMetadata,
  };
}

/**
 * Generate suggested next actions based on search results.
 */
function generateNextActions(communities: Community[]): string[] {
  const actions: string[] = [];

  if (communities.length > 0) {
    actions.push(
      `Use discourse_select_site with one of the URLs above to interact with that community.`
    );

    const highEngagement = communities.filter((c) => c.engagement_tier === "high");
    if (highEngagement.length > 0) {
      actions.push(
        `Consider starting with high-engagement communities for more active discussions.`
      );
    }
  } else {
    actions.push(`Try a different search query or remove filters to find more communities.`);
  }

  return actions;
}

/**
 * Input schema for the tool (without refine for MCP registration).
 */
const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .optional()
    .describe("Semantic text search query (e.g., 'note taking productivity')"),
  similar_to: z
    .string()
    .optional()
    .describe(
      "Find communities similar to this one. Accepts a community URL (e.g., 'https://forum.obsidian.md') or ID (e.g., 'discover_1376')"
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Maximum number of results to return (default: 10, max: 50)"),
  min_users: z
    .number()
    .int()
    .optional()
    .describe("Filter by minimum total user count"),
  engagement_tier: z
    .enum(["high", "medium", "low"])
    .optional()
    .describe("Filter by engagement level: high (>5% MAU), medium (>1% MAU), low (<1% MAU)"),
  locale: z
    .string()
    .optional()
    .describe("Filter by locale code (e.g., 'en', 'de', 'fr')"),
});

export const registerSearchDiscourseCommunities: RegisterFn = (server, ctx) => {
  server.registerTool(
    "search_discourse_communities",
    {
      title: "Search Discourse Communities",
      description:
        "Discover Discourse forum communities by topic or find similar communities. " +
        "Use 'query' for semantic text search (e.g., 'note taking productivity') or " +
        "'similar_to' to find communities similar to a known one by URL or ID. " +
        "Provide exactly one of 'query' or 'similar_to'. " +
        "Returns communities with confidence scores and engagement metrics.",
      inputSchema: inputSchema.shape,
      annotations: {
        title: "Search Discourse Communities Directory",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: any, _extra: any) => {
      try {
        const { query, similar_to, limit = 10, min_users, engagement_tier, locale } = args;

        // Validate: exactly one of query or similar_to must be provided
        if ((query && similar_to) || (!query && !similar_to)) {
          return {
            content: [
              {
                type: "text",
                text: `Validation error: Provide exactly one of 'query' or 'similar_to'`,
              },
            ],
            isError: true,
          };
        }

        // Get ChromaDB collection
        const collection = await getChromaCollection();

        // Build where clause from filters
        const whereClause = buildWhereClause({ min_users, engagement_tier, locale });

        let communities: Community[];
        let responseQuery: string | undefined;
        let similarToRef: SimilarToReference | undefined;

        if (query) {
          // Mode 1: Text search
          const results = await collection.query({
            queryTexts: [query],
            nResults: limit,
            where: whereClause as any,
          });

          communities = transformResults(
            results.ids[0] || [],
            results.metadatas?.[0] || [],
            results.distances?.[0] || []
          );
          responseQuery = query;
        } else if (similar_to) {
          // Mode 2: Nearest neighbors
          const { id: sourceId, metadata: sourceMetadata } = await resolveToDocumentId(
            collection,
            similar_to
          );

          // Get the source document's embedding
          const sourceDoc = await collection.get({
            ids: [sourceId],
            include: ["embeddings"],
          });

          if (!sourceDoc.embeddings?.[0]) {
            throw new Error(`Could not retrieve embedding for community: ${similar_to}`);
          }

          // Query for nearest neighbors using the embedding
          const results = await collection.query({
            queryEmbeddings: [sourceDoc.embeddings[0]],
            nResults: limit + 1, // +1 because the source doc will be in results
            where: whereClause as any,
          });

          // Transform and filter out the source document
          const allCommunities = transformResults(
            results.ids[0] || [],
            results.metadatas?.[0] || [],
            results.distances?.[0] || []
          );

          communities = allCommunities.filter((c) => c.id !== sourceId).slice(0, limit);

          similarToRef = {
            id: sourceId,
            title: sourceMetadata?.title || "Unknown",
            url: sourceMetadata?.url || similar_to,
          };
        } else {
          // Should not happen due to validation above
          throw new Error("Provide exactly one of 'query' or 'similar_to'");
        }

        // Build response
        const response: SearchResponse = {
          ...(responseQuery && { query: responseQuery }),
          ...(similarToRef && { similar_to: similarToRef }),
          communities,
          summary: {
            total_found: communities.length,
            returned: communities.length,
            has_more: communities.length === limit,
            confidence_stats: calculateConfidenceStats(communities),
            tier_distribution: calculateTierDistribution(communities),
          },
          next_actions: generateNextActions(communities),
        };

        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        ctx.logger.error("search_discourse_communities failed", { error: message });
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );
};
