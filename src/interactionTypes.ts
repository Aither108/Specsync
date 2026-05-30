/**
 * The interaction-spec schema — the behavioural counterpart to SpecProps.
 *
 * The Figma plugin (plugin/code.ts) emits this shape by reading the Plugin API
 * (node.reactions, currentPage.flowStartingPoints, componentPropertyDefinitions).
 * The `specsync_figma_interactions` tool validates and re-serves the same shape,
 * so the AI always implements against one agreed structure.
 *
 * This file documents the contract; the plugin is plain JS (Figma sandbox) and
 * the MCP tool re-declares it as a Zod schema, but both must match this.
 */

export type TriggerType =
  | "ON_CLICK"
  | "ON_HOVER"
  | "ON_PRESS"
  | "ON_DRAG"
  | "MOUSE_ENTER"
  | "MOUSE_LEAVE"
  | "MOUSE_UP"
  | "MOUSE_DOWN"
  | "AFTER_TIMEOUT"
  | "ON_KEY_DOWN"
  | "ON_MEDIA_HIT"
  | "ON_MEDIA_END"
  | "UNKNOWN";

/** What the interaction does. Mirrors Figma's action/navigation model, flattened. */
export type ActionType =
  | "NAVIGATE" // go to another frame
  | "OVERLAY" // open a frame as an overlay (modal/dropdown/tooltip)
  | "SWAP" // swap the current overlay for another
  | "SCROLL_TO" // scroll to a node
  | "BACK" // back in prototype history
  | "CLOSE" // close overlay
  | "URL" // open an external URL
  | "CHANGE_TO" // change a component instance to another variant
  | "SET_VARIABLE"
  | "NONE"
  | "UNKNOWN";

export interface Transition {
  /** e.g. DISSOLVE, SMART_ANIMATE, MOVE_IN, PUSH, SLIDE_IN, INSTANT. */
  type: string | null;
  /** Seconds. */
  duration: number | null;
  /** e.g. EASE_OUT, EASE_IN_AND_OUT, LINEAR, GENTLE. */
  easing: string | null;
}

export interface Interaction {
  /** Figma node id the interaction is attached to. */
  nodeId: string;
  /** Figma layer name of that node. */
  nodeName: string;
  trigger: TriggerType;
  /** For AFTER_TIMEOUT triggers: delay in seconds, else null. */
  delay: number | null;
  action: ActionType;
  /** Destination node id for NAVIGATE/OVERLAY/SWAP/SCROLL_TO/CHANGE_TO, else null. */
  destinationId: string | null;
  /** Human-readable destination name when resolvable, else null. */
  destinationName: string | null;
  /** External URL for URL actions, else null. */
  url: string | null;
  transition: Transition;
  /**
   * Suggested web implementation, derived by the plugin to guide the AI:
   * e.g. "anchor-link", "js-overlay", "js-swap", "scroll-anchor", "external-link".
   */
  implHint: string;
}

export interface FlowStep {
  fromNodeId: string;
  fromName: string;
  trigger: TriggerType;
  action: ActionType;
  toNodeId: string | null;
  toName: string | null;
}

export interface Flow {
  /** Flow name as set in Figma's prototype settings. */
  name: string;
  startNodeId: string;
  startName: string;
  /** Ordered hops reachable from the start point (best-effort traversal). */
  steps: FlowStep[];
}

export interface ComponentVariant {
  nodeId: string;
  name: string;
  /** Parsed variant properties, e.g. { State: "Hover", Size: "Large" }. */
  properties: Record<string, string>;
}

export interface ComponentSpec {
  /** Component set id (or component id for standalone components). */
  id: string;
  name: string;
  /** Property definitions: name → type (VARIANT, BOOLEAN, TEXT, INSTANCE_SWAP) + options. */
  propertyDefinitions: Record<string, { type: string; options?: string[] }>;
  variants: ComponentVariant[];
}

export interface InteractionSpec {
  source: "figma-plugin";
  /** Figma file key the spec was extracted from. */
  fileKey: string;
  /** Node ids the extraction was scoped to (the user's selection), or "page". */
  scope: string;
  generatedAt: string;
  interactions: Interaction[];
  flows: Flow[];
  components: ComponentSpec[];
}
