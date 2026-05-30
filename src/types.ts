/**
 * The shared property shape. Both `figma_spec` (design side) and `live_spec`
 * (rendered side) emit nodes with exactly these properties, which is what makes
 * `spec_diff` a mechanical, numeric comparison instead of an eyeball judgement.
 *
 * Every field is `number | string | null`. A value that genuinely does not exist
 * on a node is `null` — never omitted — so "missing" is visible in a diff.
 */
export interface SpecProps {
  // Box / layout
  width: number | null;
  height: number | null;
  layoutMode: string | null; // Figma: HORIZONTAL | VERTICAL | NONE
  display: string | null; // Live: computed `display`
  paddingTop: number | null;
  paddingRight: number | null;
  paddingBottom: number | null;
  paddingLeft: number | null;
  marginTop: number | null;
  marginRight: number | null;
  marginBottom: number | null;
  marginLeft: number | null;
  gap: number | null; // Figma itemSpacing / live `gap`
  borderRadius: number | null;
  borderWidth: number | null;

  // Colour (always normalised to lowercase #rrggbb or #rrggbbaa)
  background: string | null;
  color: string | null;
  borderColor: string | null;
  boxShadow: string | null;

  // Typography
  fontFamily: string | null;
  fontWeight: number | null;
  fontSize: number | null;
  lineHeight: number | null; // px (null when Figma uses AUTO or live uses `normal`)
  letterSpacing: number | null; // px
  textAlign: string | null;
}

export interface SpecNode {
  /** Figma node id (e.g. "318:7971") on the design side, or the CSS selector on the live side. */
  id: string;
  /** Figma layer name, or the CSS selector on the live side. */
  name: string;
  /** Figma node type (FRAME, TEXT, ...) or the live element's tagName. */
  type: string;
  /** Text content for text nodes (truncated), else null. */
  text: string | null;
  /**
   * Interaction state this node represents: "default" for resting styles, or
   * "hover"/"focus"/"active"/"disabled" when derived from a Figma component
   * variant named State=Hover etc. (design side) or read under a forced CSS
   * state (live side). This is what lets the diff check hover/focus, not just
   * the resting state — the root of the recurring hover-weight bugs.
   */
  state: SpecState;
  props: SpecProps;
}

export type SpecState = "default" | "hover" | "focus" | "active" | "disabled";

/** One value that the design uses but has NOT bound to a Figma variable. */
export interface UntokenizedValue {
  nodeId: string;
  nodeName: string;
  property: keyof SpecProps;
  value: number | string;
}

export interface TokenCoverageReport {
  ref: string;
  /** Variable name → value, as returned by Figma. */
  variables: Record<string, string>;
  /** Distinct hard-coded values found on nodes that are not bound to any variable. */
  untokenized: UntokenizedValue[];
  /** Quick headline: how many distinct values are tokenised vs loose. */
  summary: { variable_count: number; untokenized_count: number };
}

export interface SpecDocument {
  source: "figma" | "live";
  /** Figma file key + node id, or the live URL. */
  ref: string;
  nodes: SpecNode[];
}

export interface DiffRow {
  /** The live selector the mismatch was found on. */
  selector: string;
  /** The Figma node id it was compared against. */
  figmaNodeId: string;
  /** Which interaction state this comparison is for. */
  state: SpecState;
  property: keyof SpecProps;
  figma: number | string | null;
  live: number | string | null;
  /** Absolute numeric delta when both sides are numbers, else null. */
  delta: number | null;
  status: "mismatch" | "missing_live" | "missing_figma";
}

/** Build an all-null SpecProps. Helpers fill in only what a node actually defines. */
export function emptyProps(): SpecProps {
  return {
    width: null,
    height: null,
    layoutMode: null,
    display: null,
    paddingTop: null,
    paddingRight: null,
    paddingBottom: null,
    paddingLeft: null,
    marginTop: null,
    marginRight: null,
    marginBottom: null,
    marginLeft: null,
    gap: null,
    borderRadius: null,
    borderWidth: null,
    background: null,
    color: null,
    borderColor: null,
    boxShadow: null,
    fontFamily: null,
    fontWeight: null,
    fontSize: null,
    lineHeight: null,
    letterSpacing: null,
    textAlign: null,
  };
}
