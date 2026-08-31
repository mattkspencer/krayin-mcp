#!/usr/bin/env node
// krayin-mcp: MCP stdio server exposing a Krayin CRM to AI agents.
// Config via env: KRAYIN_URL (required), then either KRAYIN_TOKEN or
// KRAYIN_EMAIL + KRAYIN_PASSWORD.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { KrayinClient } from "./client.js";
import { buildTools } from "./tools.js";

const client = new KrayinClient({});
const server = new McpServer({ name: "krayin-mcp", version: "0.1.0" });

for (const tool of buildTools(client)) {
  server.tool(tool.name, tool.description, tool.schema, async (args) => {
    try {
      const result = await tool.handler(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${err.message}` }],
      };
    }
  });
}

const transport = new StdioServerTransport();
await server.connect(transport);
