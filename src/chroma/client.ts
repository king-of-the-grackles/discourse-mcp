/**
 * ChromaDB client singleton for querying the discourse_sites collection.
 * Requires environment variables: CHROMA_API_KEY, CHROMA_TENANT, CHROMA_DATABASE
 */

import { ChromaClient, type Collection } from "chromadb";
import { DefaultEmbeddingFunction } from "@chroma-core/default-embed";

const COLLECTION_NAME = "discourse_sites";

let clientInstance: ChromaClient | null = null;
let collectionInstance: Collection | null = null;

/**
 * Validate required environment variables are present.
 * Throws immediately if any are missing.
 */
function validateEnvVars(): { apiKey: string; tenant: string; database: string } {
  const apiKey = process.env.CHROMA_API_KEY;
  const tenant = process.env.CHROMA_TENANT;
  const database = process.env.CHROMA_DATABASE;

  const missing: string[] = [];
  if (!apiKey) missing.push("CHROMA_API_KEY");
  if (!tenant) missing.push("CHROMA_TENANT");
  if (!database) missing.push("CHROMA_DATABASE");

  if (missing.length > 0) {
    throw new Error(
      `Missing required ChromaDB environment variables: ${missing.join(", ")}. ` +
        `Set these to use the search_discourse_communities tool.`
    );
  }

  return { apiKey: apiKey!, tenant: tenant!, database: database! };
}

/**
 * Get or create the ChromaDB client instance.
 * Throws if environment variables are not configured.
 */
function getClient(): ChromaClient {
  if (clientInstance) {
    return clientInstance;
  }

  const { apiKey, tenant, database } = validateEnvVars();

  // ChromaDB v3 client API for Chroma Cloud
  clientInstance = new ChromaClient({
    host: "api.trychroma.com",
    ssl: true,
    headers: {
      "X-Chroma-Token": apiKey,
    },
    tenant,
    database,
  });

  return clientInstance;
}

/**
 * Get the discourse_sites collection from ChromaDB.
 * Lazily initializes the client and collection on first use.
 * Throws if environment variables are not configured or collection doesn't exist.
 */
export async function getChromaCollection(): Promise<Collection> {
  if (collectionInstance) {
    return collectionInstance;
  }

  const client = getClient();
  const embeddingFunction = new DefaultEmbeddingFunction();

  try {
    collectionInstance = await client.getCollection({
      name: COLLECTION_NAME,
      embeddingFunction,
    });
  } catch (error: any) {
    if (error?.message?.includes("does not exist")) {
      throw new Error(
        `ChromaDB collection '${COLLECTION_NAME}' not found. ` +
          `Ensure the collection has been created and indexed.`
      );
    }
    throw error;
  }

  return collectionInstance;
}

/**
 * Reset the client singleton (useful for testing).
 */
export function resetChromaClient(): void {
  clientInstance = null;
  collectionInstance = null;
}
