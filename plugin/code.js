// SpecSync Interactions — Figma plugin (sandbox JS, no build step).
// Reads the Plugin API for behaviour the REST API can't fully see:
// reactions (interactions), prototype flows, and component variant matrices.
// Emits an InteractionSpec (see src/interactionTypes.ts) the SpecSync MCP loads.

const BRIDGE_URL = "http://localhost:7331/interaction-spec";

figma.showUI(__html__, { width: 360, height: 220 });

// ---- helpers ---------------------------------------------------------------

function mapTrigger(t) {
  if (!t || !t.type) return "UNKNOWN";
  return t.type; // Figma trigger types already match our TriggerType union.
}

function triggerDelay(t) {
  // AFTER_TIMEOUT carries `timeout` in seconds (older API) or `delay`.
  if (t && t.type === "AFTER_TIMEOUT") {
    if (typeof t.timeout === "number") return t.timeout;
    if (typeof t.delay === "number") return t.delay;
  }
  return null;
}

function mapTransition(transition) {
  if (!transition) return { type: null, duration: null, easing: null };
  const easing = transition.easing ? transition.easing.type || null : null;
  return {
    type: transition.type || null,
    duration: typeof transition.duration === "number" ? transition.duration : null,
    easing: easing,
  };
}

// Flatten a Figma reaction action into our ActionType + destination + url + impl hint.
function mapAction(action) {
  const out = {
    action: "UNKNOWN",
    destinationId: null,
    url: null,
    transition: { type: null, duration: null, easing: null },
    implHint: "review",
  };
  if (!action) {
    out.action = "NONE";
    out.implHint = "no-action";
    return out;
  }

  switch (action.type) {
    case "URL":
      out.action = "URL";
      out.url = action.url || null;
      out.implHint = "external-link";
      break;
    case "BACK":
      out.action = "BACK";
      out.implHint = "js-history-back";
      break;
    case "CLOSE":
      out.action = "CLOSE";
      out.implHint = "js-close-overlay";
      break;
    case "SET_VARIABLE":
      out.action = "SET_VARIABLE";
      out.implHint = "js-state-toggle";
      break;
    case "NODE": {
      // Navigation-type action: navigation field tells us what kind.
      const nav = action.navigation; // NAVIGATE | OVERLAY | SWAP | SCROLL_TO | CHANGE_TO
      out.destinationId = action.destinationId || null;
      out.transition = mapTransition(action.transition);
      switch (nav) {
        case "NAVIGATE":
          out.action = "NAVIGATE";
          out.implHint = "anchor-link";
          break;
        case "OVERLAY":
          out.action = "OVERLAY";
          out.implHint = "js-overlay";
          break;
        case "SWAP":
          out.action = "SWAP";
          out.implHint = "js-swap";
          break;
        case "SCROLL_TO":
          out.action = "SCROLL_TO";
          out.implHint = "scroll-anchor";
          break;
        case "CHANGE_TO":
          out.action = "CHANGE_TO";
          out.implHint = "js-variant-change";
          break;
        default:
          out.action = "NAVIGATE";
          out.implHint = "anchor-link";
      }
      break;
    }
    default:
      out.action = "UNKNOWN";
      out.implHint = "review";
  }
  return out;
}

// ---- extraction ------------------------------------------------------------

async function collectReactions(roots, nameById) {
  const interactions = [];

  async function visit(node) {
    // reactions is available on most node types that support prototyping.
    const reactions = node.reactions || [];
    for (const r of reactions) {
      const trigger = mapTrigger(r.trigger);
      const delay = triggerDelay(r.trigger);
      // Newer API: r.actions (array). Older: r.action (single).
      const actions = r.actions ? r.actions : r.action ? [r.action] : [null];
      for (const a of actions) {
        const m = mapAction(a);
        interactions.push({
          nodeId: node.id,
          nodeName: node.name,
          trigger: trigger,
          delay: delay,
          action: m.action,
          destinationId: m.destinationId,
          destinationName: m.destinationId ? nameById[m.destinationId] || null : null,
          url: m.url,
          transition: m.transition,
          implHint: m.implHint,
        });
      }
    }
    if ("children" in node) {
      for (const child of node.children) await visit(child);
    }
  }

  for (const root of roots) await visit(root);
  return interactions;
}

