import { FIGMA_API_BASE, MAX_NODES } from "../constants.js";
import { figmaColorToHex } from "./color.js";
import { emptyProps, type SpecNode, type SpecProps, type SpecState } from "../types.js";

/**
 * Derive an interaction state from a Figma layer/variant name.
 * Figma component variants are named like "State=Hover" or "State=Focused",
 * and they sit as SIBLINGS of the default — which is why a plain children walk
 * misses them unless we explicitly detect and label them.
 */
export function stateFromName(name: string): SpecState | null {
  const m = name.match(/state\s*=\s*([a-z]+)/i);
  const raw = (m ? m[1] : name).toLowerCase();
  if (/hover/.test(raw)) return "hover";
  if (/focus/.test(raw)) return "focus";
  if (/(press|active)/.test(raw)) return "active";
  if (/disable/.test(raw)) return "disabled";
  return null;
}

/** Minimal shape of the Figma node fields SpecSync reads. Everything optional. */
interface FigmaPaint {
  type?: string;
  visible?: boolean;
  opacity?: number;
  color?: { r: number; g: number; b: number; a?: number };
}
interface FigmaEffect {
  type?: string;
  visible?: boolean;
  radius?: number;
  offset?: { x: number; y: number };
  spread?: number;
  color?: { r: number; g: number; b: number; a?: number };
}
interface FigmaTypeStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  lineHeightUnit?: string;
  letterSpacing?: number;
  textAlignHorizontal?: string;
}
interface FigmaNode {
  id: string;
  name: string;
  type: string;
  characters?: string;
  layoutMode?: string;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  itemSpacing?: number;
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  strokeWeight?: number;
  absoluteBoundingBox?: { width: number; height: number } | null;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  effects?: FigmaEffect[];
  style?: FigmaTypeStyle;
  children?: FigmaNode[];
}

export interface ParsedFigmaRef {
  fileKey: string;
  nodeId: string | null;
}

/**
 * Accepts a raw file key, a node id, or a full Figma URL like
 * https://www.figma.com/design/<key>/Name?node-id=318-7971 and returns
 * the file key plus node id (node id normalised from "318-7971" to "318:7971").
 */
export function parseFigmaRef(input: string, explicitNodeId?: string): ParsedFigmaRef {
  let fileKey = input;
  let nodeId: string | null = explicitNodeId ?? null;

  const urlMatch = input.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
  if (urlMatch) {
    fileKey = urlMatch[1];
    const nodeMatch = input.match(/[?&]node-id=([^&]+)/);
    if (nodeMatch && !nodeId) nodeId = decodeURIComponent(nodeMatch[1]);
  }
  if (nodeId) nodeId = nodeId.replace(/-/g, ":");
  return { fileKey, nodeId };
}

function firstVisibleSolid(paints: FigmaPaint[] | undefined): FigmaPaint | null {
  if (!paints) return null;
  for (const p of paints) {
    if (p.visible === false) continue;
    if (p.type === "SOLID" && p.color) return p;
  }
  return null;
}

function effectToShadow(effects: FigmaEffect[] | undefined): string | null {
  if (!effects) return null;
  const e = effects.find(
    (x) => x.visible !== false && (x.type === "DROP_SHADOW" || x.type === "INNER_SHADOW"),
  );
  if (!e || !e.offset) return null;
  const hex = figmaColorToHex(e.color);
  const inset = e.type === "INNER_SHADOW" ? "inset " : "";
  return `${inset}${e.offset.x}px ${e.offset.y}px ${e.radius ?? 0}px ${e.spread ?? 0}px ${hex ?? ""}`.trim();
}

