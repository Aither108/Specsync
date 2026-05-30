import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CliResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run a HubSpot CLI invocation. `base` is something like "npx hs" and `args`
 * are the remaining tokens. Never throws on non-zero exit — returns ok=false so
 * the calling tool can produce an actionable diagnosis instead of a stack trace.
 */
export async function runCli(base: string, args: string[], cwd?: string): Promise<CliResult> {
  const [cmd, ...baseArgs] = base.split(/\s+/);
  try {
    const { stdout, stderr } = await execFileAsync(cmd, [...baseArgs, ...args], {
      cwd,
      maxBuffer: 1024 * 1024 * 10,
    });
    return { ok: true, stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? "unknown error" };
  }
}

/** Fetch a URL with a cache-buster query param appended, returning the body text. */
export async function fetchLiveHtml(url: string): Promise<{ ok: boolean; status: number; body: string }> {
  const bust = url.includes("?") ? `&` : `?`;
  const target = `${url}${bust}hsCacheBuster=${Date.now()}`;
  try {
    const res = await fetch(target, { redirect: "follow" });
    return { ok: res.ok, status: res.status, body: await res.text() };
  } catch (err) {
    return { ok: false, status: 0, body: (err as Error).message };
  }
}
