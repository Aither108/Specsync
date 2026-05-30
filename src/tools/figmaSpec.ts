import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchFigmaSpec, parseFigmaRef } from "../services/figma.js";
import type { SpecDocument } from "../types.js";

const InputSchema = z
  .object({
    figma: z
      .string()
      .min(1)
      .describe(
        "A Figma file key, or a full Figma URL (e.g. https://www.figma.com/design/<key>/Name?node-id=318-7971). If the URL contains node-id, node_id is optional.",
      ),
    node_id: z
      .string()
      .optional()
      .describe('Figma node id, e.g. "318:7971" or "318-7971". Required if not present in the URL.'),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

export function registerFigmaSpec(server: McpServer): void {
  server.registerTool(
    "specsync_figma_spec",
    {
      title: "Extract Figma design spec",
      description: `Extract the COMPLETE property tree of a Figma node and every descendant via the Figma REST API.

Use this BEFORE writing any CSS/HubL. It is the design source of truth — values come from the file, never from a screenshot or from numbers typed in the prompt.

Walks the node's full children[] recursively. For each node it returns layout (padding, gap, width/height, layoutMode), box (border radius/width), colour (background, text colour, border colour, shadow → hex), and typography (family, weight, size, line-height px, letter-spacing). Any property a node does not define is returned as null (never omitted) so "missing" is visible.

Requires the FIGMA_TOKEN environment variable (a Figma personal access token with file read access).

Returns JSON: { source:"figma", ref, nodes:[ { id, name, type, text, props:{...} } ] }.

Examples:
  - "Pull the testimonial section" → figma=<url with node-id>
  - "Get node 318:7971 from file abc" → figma="abc", node_id="318:7971"`,
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
          content: [
            {
              type: "text" as const,
              text: "Error: FIGMA_TOKEN is not set. Add a Figma personal access token to the server environment (see .env.example).",
            },
          ],
        };
      }

      const { fileKey, nodeId } = parseFigmaRef(params.figma, params.node_id);
      if (!nodeId) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: 'Error: no node id found. Pass node_id (e.g. "318:7971") or use a URL containing ?node-id=...',
            },
          ],
        };
      }

      try {
        const nodes = await fetchFigmaSpec(fileKey, nodeId, token);
        const output: SpecDocument = {
          source: "figma",
          ref: `${fileKey}#${nodeId}`,
          nodes,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
          structuredContent: output as unknown as Record<string, unknown>,
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