/** Map a single Figma node to SpecProps (no recursion). */
function nodeToProps(node: FigmaNode): SpecProps {
  const props = emptyProps();

  if (node.absoluteBoundingBox) {
    props.width = node.absoluteBoundingBox.width;
    props.height = node.absoluteBoundingBox.height;
  }
  if (node.layoutMode) props.layoutMode = node.layoutMode;
  if (node.paddingTop !== undefined) props.paddingTop = node.paddingTop;
  if (node.paddingRight !== undefined) props.paddingRight = node.paddingRight;
  if (node.paddingBottom !== undefined) props.paddingBottom = node.paddingBottom;
  if (node.paddingLeft !== undefined) props.paddingLeft = node.paddingLeft;
  if (node.itemSpacing !== undefined) props.gap = node.itemSpacing;

  if (node.cornerRadius !== undefined) props.borderRadius = node.cornerRadius;
  else if (node.rectangleCornerRadii && node.rectangleCornerRadii.length)
    props.borderRadius = node.rectangleCornerRadii[0];

  if (node.strokeWeight !== undefined) props.borderWidth = node.strokeWeight;

  const fill = firstVisibleSolid(node.fills);
  const stroke = firstVisibleSolid(node.strokes);

  if (node.type === "TEXT") {
    props.color = fill ? figmaColorToHex(fill.color, fill.opacity) : null;
  } else {
    props.background = fill ? figmaColorToHex(fill.color, fill.opacity) : null;
  }
  props.borderColor = stroke ? figmaColorToHex(stroke.color, stroke.opacity) : null;
  props.boxShadow = effectToShadow(node.effects);

  if (node.style) {
    props.fontFamily = node.style.fontFamily ?? null;
    props.fontWeight = node.style.fontWeight ?? null;
    props.fontSize = node.style.fontSize ?? null;
    props.lineHeight =
      node.style.lineHeightUnit === "INTRINSIC_PERCENT" ? null : (node.style.lineHeightPx ?? null);
    props.letterSpacing = node.style.letterSpacing ?? null;
    props.textAlign = node.style.textAlignHorizontal
      ? node.style.textAlignHorizontal.toLowerCase()
      : null;
  }

  return props;
}

/** Recursively flatten a Figma node tree into SpecNodes (depth-first, capped at MAX_NODES).
 *  `inheritedState` carries a State=* variant downward so a button's inner text inherits hover. */
function walk(node: FigmaNode, out: SpecNode[], inheritedState: SpecState): void {
  if (out.length >= MAX_NODES) return;
  const state: SpecState = stateFromName(node.name) ?? inheritedState;
  out.push({
    id: node.id,
    name: node.name,
    type: node.type,
    text: node.type === "TEXT" ? (node.characters ?? "").slice(0, 120) : null,
    state,
    props: nodeToProps(node),
  });
  if (node.children) {
    for (const child of node.children) walk(child, out, state);
  }
}

/**
 * Fetch a node (and all descendants) from the Figma REST API and flatten to SpecNodes.
 * Requires a Figma personal access token with file read scope.
 */
export async function fetchFigmaSpec(
  fileKey: string,
  nodeId: string,
  token: string,
): Promise<SpecNode[]> {
  const url = `${FIGMA_API_BASE}/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`;
  const res = await fetch(url, { headers: { "X-Figma-Token": token } });

  if (res.status === 403) {
    throw new Error(
      "Figma returned 403. Check FIGMA_TOKEN is set and has file read access to this file.",
    );
  }
  if (!res.ok) {
    throw new Error(`Figma API error ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    nodes?: Record<string, { document?: FigmaNode } | null>;
  };
  const entry = data.nodes?.[nodeId];
  if (!entry || !entry.document) {
    throw new Error(
      `Node ${nodeId} not found in file ${fileKey}. Confirm the node id (format "318:7971") and that it belongs to this file.`,
    );
  }

  const out: SpecNode[] = [];
  walk(entry.document, out, "default");
  return out;
}

/** Properties worth checking for tokenisation (colours + the spacing/type scale). */
const TOKENIZABLE: (keyof SpecProps)[] = [
  "background",
  "color",
  "borderColor",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "gap",
  "borderRadius",
  "fontSize",
  "lineHeight",
  "letterSpacing",
];

/**
 * Cross-reference the concrete values used across nodes against the set of values
 * that the file's variables resolve to. Anything used but not covered by a variable
 * is "untokenised" — i.e. it will drift, and is a candidate to variable-ize in Figma.
 */
export function findUntokenized(
  nodes: SpecNode[],
  variables: Record<string, string>,
): { nodeId: string; nodeName: string; property: keyof SpecProps; value: number | string }[] {
  const tokenValues = new Set(
    Object.values(variables).map((v) => String(v).trim().toLowerCase()),
  );
  // Numeric variable values (e.g. spacing tokens) compared as plain numbers too.
  const tokenNumbers = new Set(
    Object.values(variables)
      .map((v) => parseFloat(String(v)))
      .filter((n) => !Number.isNaN(n)),
  );

  const seen = new Set<string>();
  const result: {
    nodeId: string;
    nodeName: string;
    property: keyof SpecProps;
    value: number | string;
  }[] = [];

  for (const node of nodes) {
    for (const prop of TOKENIZABLE) {
      const val = node.props[prop];
      if (val === null) continue;
      const covered =
        typeof val === "number"
          ? tokenNumbers.has(val)
          : tokenValues.has(String(val).toLowerCase());
      if (covered) continue;
      const dedupe = `${prop}:${val}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      result.push({ nodeId: node.id, nodeName: node.name, property: prop, value: val });
    }
  }
  return result;
}
