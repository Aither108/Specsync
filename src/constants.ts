export const SERVER_NAME = "specsync-mcp-server";
export const SERVER_VERSION = "0.1.0";

export const FIGMA_API_BASE = "https://api.figma.com/v1";

// How the HubSpot CLI is invoked. Subcommand form (`hs` vs `hs cms`) has drifted
// across CLI versions, so it is configurable. Default matches recent CLI (v7/v8+).
export const HS_CMD = process.env.SPECSYNC_HS_CMD ?? "npx hs";
export const HS_FETCH_SUBCMD = process.env.SPECSYNC_HS_FETCH ?? "cms fetch";

// Cap on how many nodes a single figma_spec walk will emit, to protect agent context.
export const MAX_NODES = Number(process.env.SPECSYNC_MAX_NODES ?? 400);

// Default tolerance (in px) for treating two length values as equal in a diff.
export const DEFAULT_TOLERANCE_PX = 1;
