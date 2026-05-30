import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchFigmaSpec, findUntokenized, parseFigmaRef } from "../services/figma.js";
import type { TokenCoverageReport } from "../types.js";

const InputSchema = z
  .object({
    figma: z.string().min(1).describe("Figma file key or a full Figma URL (node-id read from the URL if present)."),
    node_id: z.string().optional().describe('Figma node id, e.g. "318:7971". Required if not in the URL.'),
    variables: z
      .record(z.string())
      .describe(
        'The variable map for this node, i.e. the output of the Figma get_variable_defs tool, e.g. { "Primary/Hart Red": "#E30613" }. SpecSync cannot call that tool itself, so pass its result here.',
      ),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

export function registerTokenCoverage(server: McpServer): void {
  server.registerTool(
    "specsync_token_coverage",
    {
      title: "Report Figma tokenisation coverage",
      description: `Find which concrete values a design uses that are NOT bound to a Figma variable — i.e. the values that will drift and are candidates to variable-ize.

Walks the node tree (same extraction as figma_spec), then cross-references each colour / spacing / type value against the variable map you provide. Values not covered by any variable are reported as "untokenized", deduplicated.

Because the Figma variable-definitions tool lives in your design MCP (not in SpecSync), pass its output via the 'variables' parameter — call get_variable_defs on the node first, then hand the result here.

Use this to decide whether a token pipeline will pay off: lots of untokenized spacing/type means the design should be variable-ized in Figma before sync_tokens is worthwhile; until then, rely on figma_spec + spec_diff for those properties.

Returns JSON: { ref, variables, untokenized:[ { nodeId, nodeName, property, value } ], summary:{ variable_count, untokenized_count } }.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: Input) => {
      const token = process.env.FIGMA_TOKEN;
      if (!token) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Error: FIGMA_TOKEN is not set." }],
        };
      }

      const { fileKey, nodeId } = parseFigmaRef(params.figma, params.node_id);
      if (!nodeId) {
        return {
          isError: true,
          content: [
            { type: "text" as const, text: 'Error: no node id. Pass node_id (e.g. "318:7971") or a URL with ?node-id=...' },
          ],
        };
      }

      try {
        const nodes = await fetchFigmaSpec(fileKey, nodeId, token);
        const untokenized = findUntokenized(nodes, params.variables);
        const report: TokenCoverageReport = {
          ref: `${fileKey}#${nodeId}`,
          variables: params.variables,
          untokenized,
          summary: {
            variable_count: Object.keys(params.variables).length,
            untokenized_count: untokenized.length,
          },
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }],
          structuredContent: report as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        };
      }
    },
  );
}
