import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFile } from "node:fs/promises";
import { FIGMA_API_BASE } from "../constants.js";
import { figmaColorToHex } from "../services/color.js";
import { parseFigmaRef } from "../services/figma.js";

const InputSchema = z
  .object({
    figma: z.string().min(1).describe("Figma file key or any URL for the file whose variables to export."),
    output_path: z
      .string()
      .optional()
      .describe("Optional path to write the generated tokens.css. If omitted, the CSS is only returned."),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

interface FigmaAlias {
  type: "VARIABLE_ALIAS";
  id: string;
}
interface FigmaVariable {
  id: string;
  name: string;
  resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
  variableCollectionId: string;
  valuesByMode: Record<string, unknown>;
}
interface FigmaCollection {
  id: string;
  name: string;
  defaultModeId: string;
}

function cssVarName(name: string): string {
  return (
    "--" +
    name
      .trim()
      .toLowerCase()
      .replace(/[\s/]+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
  );
}

function isAlias(v: unknown): v is FigmaAlias {
  return typeof v === "object" && v !== null && (v as { type?: string }).type === "VARIABLE_ALIAS";
}

export function registerSyncTokens(server: McpServer): void {
  server.registerTool(
    "specsync_sync_tokens",
    {
      title: "Sync Figma variables to tokens.css",
      description: `Pull a file's Figma Variables and generate a tokens.css of CSS custom properties, so the theme and the design read spacing/colour/type from ONE source — the root fix for drift.

COLOR variables become hex; FLOAT become raw numbers (add units in your theme as appropriate); aliases become var(--other-token) references. Uses each collection's default mode.

Requires FIGMA_TOKEN, and the Figma Variables REST API requires an Enterprise plan + a token with file_variables:read scope — on lower plans this returns a clear "not available" message rather than failing silently.

If output_path is given the CSS is written there; the CSS is always returned in the response.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: false,
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

      const { fileKey } = parseFigmaRef(params.figma);
      const url = `${FIGMA_API_BASE}/files/${fileKey}/variables/local`;
      const res = await fetch(url, { headers: { "X-Figma-Token": token } });

      if (res.status === 403) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Figma Variables API returned 403. This endpoint needs an Enterprise plan and a token with file_variables:read scope. If you are not on Enterprise, define tokens manually in tokens.css instead — the other SpecSync tools still work.",
            },
          ],
        };
      }
      if (!res.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Figma API error ${res.status}: ${await res.text()}` }],
        };
      }

      const data = (await res.json()) as {
        meta?: {
          variables?: Record<string, FigmaVariable>;
          variableCollections?: Record<string, FigmaCollection>;
        };
      };
      const variables = data.meta?.variables ?? {};
      const collections = data.meta?.variableCollections ?? {};
      const nameById = new Map<string, string>();
      for (const v of Object.values(variables)) nameById.set(v.id, v.name);

      const lines: string[] = [];
      for (const v of Object.values(variables)) {
        const collection = collections[v.variableCollectionId];
        const modeId = collection?.defaultModeId;
        const raw = modeId ? v.valuesByMode[modeId] : undefined;
        if (raw === undefined) continue;

        let value: string;
        if (isAlias(raw)) {
          const target = nameById.get(raw.id);
          value = target ? `var(${cssVarName(target)})` : "/* unresolved alias */";
        } else if (v.resolvedType === "COLOR") {
          value = figmaColorToHex(raw as { r: number; g: number; b: number; a?: number }) ?? "transparent";
        } else if (v.resolvedType === "FLOAT") {
          value = String(raw);
        } else {
          value = String(raw);
        }
        lines.push(`  ${cssVarName(v.name)}: ${value};`);
      }

      const css = `:root {\n${lines.sort().join("\n")}\n}\n`;

      if (params.output_path) {
        await writeFile(params.output_path, css, "utf8");
      }

      const output = {
        file_key: fileKey,
        variable_count: lines.length,
        written_to: params.output_path ?? null,
        css,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
  );
}
