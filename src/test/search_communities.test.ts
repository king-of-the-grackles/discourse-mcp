import test from "node:test";
import assert from "node:assert/strict";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import { registerAllTools } from "../tools/registry.js";
import { resetChromaClient } from "../chroma/client.js";

// Reset ChromaDB client between tests
test.beforeEach(() => {
  resetChromaClient();
});

test("search_discourse_communities tool registration", async (t) => {
  await t.test("registers the tool", async () => {
    const logger = new Logger("silent");
    const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: "none" } });

    const tools: Record<string, { handler: Function }> = {};
    const fakeServer: any = {
      registerTool(name: string, _meta: any, handler: Function) {
        tools[name] = { handler };
      },
    };

    await registerAllTools(fakeServer, siteState, logger, {
      allowWrites: false,
      toolsMode: "discourse_api_only",
    } as any);

    assert.ok("search_discourse_communities" in tools, "Tool should be registered");
  });
});

test("search_discourse_communities validation", async (t) => {
  const logger = new Logger("silent");
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: "none" } });

  const tools: Record<string, { handler: Function }> = {};
  const fakeServer: any = {
    registerTool(name: string, _meta: any, handler: Function) {
      tools[name] = { handler };
    },
  };

  await registerAllTools(fakeServer, siteState, logger, {
    allowWrites: false,
    toolsMode: "discourse_api_only",
  } as any);

  const handler = tools["search_discourse_communities"].handler;

  await t.test("returns error when neither query nor similar_to provided", async () => {
    const result = await handler({}, {});
    assert.ok(result.isError, "Should return error");
    assert.match(
      result.content[0].text,
      /exactly one of/i,
      "Error message should mention validation"
    );
  });

  await t.test("returns error when both query and similar_to provided", async () => {
    const result = await handler({ query: "test", similar_to: "https://example.com" }, {});
    assert.ok(result.isError, "Should return error");
    assert.match(
      result.content[0].text,
      /exactly one of/i,
      "Error message should mention validation"
    );
  });
});

test("search_discourse_communities env var validation", async (t) => {
  const logger = new Logger("silent");
  const siteState = new SiteState({ logger, timeoutMs: 5000, defaultAuth: { type: "none" } });

  const tools: Record<string, { handler: Function }> = {};
  const fakeServer: any = {
    registerTool(name: string, _meta: any, handler: Function) {
      tools[name] = { handler };
    },
  };

  await registerAllTools(fakeServer, siteState, logger, {
    allowWrites: false,
    toolsMode: "discourse_api_only",
  } as any);

  const handler = tools["search_discourse_communities"].handler;

  await t.test("returns error when CHROMA env vars are missing", async () => {
    // Ensure env vars are not set
    const originalApiKey = process.env.CHROMA_API_KEY;
    const originalTenant = process.env.CHROMA_TENANT;
    const originalDatabase = process.env.CHROMA_DATABASE;

    delete process.env.CHROMA_API_KEY;
    delete process.env.CHROMA_TENANT;
    delete process.env.CHROMA_DATABASE;

    try {
      resetChromaClient(); // Reset to pick up missing env vars
      const result = await handler({ query: "test" }, {});
      assert.ok(result.isError, "Should return error");
      assert.match(
        result.content[0].text,
        /CHROMA/i,
        "Error message should mention missing ChromaDB config"
      );
    } finally {
      // Restore env vars
      if (originalApiKey) process.env.CHROMA_API_KEY = originalApiKey;
      if (originalTenant) process.env.CHROMA_TENANT = originalTenant;
      if (originalDatabase) process.env.CHROMA_DATABASE = originalDatabase;
    }
  });
});