function collectFlows(nameById) {
  const flows = [];
  const starts = figma.currentPage.flowStartingPoints || [];
  for (const sp of starts) {
    const startNode = figma.getNodeById(sp.nodeId);
    const steps = [];
    // Best-effort one-hop expansion from the start frame's reactions.
    if (startNode && "reactions" in startNode) {
      for (const r of startNode.reactions || []) {
        const actions = r.actions ? r.actions : r.action ? [r.action] : [];
        for (const a of actions) {
          const m = mapAction(a);
          steps.push({
            fromNodeId: startNode.id,
            fromName: startNode.name,
            trigger: mapTrigger(r.trigger),
            action: m.action,
            toNodeId: m.destinationId,
            toName: m.destinationId ? nameById[m.destinationId] || null : null,
          });
        }
      }
    }
    flows.push({
      name: sp.name || "Flow",
      startNodeId: sp.nodeId,
      startName: startNode ? startNode.name : sp.name || "",
      steps: steps,
    });
  }
  return flows;
}

function collectComponents(roots) {
  const components = [];
  const seen = {};

  function record(node) {
    if (seen[node.id]) return;
    seen[node.id] = true;
    const defs = {};
    try {
      const pd = node.componentPropertyDefinitions || {};
      for (const key of Object.keys(pd)) {
        defs[key] = { type: pd[key].type, options: pd[key].variantOptions || undefined };
      }
    } catch (e) {
      // standalone COMPONENT without definitions — leave defs empty
    }
    const variants = [];
    if (node.type === "COMPONENT_SET" && "children" in node) {
      for (const child of node.children) {
        const props = {};
        // Variant child names look like "State=Hover, Size=Large"
        (child.name || "").split(",").forEach(function (pair) {
          const kv = pair.split("=");
          if (kv.length === 2) props[kv[0].trim()] = kv[1].trim();
        });
        variants.push({ nodeId: child.id, name: child.name, properties: props });
      }
    }
    components.push({ id: node.id, name: node.name, propertyDefinitions: defs, variants: variants });
  }

  function visit(node) {
    if (node.type === "COMPONENT_SET" || node.type === "COMPONENT") record(node);
    if ("children" in node) for (const child of node.children) visit(child);
  }
  for (const root of roots) visit(root);
  return components;
}

// Build an id → name map across the page so destinations resolve to names.
function buildNameIndex() {
  const map = {};
  function visit(node) {
    map[node.id] = node.name;
    if ("children" in node) for (const child of node.children) visit(child);
  }
  visit(figma.currentPage);
  return map;
}

async function extract() {
  await figma.loadAllPagesAsync().catch(function () {});
  const selection = figma.currentPage.selection;
  const roots = selection.length ? selection.slice() : figma.currentPage.children.slice();
  const scope = selection.length ? selection.map((n) => n.id).join(",") : "page";

  const nameById = buildNameIndex();
  const interactions = await collectReactions(roots, nameById);
  const flows = collectFlows(nameById);
  const components = collectComponents(roots);

  return {
    source: "figma-plugin",
    fileKey: figma.fileKey || "unknown",
    scope: scope,
    generatedAt: new Date().toISOString(),
    interactions: interactions,
    flows: flows,
    components: components,
  };
}

// ---- message handling ------------------------------------------------------

figma.ui.onmessage = async function (msg) {
  if (msg.type === "extract") {
    try {
      const spec = await extract();
      const json = JSON.stringify(spec, null, 2);
      figma.ui.postMessage({ type: "result", json: json, counts: {
        interactions: spec.interactions.length,
        flows: spec.flows.length,
        components: spec.components.length,
      }});

      if (msg.sendToBridge) {
        try {
          await fetch(BRIDGE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: json,
          });
          figma.ui.postMessage({ type: "bridge", ok: true });
        } catch (e) {
          figma.ui.postMessage({ type: "bridge", ok: false, error: String(e) });
        }
      }
    } catch (e) {
      figma.ui.postMessage({ type: "error", error: String(e) });
    }
  }
  if (msg.type === "close") figma.closePlugin();
};
