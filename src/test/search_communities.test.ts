import test from "node:test";
import assert from "node:assert/strict";
import { Logger } from "../util/logger.js";
import { SiteState } from "../site/state.js";
import { registerAllTools } from "../tools/registry.js";

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

  await t.test("returns error when CHROMA_PROXY_API_KEY is missing", async () => {
    // Ensure API key is not set
    const originalApiKey = process.env.CHROMA_PROXY_API_KEY;
    delete process.env.CHROMA_PROXY_API_KEY;

    try {
      const result = await handler({ query: "test" }, {});
      assert.ok(result.isError, "Should return error");
      assert.match(
        result.content[0].text,
        /CHROMA_PROXY_API_KEY/i,
        "Error message should mention missing API key"
      );
    } finally {
      // Restore env var
      if (originalApiKey) process.env.CHROMA_PROXY_API_KEY = originalApiKey;
    }
  });
});
