/**
 * MCP tool for discovering Discourse communities via ChromaDB semantic search.
 * Supports two query modes:
 * 1. Text search: semantic search by query string
 * 2. Nearest neighbors: find communities similar to a known one
 */

import { z } from "zod";
import type { RegisterFn } from "../types.js";
import {
  queryByText,
  queryByEmbedding,
  getByIds,
  getByMetadata,
  type ChromaGetResponse,
} from "../../chroma/client.js";
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
 * Rerank communities by confidence, engagement, and activity.
 * Prioritizes high-engagement active communities when confidence scores are similar.
 */
function rerank(communities: Community[]): Community[] {
  const tierOrder: Record<string, number> = { high: 3, medium: 2, low: 1, unknown: 0 };

  return [...communities].sort((a, b) => {
    // Primary: confidence score (from distance)
    // Only use as tiebreaker if difference is significant (>0.1)
    const confDiff = b.confidence - a.confidence;
    if (Math.abs(confDiff) > 0.1) return confDiff;

    // Secondary: engagement tier
    const tierDiff = (tierOrder[b.engagement_tier] || 0) - (tierOrder[a.engagement_tier] || 0);
    if (tierDiff !== 0) return tierDiff;

    // Tertiary: active users in last 30 days
    return b.active_users_30_days - a.active_users_30_days;
  });
}

/**
 * Resolve a URL or ID to a document with its embedding.
 */
async function resolveToDocument(
  input: string
): Promise<{ id: string; metadata: DiscourseMetadata; embedding: number[] }> {
  let result: ChromaGetResponse;

  // If already looks like an ID (e.g., "discover_1376")
  if (input.startsWith("discover_")) {
    result = await getByIds([input], ["metadatas", "embeddings"]);

    if (!result.ids?.[0]) {
      throw new Error(`Community not found with ID: ${input}`);
    }
  } else {
    // Normalize URL (remove trailing slash)
    const normalizedUrl = input.replace(/\/$/, "");

    // Search by URL in metadata
    result = await getByMetadata({ url: normalizedUrl }, ["metadatas", "embeddings"]);

    if (!result.ids?.[0]) {
      // Try with trailing slash
      result = await getByMetadata({ url: normalizedUrl + "/" }, ["metadatas", "embeddings"]);

      if (!result.ids?.[0]) {
        throw new Error(`Community not found with URL: ${input}`);
      }
    }
  }

  const embedding = result.embeddings?.[0];
  if (!embedding) {
    throw new Error(`Could not retrieve embedding for community: ${input}`);
  }

  return {
    id: result.ids[0],
    metadata: result.metadatas?.[0] as unknown as DiscourseMetadata,
    embedding,
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

        // Build where clause from filters
        const whereClause = buildWhereClause({ min_users, engagement_tier, locale });

        let communities: Community[];
        let responseQuery: string | undefined;
        let similarToRef: SimilarToReference | undefined;

        if (query) {
          // Mode 1: Text search via proxy
          const results = await queryByText([query], limit, whereClause);

          communities = rerank(
            transformResults(
              results.ids[0] || [],
              results.metadatas?.[0] || [],
              results.distances?.[0] || []
            )
          );
          responseQuery = query;
        } else if (similar_to) {
          // Mode 2: Nearest neighbors via proxy
          const { id: sourceId, metadata: sourceMetadata, embedding } = await resolveToDocument(
            similar_to
          );

          // Query for nearest neighbors using the embedding
          const results = await queryByEmbedding([embedding], limit + 1, whereClause);

          // Transform, filter out the source document, and rerank
          const allCommunities = transformResults(
            results.ids[0] || [],
            results.metadatas?.[0] || [],
            results.distances?.[0] || []
          );

          communities = rerank(
            allCommunities.filter((c) => c.id !== sourceId)
          ).slice(0, limit);

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
