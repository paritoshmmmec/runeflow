#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const server = new McpServer({
  name: "runeflow-test-mcp",
  version: "1.0.0",
});

server.registerTool(
  "search",
  {
    description: "Search test docs",
    inputSchema: {
      query: z.string().min(1),
    },
  },
  async ({ query }) => ({
    content: [
      {
        type: "text",
        text: `match:${query}`,
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
