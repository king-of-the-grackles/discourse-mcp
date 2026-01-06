#!/usr/bin/env node
/**
 * Smithery HTTP Entry Point
 *
 * This file is the entry point for Smithery container deployments.
 * It imports the createServer function and wraps it with an HTTP transport.
 */
import { createServer as createHttpServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import createServer, { type SmitheryConfig } from "./index.js";

const PORT = parseInt(process.env.PORT || "8080", 10);

// Parse config from environment or use defaults
function getConfig(): SmitheryConfig {
  // Smithery passes config via environment variables or query params
  // For now, create a minimal config that allows the server to start
  return {
    site: process.env.DISCOURSE_SITE || undefined,
    api_key: process.env.DISCOURSE_API_KEY || undefined,
    api_username: process.env.DISCOURSE_API_USERNAME || undefined,
    user_api_key: process.env.DISCOURSE_USER_API_KEY || undefined,
    user_api_client_id: process.env.DISCOURSE_USER_API_CLIENT_ID || undefined,
    read_only: process.env.DISCOURSE_READ_ONLY !== "false",
    allow_writes: process.env.DISCOURSE_ALLOW_WRITES === "true",
    tools_mode: (process.env.DISCOURSE_TOOLS_MODE as any) || "auto",
    default_search: process.env.DISCOURSE_DEFAULT_SEARCH || undefined,
    max_read_length: parseInt(process.env.DISCOURSE_MAX_READ_LENGTH || "50000", 10),
    log_level: (process.env.DISCOURSE_LOG_LEVEL as any) || "info",
  };
}

async function main() {
  console.log(`Starting Discourse MCP HTTP server on port ${PORT}...`);

  // Track active transports for session management
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);

    // Health check endpoint
    if (url.pathname === "/health" || url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "discourse-mcp" }));
      return;
    }

    // MCP endpoint
    if (url.pathname === "/mcp") {
      // Get session ID from header or generate new one
      const sessionId = req.headers["mcp-session-id"] as string || crypto.randomUUID();

      let transport = transports.get(sessionId);

      if (!transport) {
        // Parse config from query params or use environment defaults
        const config: SmitheryConfig = {
          site: url.searchParams.get("site") || process.env.DISCOURSE_SITE || undefined,
          api_key: url.searchParams.get("api_key") || process.env.DISCOURSE_API_KEY || undefined,
          api_username: url.searchParams.get("api_username") || process.env.DISCOURSE_API_USERNAME || undefined,
          user_api_key: url.searchParams.get("user_api_key") || process.env.DISCOURSE_USER_API_KEY || undefined,
          user_api_client_id: url.searchParams.get("user_api_client_id") || process.env.DISCOURSE_USER_API_CLIENT_ID || undefined,
          read_only: url.searchParams.get("read_only") !== "false",
          allow_writes: url.searchParams.get("allow_writes") === "true",
          tools_mode: (url.searchParams.get("tools_mode") as any) || "auto",
          default_search: url.searchParams.get("default_search") || undefined,
          max_read_length: parseInt(url.searchParams.get("max_read_length") || "50000", 10),
          log_level: (url.searchParams.get("log_level") as any) || "info",
        };

        // Create MCP server with config
        const mcpServer = createServer({ config });

        // Create transport
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId,
          onsessioninitialized: (id) => {
            console.log(`Session initialized: ${id}`);
          },
        });

        transports.set(sessionId, transport);

        // Connect server to transport
        await mcpServer.connect(transport);

        // Clean up on close
        transport.onclose = () => {
          transports.delete(sessionId);
          console.log(`Session closed: ${sessionId}`);
        };
      }

      // Handle the request
      await transport.handleRequest(req, res);
      return;
    }

    // 404 for other paths
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(PORT, () => {
    console.log(`Discourse MCP server listening on http://0.0.0.0:${PORT}`);
    console.log(`MCP endpoint: http://0.0.0.0:${PORT}/mcp`);
    console.log(`Health check: http://0.0.0.0:${PORT}/health`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
