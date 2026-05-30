# SpecSync

An MCP server that translates Figma designs into pixel-accurate front-ends — HubSpot or any platform — and **verifies parity** between the design, the source, and the live page.

SpecSync exists to kill two recurring failures in Figma→code work:

1. **Inaccuracy** — agents eyeball a screenshot or echo numbers from the prompt and miss properties (gaps, weights, line-heights, child-element styles).
2. **Sync uncertainty** — a change is uploaded but doesn't show on the live page, and nobody's sure whether it's a bad command, a wrong path, a missing re-publish, or cache.

It fixes both by moving the work out of prose instructions and into **deterministic tools that return numbers** — so any agent (Claude Code, Codex, Cline) in any project gets the same answer instead of improvising.

---

## Tools

| Tool | What it does |
|------|--------------|
| `specsync_figma_spec` | Extracts the **complete property tree** of a Figma node *and every descendant* via the Figma REST API. Layout, box, colour, and typography per node; anything undefined is `null` (never omitted). Detects `State=Hover/Focused/...` component variants and tags each node with its **interaction state**. The design source of truth. |
| `specsync_live_spec` | Reads `getComputedStyle` from the **rendered page** (Playwright) for a list of CSS selectors, in the **same schema** as `figma_spec`. Can **force a state** (`hover`/`focus`/`active`) and read across multiple **viewports** for per-breakpoint checks. |
| `specsync_spec_diff` | Compares a Figma spec to a live spec **numerically**, per state, and returns only the mismatches. A non-empty result = not done. |
| `specsync_verify_upload` | Round-trips a change: fetches the file back from the portal (did it **sync**?) and greps the live URL (did it **render**?), then diagnoses the cause when it didn't. |
| `specsync_sync_tokens` | Pulls Figma **Variables** into a `tokens.css` of CSS custom properties, so design and theme read spacing/colour/type from one source (the root fix for drift). |
| `specsync_token_coverage` | Cross-references the values a design uses against its Figma variables and reports the **untokenised** ones — the values that will drift and should be variable-ized. |
| `specsync_figma_interactions` | Loads the **behavioural** spec — prototype interactions, flows, and component variant matrices — captured by the SpecSync Interactions Figma plugin. Tells the AI what's clickable, where it navigates, what opens an overlay, and the variant matrix, with a per-interaction implementation checklist. |

All tools emit the same `SpecProps` shape, which is what makes the diff mechanical rather than a judgement call.

---

## Install

```bash
npm install
npm run build
# For live_spec (rendered-page reading):
npx playwright install chromium
```

Set environment variables (see `.env.example`):

- `FIGMA_TOKEN` — Figma personal access token with file read access (required for `figma_spec` and `sync_tokens`).
- `SPECSYNC_HS_CMD` / `SPECSYNC_HS_FETCH` — how the HubSpot CLI is invoked (defaults `npx hs` / `cms fetch`).

---

## Add it to an MCP client

**Claude Code / Codex / Cline** (stdio server). Point your client's MCP config at the built entry point:

```json
{
  "mcpServers": {
    "specsync": {
      "command": "node",
      "args": ["/absolute/path/to/specsync/dist/index.js"],
      "env": { "FIGMA_TOKEN": "figd_..." }
    }
  }
}
```

Because it speaks MCP, every agent that connects gets the same five tools — the capability lives in one server, not in each project's prompt.

---

## The workflow it enforces

1. **`specsync_figma_spec`** on the target node — get every property of the container and its children, with `State=Hover/Focused` variants tagged by state. No coding from screenshots or pasted numbers.
2. Implement the component. As you write the CSS, record the Figma-node → CSS-selector pairing in a small `component.map.json` (you already know which selector implements which node).
3. **`specsync_live_spec`** on the preview URL for those selectors — once for resting styles, and again with `force_state: "hover"` / `"focus"` to catch state bugs, and with `viewports: [1440, 768, 375]` for responsive checks.
4. **`specsync_spec_diff`** with your map. Fix until `mismatch_count` is 0 — including the hover/focus rows, which is the class of bug that keeps slipping through visual review.
5. **`specsync_verify_upload`** — confirm the change synced *and* rendered; if it's HTML/fields/template, the page needs a re-publish (the tool says so).

> Tip: run **`specsync_token_coverage`** once per file (passing your `get_variable_defs` output) to see how much of the design is loose values. Heavy untokenisation means `spec_diff` is doing the fidelity heavy-lifting — consider variable-izing spacing/type in Figma so `sync_tokens` can carry it instead.

> The tools give the *ability*. Your standards doc still has to *mandate the calls* — e.g. "non-empty `spec_diff` = not done; never declare done without `verify_upload` passing." A great tool an agent is allowed to skip gets skipped.

---

## The Figma plugin (behaviour capture)

The `plugin/` folder is a Figma plugin that extracts what the REST API can't fully see — **prototype interactions, flows, and component variant matrices** — and emits an `interaction-spec.json` that `specsync_figma_interactions` consumes.

**Install (Figma desktop):** Plugins → Development → Import plugin from manifest → select `plugin/manifest.json`. It runs on any plan (the Plugin API isn't Enterprise-gated like Code Connect or the Variables REST API).

**Use:** select a frame/section (or nothing for the whole page) → run **SpecSync Interactions** → **Extract** → **Copy JSON** → pass it to `specsync_figma_interactions` (`json` param). Optionally tick "POST to local bridge" to send it to a SpecSync bridge at `http://localhost:7331`.

Each interaction comes with an `implHint` (anchor-link, js-overlay, external-link, scroll-anchor, …) so the AI builds the right web construct. **Verification note:** behaviour capture is exact, but unlike `spec_diff` you can't numerically diff it — link targets and overlay appearance are browser-checkable; transition timing/easing are a human review.

---

## Notes & limits

- `figma_interactions` consumes the plugin's output; it does not call Figma itself. Run the plugin, then pass its JSON.

- `sync_tokens` uses the Figma Variables REST API, which requires an **Enterprise** plan; on lower plans it returns a clear message and you define `tokens.css` by hand.
- `live_spec` reads one viewport per call at the page's default size; call it per breakpoint (resize via your client or extend the tool) for responsive checks.
- The Figma node → selector map is built per component during implementation; SpecSync compares only the pairs you map.

MIT licensed.
