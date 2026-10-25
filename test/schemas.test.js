// Tool input schemas, exercised through the real MCP SDK (tools/list and
// tools/call over an in-memory transport), so a zod upgrade that breaks how the
// SDK reads or validates them fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildTools } from "../src/tools.js";

const require = createRequire(import.meta.url);

async function connect() {
  const calls = [];
  const client = {
    get: async (path) => (calls.push(["GET", path]), { ok: true }),
    post: async (path, body) => (calls.push(["POST", path, body]), { ok: true }),
    put: async (path, body) => (calls.push(["PUT", path, body]), { ok: true }),
    delete: async (path) => (calls.push(["DELETE", path]), { ok: true }),
    request: async (method, path, body) => (calls.push([method, path, body]), { ok: true }),
  };
  const server = new McpServer({ name: "krayin-mcp-test", version: "0.0.0" });
  const tools = buildTools(client);
  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.schema, async (args) => {
      const result = await tool.handler(args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    });
  }
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  return { mcp, calls, tools };
}

test("zod is at or above the 4.6.6 security floor (GHSA-mrhx-c7xc-m3w5)", () => {
  const { version } = require("zod/package.json");
  const [maj, min, pat] = version.split(".").map((n) => parseInt(n, 10));
  assert.ok(maj > 4 || (maj === 4 && (min > 6 || (min === 6 && pat >= 6))), `zod@${version}`);
});

test("tools/list returns every tool with an object input schema", async () => {
  const { mcp, tools } = await connect();
  const { tools: listed } = await mcp.listTools();
  assert.equal(listed.length, tools.length);
  for (const t of listed) assert.equal(t.inputSchema.type, "object", t.name);
  const tag = listed.find((t) => t.name === "krayin_tag_lead");
  assert.equal(tag.inputSchema.properties.tag.type, "object");
  assert.deepEqual(tag.inputSchema.required.sort(), ["id", "tag"]);
});

test("tools/call validates record fields and applies defaults", async () => {
  const { mcp, calls } = await connect();
  const ok = await mcp.callTool({ name: "krayin_tag_lead", arguments: { id: 4, tag: { name: "adjuster-friendly" } } });
  assert.ok(!ok.isError, JSON.stringify(ok));
  assert.deepEqual(calls.at(-1)[2], { name: "adjuster-friendly" });

  await mcp.callTool({
    name: "krayin_create_person",
    arguments: { name: "Sample Person", emails: [{ value: "a@example.com" }], extra: { source: "test" } },
  });
  const body = calls.at(-1)[2];
  assert.deepEqual(body.emails, [{ value: "a@example.com", label: "work" }]);
});

test("tools/call rejects wrong types", async () => {
  const { mcp, calls } = await connect();
  const before = calls.length;
  const bad = await mcp
    .callTool({ name: "krayin_tag_lead", arguments: { id: "4", tag: "not-an-object" } })
    .catch((err) => ({ isError: true, err }));
  assert.equal(bad.isError, true);
  assert.equal(calls.length, before, "handler must not run on invalid input");
});
