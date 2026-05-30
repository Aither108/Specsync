import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";

// Zod mirror of InteractionSpec (src/interactionTypes.ts). Lenient on enums
// (passthrough strings) so a newer Figma trigger/action doesn't hard-fail load.
const Transition = z.object({
  type: z.string().nullable(),
  duration: z.number().nullable(),
  easing: z.string().nullable(),
});
const Interaction = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  trigger: z.string(),
  delay: z.number().nullable(),
  action: z.string(),
  destinationId: z.string().nullable(),
  destinationName: z.string().nullable(),
  url: z.string().nullable(),
  transition: Transition,
  implHint: z.string(),
});
const FlowStep = z.object({
  fromNodeId: z.string(),
  fromName: z.string(),
  trigger: z.string(),
  action: z.string(),
  toNodeId: z.string().nullable(),
  toName: z.string().nullable(),
});
const Flow = z.object({
  name: z.string(),
  startNodeId: z.string(),
  startName: z.string(),
  steps: z.array(FlowStep),
});
const ComponentSpec = z.object({
  id: z.string(),
  name: z.string(),
  propertyDefinitions: z.record(z.object({ type: z.string(), options: z.array(z.string()).optional() })),
  variants: z.array(
    z.object({ nodeId: z.string(), name: z.string(), properties: z.record(z.string()) }),
  ),
});
const InteractionSpecSchema = z.object({
  source: z.string(),
  fileKey: z.string(),
  scope: z.string(),
  generatedAt: z.string(),
  interactions: z.array(Interaction),
  flows: z.array(Flow),
  components: z.array(ComponentSpec),
});

const InputSchema = z
  .object({
    json: z
      .string()
      .optional()
      .describe("The interaction-spec JSON produced by the SpecSync Interactions Figma plugin (paste the Copy-JSON output here)."),
    path: z
      .string()
      .optional()
      .describe("Alternatively, a file path to a saved interaction-spec.json (e.g. the bridge output at ./interaction-spec.json)."),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

export function registerFigmaInteractions(server: McpServer): void {
  server.registerTool(
    "specsync_figma_interactions",
    {
      title: "Load Figma interaction / prototype spec",
      description: `Load the BEHAVIOURAL spec a design encodes — prototype interactions, flows, and component variant matrices — captured by the SpecSync Interactions Figma plugin.

Use this alongside specsync_figma_spec: figma_spec gives you appearance (the static property tree); figma_interactions gives you behaviour the REST API can't fully see — what is clickable, where it navigates, what opens an overlay, what the prototype flow is, and the full variant matrix of a component.

Why a plugin and not the REST API: the Figma Plugin API exposes node.reactions, currentPage.flowStartingPoints and componentPropertyDefinitions completely and on any plan; the REST API's prototype coverage is partial. So you run the plugin (Extract → Copy JSON) and pass its output here via the 'json' param, or point 'path' at a saved/bridged interaction-spec.json.

Each interaction carries an implHint to guide implementation:
  - anchor-link    → render an <a href> to the destination page
  - external-link  → <a href> to the URL (consider target/rel)
  - js-overlay     → a JS modal/dropdown/tooltip opened on the trigger
  - js-swap        → swap the open overlay's contents
  - scroll-anchor  → smooth-scroll to an in-page anchor
  - js-variant-change / js-state-toggle → JS that changes a component's state
  - js-history-back / js-close-overlay → history/overlay controls

IMPORTANT — verification scope: capturing behaviour is exact, but you cannot numerically diff it the way spec_diff diffs styles. After implementing, the checkable parts (does a click navigate to the specified URL, does the overlay element appear) can be confirmed with the browser; transition timing/easing remain a human review. Do not claim behavioural parity beyond what was actually checked.

Returns the validated spec plus a per-interaction implementation checklist.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: Input) => {
      let rawText: string;
      try {
        if (params.json) {
          rawText = params.json;
        } else if (params.path) {
          rawText = await readFile(params.path, "utf8");
        } else {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "Error: provide either `json` (paste the plugin's Copy-JSON output) or `path` (a saved interaction-spec.json).",
              },
            ],
          };
        }
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Error reading spec: ${(err as Error).message}` }],
        };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Error: input is not valid JSON. Re-run the plugin's Extract and Copy JSON." }],
        };
      }

      const result = InteractionSpecSchema.safeParse(parsed);
      if (!result.success) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error: JSON does not match the interaction-spec shape. ${result.error.issues
                .slice(0, 5)
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("; ")}`,
            },
          ],
        };
      }

      const spec = result.data;
      const checklist = spec.interactions.map((i) => ({
        node: i.nodeName,
        do: `${i.trigger} → ${i.action}${i.url ? ` (${i.url})` : i.destinationName ? ` → ${i.destinationName}` : ""}`,
        implement_as: i.implHint,
        verifiable: ["anchor-link", "external-link", "scroll-anchor"].includes(i.implHint)
          ? "browser: assert link target / scroll"
          : ["js-overlay", "js-swap"].includes(i.implHint)
            ? "browser: assert element appears on trigger"
            : "manual review",
      }));

      const output = {
        ...spec,
        summary: {
          interactions: spec.interactions.length,
          flows: spec.flows.length,
          components: spec.components.length,
        },
        implementation_checklist: checklist,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    },
  );
}
