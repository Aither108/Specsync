#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { registerFigmaSpec } from "./tools/figmaSpec.js";
import { registerLiveSpec } from "./tools/liveSpec.js";
import { registerSpecDiff } from "./tools/specDiff.js";
import { registerVerifyUpload } from "./tools/verifyUpload.js";
import { registerSyncTokens } from "./tools/syncTokens.js";
import { registerTokenCoverage } from "./tools/tokenCoverage.js";

async function main(): Promise<void> {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerFigmaSpec(server);
  registerLiveSpec(server);
  registerSpecDiff(server);
  registerVerifyUpload(server);
  registerSyncTokens(server);
  registerTokenCoverage(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only — stdout is the MCP transport channel.
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
