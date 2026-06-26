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

// Session lifecycle tuning. The previous implementation only removed a session
// when the transport emitted `onclose`; clients that simply drop the connection
// never trigger it, so the session map (and the fully-built MCP server it holds)
// grew without bound until the process hit Node's heap limit and crashed.
const SESSION_IDLE_TIMEOUT_MS = parseInt(process.env.SESSION_IDLE_TIMEOUT_MS || "600000", 10); // 10 min
const SESSION_SWEEP_INTERVAL_MS = parseInt(process.env.SESSION_SWEEP_INTERVAL_MS || "60000", 10); // 1 min
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || "500", 10);

interface Session {
  transport: StreamableHTTPServerTransport;
  server: Awaited<ReturnType<typeof createServer>>;
  lastSeen: number;
}

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

  // Track active sessions for lifecycle management.
  const sessions = new Map<string, Session>();

  // Tear down a session and release everything it holds (transport + the MCP
  // server, which owns all registered tools/prompts/resources).
  function closeSession(sessionId: string, reason: string) {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    try {
      session.transport.close();
    } catch (err) {
      console.error(`Error closing transport for ${sessionId}:`, err);
    }
    try {
      session.server.close();
    } catch (err) {
      console.error(`Error closing server for ${sessionId}:`, err);
    }
    console.log(`Session closed (${reason}): ${sessionId}`);
  }

  // Periodic sweep: evict sessions that have been idle past the timeout. This is
  // the backstop that prevents the leak when clients disconnect uncleanly.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of sessions) {
      if (now - session.lastSeen > SESSION_IDLE_TIMEOUT_MS) {
        closeSession(sessionId, "idle timeout");
      }
    }
  }, SESSION_SWEEP_INTERVAL_MS);
  // Don't keep the event loop alive just for the sweep timer.
  sweep.unref();

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

      let session = sessions.get(sessionId);

      if (!session) {
        // Backstop against unbounded growth: if we're at capacity, evict the
        // least-recently-used session before admitting a new one.
        if (sessions.size >= MAX_SESSIONS) {
          let oldestId: string | undefined;
          let oldestSeen = Infinity;
          for (const [id, s] of sessions) {
            if (s.lastSeen < oldestSeen) {
              oldestSeen = s.lastSeen;
              oldestId = id;
            }
          }
          if (oldestId) closeSession(oldestId, "max sessions reached");
        }

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
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId,
          onsessioninitialized: (id) => {
            console.log(`Session initialized: ${id}`);
          },
        });

        session = { transport, server: mcpServer, lastSeen: Date.now() };
        sessions.set(sessionId, session);

        // Connect server to transport
        await mcpServer.connect(transport);

        // Clean up when the transport itself reports closure.
        transport.onclose = () => {
          if (sessions.get(sessionId)?.transport === transport) {
            closeSession(sessionId, "transport closed");
          }
        };
      }

      // Mark activity so the idle sweep doesn't reap a session that's in use.
      session.lastSeen = Date.now();

      // Handle the request
      await session.transport.handleRequest(req, res);
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
