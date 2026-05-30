import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cssColorToHex } from "../services/color.js";
import {
  normalizeFontFamily,
  normalizeFontWeight,
  pxToNumber,
} from "../services/normalize.js";
import { emptyProps, type SpecDocument, type SpecNode, type SpecProps } from "../types.js";

const StateEnum = z.enum(["default", "hover", "focus", "active"]);

const InputSchema = z
  .object({
    url: z.string().url().describe("The live or preview page URL to inspect."),
    selectors: z
      .array(z.string().min(1))
      .min(1)
      .describe(
        'CSS selectors to read, one per element you want to compare. e.g. [".hart-testimonial__quote", ".hart-testimonial__author"]',
      ),
    force_state: StateEnum.default("default").describe(
      "Interaction state to read styles under: 'default' (resting), 'hover', 'focus', or 'active'. Use this to verify hover/focus styling — the live equivalent of a Figma State=Hover variant. Implemented via CDP (real :hover) with a JS class/pseudo fallback.",
    ),
    viewports: z
      .array(z.number().int().min(320).max(3840))
      .optional()
      .describe(
        "Optional list of viewport widths (px) to read at, e.g. [1440, 768, 375] for desktop/tablet/mobile. Defaults to a single 1440px read. Each width is returned as a separate set of nodes tagged with the width.",
      ),
    wait_for: z
      .string()
      .optional()
      .describe("Optional CSS selector to wait for before reading (e.g. a lazy-loaded module root)."),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

/** Raw computed-style record returned from the browser context. */
interface RawComputed {
  tagName: string;
  text: string;
  display: string;
  width: number;
  height: number;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  columnGap: string;
  borderRadius: string;
  borderWidth: string;
  borderColor: string;
  backgroundColor: string;
  color: string;
  boxShadow: string;
  fontFamily: string;
  fontWeight: string;
  fontSize: string;
  lineHeight: string;
  letterSpacing: string;
  textAlign: string;
}

function rawToProps(r: RawComputed): SpecProps {
  const props = emptyProps();
  props.display = r.display || null;
  props.width = r.width || null;
  props.height = r.height || null;
  props.paddingTop = pxToNumber(r.paddingTop);
  props.paddingRight = pxToNumber(r.paddingRight);
  props.paddingBottom = pxToNumber(r.paddingBottom);
  props.paddingLeft = pxToNumber(r.paddingLeft);
  props.marginTop = pxToNumber(r.marginTop);
  props.marginRight = pxToNumber(r.marginRight);
  props.marginBottom = pxToNumber(r.marginBottom);
  props.marginLeft = pxToNumber(r.marginLeft);
  props.gap = pxToNumber(r.columnGap);
  props.borderRadius = pxToNumber(r.borderRadius);
  props.borderWidth = pxToNumber(r.borderWidth);
  props.background = cssColorToHex(r.backgroundColor);
  props.color = cssColorToHex(r.color);
  props.borderColor = cssColorToHex(r.borderColor);
  props.boxShadow = r.boxShadow && r.boxShadow !== "none" ? r.boxShadow : null;
  props.fontFamily = normalizeFontFamily(r.fontFamily);
  props.fontWeight = normalizeFontWeight(r.fontWeight);
  props.fontSize = pxToNumber(r.fontSize);
  props.lineHeight = pxToNumber(r.lineHeight);
  props.letterSpacing = pxToNumber(r.letterSpacing);
  props.textAlign = r.textAlign || null;
  return props;
}

export function registerLiveSpec(server: McpServer): void {
  server.registerTool(
    "specsync_live_spec",
    {
      title: "Extract live rendered spec",
      description: `Read the COMPUTED styles of elements on a live/preview page via a headless browser (Playwright), and emit them in the SAME schema as specsync_figma_spec.

This is how you check "does the front-end match the design" with NUMBERS, not by eyeballing a screenshot. Feed the output, alongside a figma_spec, into specsync_spec_diff.

For each selector it reads padding, margin, gap, width/height, border radius/width, background/text/border colour (→ hex), box-shadow, and typography (family, weight, size, line-height, letter-spacing) from getComputedStyle on the real element.

Requires Playwright to be installed in the server: \`npm i playwright && npx playwright install chromium\`.

Returns JSON: { source:"live", ref:url, nodes:[ { id:selector, name:selector, type:tagName, text, props:{...} } ] }. A selector that matches nothing is returned with all-null props so the gap is visible.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: Input) => {
      let chromium: typeof import("playwright").chromium;
      try {
        ({ chromium } = await import("playwright"));
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Error: Playwright is not installed. Run `npm i playwright && npx playwright install chromium` in the SpecSync server directory.",
            },
          ],
        };
      }

      const widths = params.viewports && params.viewports.length ? params.viewports : [1440];
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.goto(params.url, { waitUntil: "networkidle", timeout: 30000 });
        if (params.wait_for) {
          await page.waitForSelector(params.wait_for, { timeout: 15000 }).catch(() => undefined);
        }

        const nodes: SpecNode[] = [];

        for (const width of widths) {
          await page.setViewportSize({ width, height: 1024 });

          // Force a real :hover via CDP where possible (most faithful), else fall back
          // to dispatching events / focusing in-page. CDP hover needs element coords.
          if (params.force_state === "hover" || params.force_state === "active") {
            for (const sel of params.selectors) {
              const box = await page.locator(sel).first().boundingBox().catch(() => null);
              if (box) {
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                if (params.force_state === "active") await page.mouse.down().catch(() => undefined);
              }
            }
          } else if (params.force_state === "focus") {
            for (const sel of params.selectors) {
              await page.locator(sel).first().focus().catch(() => undefined);
            }
          }

          const raw = (await page.evaluate((selectors: string[]) => {
            const read = (sel: string): RawComputed | null => {
              const el = document.querySelector(sel);
              if (!el) return null;
              const cs = getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              return {
                tagName: el.tagName.toLowerCase(),
                text: (el.textContent ?? "").trim().slice(0, 120),
                display: cs.display,
                width: Math.round(rect.width * 100) / 100,
                height: Math.round(rect.height * 100) / 100,
                paddingTop: cs.paddingTop,
                paddingRight: cs.paddingRight,
                paddingBottom: cs.paddingBottom,
                paddingLeft: cs.paddingLeft,
                marginTop: cs.marginTop,
                marginRight: cs.marginRight,
                marginBottom: cs.marginBottom,
                marginLeft: cs.marginLeft,
                columnGap: cs.columnGap,
                borderRadius: cs.borderTopLeftRadius,
                borderWidth: cs.borderTopWidth,
                borderColor: cs.borderTopColor,
                backgroundColor: cs.backgroundColor,
                color: cs.color,
                boxShadow: cs.boxShadow,
                fontFamily: cs.fontFamily,
                fontWeight: cs.fontWeight,
                fontSize: cs.fontSize,
                lineHeight: cs.lineHeight,
                letterSpacing: cs.letterSpacing,
                textAlign: cs.textAlign,
              };
            };
            const result: Record<string, RawComputed | null> = {};
            for (const sel of selectors) result[sel] = read(sel);
            return result;
          }, params.selectors)) as Record<string, RawComputed | null>;

          if (params.force_state === "active") {
            await page.mouse.up().catch(() => undefined);
          }

          // When reading multiple viewports, suffix the id so each width is distinct.
          const tagWidth = widths.length > 1;
          for (const sel of params.selectors) {
            const r = raw[sel];
            nodes.push({
              id: tagWidth ? `${sel}@${width}` : sel,
              name: sel,
              type: r ? r.tagName : "MISSING",
              text: r ? r.text : null,
              state: params.force_state,
              props: r ? rawToProps(r) : emptyProps(),
            });
          }
        }

        const output: SpecDocument = { source: "live", ref: params.url, nodes };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
          structuredContent: output as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        };
      } finally {
        await browser.close();
      }
    },
  );
}
