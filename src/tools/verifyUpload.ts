import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HS_CMD, HS_FETCH_SUBCMD } from "../constants.js";
import { fetchLiveHtml, runCli } from "../services/shell.js";

const InputSchema = z
  .object({
    local_path: z.string().min(1).describe("Path to the local source file you changed (e.g. src/modules/x.module/module.css)."),
    remote_path: z
      .string()
      .min(1)
      .describe("The portal path it should have uploaded to (e.g. hart-it-theme/modules/x.module/module.css)."),
    account: z.string().min(1).describe("HubSpot CLI account name passed as --account."),
    preview_url: z
      .string()
      .url()
      .optional()
      .describe("Optional live/preview page URL to confirm the change actually renders."),
    expect: z
      .string()
      .optional()
      .describe('Optional string that should appear in the rendered page if the change took effect (e.g. "gap:44px" or a class name).'),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

function normalize(s: string): string {
  return s.replace(/\r\n/g, "\n").trim();
}

/** Changes to these file types do not render on a published page until it is re-published. */
function needsRepublish(remotePath: string): boolean {
  return /module\.html$|fields\.json$|\.html$/i.test(remotePath);
}

export function registerVerifyUpload(server: McpServer): void {
  server.registerTool(
    "specsync_verify_upload",
    {
      title: "Verify upload landed and rendered",
      description: `Confirm a change actually reached the portal AND renders on the live page — instead of trusting that an upload command "worked".

Two checks:
  1. SYNCED? — fetches remote_path back from the portal and diffs it against local_path. Mismatch/failure = the upload did not land (wrong path, bad command, or auth).
  2. RENDERED? — if preview_url + expect are given, fetches the page with a cache-buster and checks the expected string is present.

It then DIAGNOSES the common "my change isn't showing" cases:
  - not synced → command / path / auth problem (CLI output included)
  - synced, not rendered, and the file is module.html / fields.json / a template → the page needs RE-PUBLISH in the HubSpot editor (the CLI cannot do this; hand it to the user)
  - synced, not rendered, CSS/JS → almost certainly CDN cache; wait and re-check

Read-only with respect to the portal and site (it only fetches). Returns JSON: { synced, rendered, diagnosis, cli_stderr }.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: Input) => {
      const dir = await mkdtemp(join(tmpdir(), "specsync-"));
      const dest = join(dir, "remote-copy");
      let synced = false;
      let cliStderr = "";

      try {
        const fetchArgs = [
          ...HS_FETCH_SUBCMD.split(/\s+/),
          params.remote_path,
          dest,
          `--account=${params.account}`,
        ];
        const cli = await runCli(HS_CMD, fetchArgs);
        cliStderr = cli.stderr;

        if (cli.ok) {
          try {
            const [local, remote] = await Promise.all([
              readFile(params.local_path, "utf8"),
              readFile(dest, "utf8"),
            ]);
            synced = normalize(local) === normalize(remote);
          } catch (e) {
            cliStderr += `\n(read-back failed: ${(e as Error).message})`;
          }
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }

      let rendered: boolean | null = null;
      if (params.preview_url && params.expect) {
        const page = await fetchLiveHtml(params.preview_url);
        rendered = page.ok && page.body.includes(params.expect);
      }

      let diagnosis: string;
      if (!synced) {
        diagnosis =
          "NOT SYNCED — the file did not land in the portal. Check the remote path, the CLI subcommand form, and the --account flag. CLI stderr is included.";
      } else if (rendered === true) {
        diagnosis = "SYNCED and RENDERED — the change is live.";
      } else if (rendered === false) {
        diagnosis = needsRepublish(params.remote_path)
          ? "SYNCED but NOT RENDERED — this is HTML/fields/template, so the page using it must be RE-PUBLISHED in the HubSpot editor. The CLI cannot do this; hand it to the user as an explicit action."
          : "SYNCED but NOT RENDERED — CSS/JS change; almost certainly CDN cache. Re-check the cache-busted URL shortly. Do NOT re-upload.";
      } else {
        diagnosis =
          "SYNCED — file matches the portal. Rendering not checked (pass preview_url + expect to confirm the live page).";
      }

      const output = { synced, rendered, diagnosis, cli_stderr: cliStderr.slice(0, 2000) };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
  );
}
