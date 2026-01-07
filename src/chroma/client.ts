/**
 * ChromaDB proxy client for querying the discourse_sites collection.
 * Uses the reddit-mcp-vector-db proxy server which handles embeddings server-side.
 *
 * Requires environment variable: CHROMA_PROXY_API_KEY
 * Optional: CHROMA_PROXY_URL (defaults to https://reddit-mcp-vector-db.onrender.com)
 */

const PROXY_URL =
  process.env.CHROMA_PROXY_URL || "https://reddit-mcp-vector-db.onrender.com";
const COLLECTION_NAME = "discourse_sites";

/**
 * Response type from ChromaDB proxy /query endpoint
 */
export interface ChromaQueryResponse {
  ids: string[][];
  embeddings: (number[] | null)[][] | null;
  documents: (string | null)[][] | null;
  uris: null;
  data: null;
  metadatas: (Record<string, unknown> | null)[][];
  distances: (number | null)[][] | null;
  included: string[];
}

/**
 * Response type from ChromaDB proxy /get endpoint
 */
export interface ChromaGetResponse {
  ids: string[];
  embeddings: (number[] | null)[] | null;
  documents: (string | null)[] | null;
  uris: null;
  data: null;
  metadatas: (Record<string, unknown> | null)[];
  included: string[];
}

/**
 * Include options for ChromaDB queries
 */
type IncludeOption = "embeddings" | "metadatas" | "documents";

/**
 * Get the API key, throwing if not configured.
 */
function getApiKey(): string {
  const apiKey = process.env.CHROMA_PROXY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing CHROMA_PROXY_API_KEY environment variable. " +
        "Set this to use the search_discourse_communities tool."
    );
  }
  return apiKey;
}

/**
 * Query the collection via the proxy server using text queries.
 * The proxy handles embeddings server-side.
 *
 * @param queryTexts - Array of query strings for semantic search
 * @param nResults - Maximum number of results to return (default: 10)
 * @param where - Optional metadata filter clause
 * @returns ChromaDB query response with ids, metadatas, and distances
 */
export async function queryByText(
  queryTexts: string[],
  nResults: number = 10,
  where?: Record<string, unknown>
): Promise<ChromaQueryResponse> {
  const response = await fetch(`${PROXY_URL}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": getApiKey(),
    },
    body: JSON.stringify({
      query_texts: queryTexts,
      n_results: nResults,
      where,
      collection_name: COLLECTION_NAME,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ChromaDB proxy error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Query the collection via the proxy server using embedding vectors.
 * Used for nearest-neighbor queries (e.g., find similar communities).
 *
 * @param queryEmbeddings - Array of embedding vectors
 * @param nResults - Maximum number of results to return (default: 10)
 * @param where - Optional metadata filter clause
 * @returns ChromaDB query response with ids, metadatas, and distances
 */
export async function queryByEmbedding(
  queryEmbeddings: number[][],
  nResults: number = 10,
  where?: Record<string, unknown>
): Promise<ChromaQueryResponse> {
  const response = await fetch(`${PROXY_URL}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": getApiKey(),
    },
    body: JSON.stringify({
      query_embeddings: queryEmbeddings,
      n_results: nResults,
      where,
      collection_name: COLLECTION_NAME,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ChromaDB proxy error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Get documents by ID from the collection.
 *
 * @param ids - Array of document IDs to retrieve
 * @param include - What to include in the response
 * @returns ChromaDB get response with ids, metadatas, and optionally embeddings
 */
export async function getByIds(
  ids: string[],
  include: IncludeOption[] = ["metadatas"]
): Promise<ChromaGetResponse> {
  const response = await fetch(`${PROXY_URL}/get`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": getApiKey(),
    },
    body: JSON.stringify({
      ids,
      include,
      collection_name: COLLECTION_NAME,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ChromaDB proxy error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Get documents by metadata filter from the collection.
 *
 * @param where - Metadata filter clause (e.g., { url: "https://example.com" })
 * @param include - What to include in the response
 * @returns ChromaDB get response with ids, metadatas, and optionally embeddings
 */
export async function getByMetadata(
  where: Record<string, unknown>,
  include: IncludeOption[] = ["metadatas"]
): Promise<ChromaGetResponse> {
  const response = await fetch(`${PROXY_URL}/get`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": getApiKey(),
    },
    body: JSON.stringify({
      where,
      include,
      collection_name: COLLECTION_NAME,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ChromaDB proxy error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Check if the proxy is available and healthy.
 */
export async function checkProxyHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${PROXY_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}
