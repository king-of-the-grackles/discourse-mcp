/**
 * TypeScript interfaces for ChromaDB integration and community search responses.
 */

/**
 * Raw ChromaDB query response shape.
 */
export interface ChromaQueryResponse {
  ids: string[][];
  documents: (string | null)[][];
  metadatas: (Record<string, unknown> | null)[][];
  distances: number[][];
  embeddings?: number[][][];
}

/**
 * Raw ChromaDB get response shape.
 */
export interface ChromaGetResponse {
  ids: string[];
  documents: (string | null)[];
  metadatas: (Record<string, unknown> | null)[];
  embeddings?: number[][];
}

/**
 * Metadata fields stored in ChromaDB for each Discourse community.
 * All fields are ChromaDB-compliant (string, number, boolean only).
 */
export interface DiscourseMetadata {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  description: string;
  tags: string;
  categories: string;
  topics_count: number;
  posts_count: number;
  users_count: number;
  active_users_7_days: number;
  active_users_30_days: number;
  topics_30_days: number;
  engagement_tier: "high" | "medium" | "low" | "unknown";
  locale: string;
  version: string;
  is_reachable: boolean;
  image_url: string;
  indexed_at: string;
}

/**
 * Match tier classification based on semantic distance.
 */
export type MatchTier = "exact" | "semantic" | "adjacent" | "peripheral";

/**
 * Transformed community object for search responses.
 */
export interface Community {
  id: string;
  title: string;
  url: string;
  description: string;
  users_count: number;
  active_users_30_days: number;
  engagement_tier: string;
  categories: string;
  tags: string;
  confidence: number;
  distance: number;
  match_tier: MatchTier;
}

/**
 * Confidence statistics for search results.
 */
export interface ConfidenceStats {
  mean: number;
  median: number;
  min: number;
  max: number;
}

/**
 * Distribution of match tiers in results.
 */
export type TierDistribution = Record<MatchTier, number>;

/**
 * Summary statistics for search results.
 */
export interface SearchSummary {
  total_found: number;
  returned: number;
  has_more: boolean;
  confidence_stats: ConfidenceStats;
  tier_distribution: TierDistribution;
}

/**
 * Reference to the source community for nearest neighbors queries.
 */
export interface SimilarToReference {
  id: string;
  title: string;
  url: string;
}

/**
 * Full search response structure with summary stats.
 */
export interface SearchResponse {
  /** Present if text search mode was used */
  query?: string;
  /** Present if nearest neighbors mode was used */
  similar_to?: SimilarToReference;
  /** List of matching communities */
  communities: Community[];
  /** Summary statistics */
  summary: SearchSummary;
  /** Suggested next actions for the agent */
  next_actions: string[];
}
