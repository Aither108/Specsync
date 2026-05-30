import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DEFAULT_TOLERANCE_PX } from "../constants.js";
import { valuesEqual } from "../services/normalize.js";
import { emptyProps, type DiffRow, type SpecNode, type SpecProps } from "../types.js";
const PropValue = z.union([z.number(), z.string(), z.null()]);
const SpecNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  text: z.string().nullable().optional(),
  state: z.string().optional(),
  props: z.record(PropValue),
});
const SpecDocLike = z.object({ nodes: z.array(SpecNodeSchema) });

const InputSchema = z
  .object({
    figma_spec: SpecDocLike.describe("Output of specsync_figma_spec (the whole object, or just its nodes wrapped in {nodes:[...]})."),
    live_spec: SpecDocLike.describe("Output of specsync_live_spec."),
    map: z
      .record(z.string())
      .describe(
        'Mapping of Figma node id → live CSS selector, e.g. { "318:7971": ".hart-testimonial__quote" }. Only mapped pairs are compared.',
      ),
    tolerance_px: z
      .number()
      .min(0)
      .default(DEFAULT_TOLERANCE_PX)
      .describe("Max px difference treated as equal for length values."),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const PROP_KEYS = Object.keys(emptyProps()) as (keyof SpecProps)[];

function indexById(nodes: SpecNode[]): Map<string, SpecNode> {
  const m = new Map<string, SpecNode>();
  for (const n of nodes) m.set(n.id, n);
  return m;
}

export function registerSpecDiff(server: McpServer): void {
  server.registerTool(
    "specsync_spec_diff",
    {
      title: "Diff Figma spec vs live spec",
      description: `Compare a Figma spec against a live spec, property by property, and return ONLY the mismatches.

This is the cross-check that replaces "looks about right" with a number. Length values are compared within tolerance_px; colours and font families are compared as normalised strings; font-weight keywords are normalised to numbers.

You provide a map of Figma node id → live CSS selector (you build this as you write the CSS — you already know which selector implements which node). Only mapped pairs are compared.

A non-empty result means the implementation does NOT match the design — it is the signal to fix and re-run, and the gate that blocks declaring work "done".

Returns JSON: { tolerance_px, pairs_checked, mismatch_count, diffs:[ { selector, figmaNodeId, property, figma, live, delta, status } ] }.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: Input) => {
      const figmaIndex = indexById(params.figma_spec.nodes as unknown as SpecNode[]);
      const liveIndex = indexById(params.live_spec.nodes as unknown as SpecNode[]);
      const diffs: DiffRow[] = [];

      for (const [figmaNodeId, selector] of Object.entries(params.map)) {
        const f = figmaIndex.get(figmaNodeId);
        const l = liveIndex.get(selector);
        const state = (f?.state ?? l?.state ?? "default") as DiffRow["state"];

        if (!f) {
          diffs.push({
            selector,
            figmaNodeId,
            state,
            property: "width",
            figma: null,
            live: null,
            delta: null,
            status: "missing_figma",
          });
          continue;
        }
        if (!l) {
          diffs.push({
            selector,
            figmaNodeId,
            state,
            property: "width",
            figma: null,
            live: null,
            delta: null,
            status: "missing_live",
          });
          continue;
        }

        for (const key of PROP_KEYS) {
          const fv = (f.props as SpecProps)[key];
          const lv = (l.props as SpecProps)[key];
          // Skip when the design simply doesn't constrain this property.
          if (fv === null) continue;
          if (valuesEqual(fv, lv, params.tolerance_px)) continue;
          diffs.push({
            selector,
            figmaNodeId,
            state,
            property: key,
            figma: fv,
            live: lv,
            delta:
              typeof fv === "number" && typeof lv === "number" ? Math.abs(fv - lv) : null,
            status: lv === null ? "missing_live" : "mismatch",
          });
        }
      }

      const output = {
        tolerance_px: params.tolerance_px,
        pairs_checked: Object.keys(params.map).length,
        mismatch_count: diffs.length,
        diffs,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
  );
}
