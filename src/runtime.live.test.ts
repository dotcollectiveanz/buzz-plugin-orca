// A real worker in your own Orca: Orca must be running. Starts one coding agent
// in the repo's checkout with a Task that edits nothing, and waits for its
// report. Nothing reaches Buzz.
//   ORCA_LIVE=1 ORCA_REPO=<name or path> npx vitest run src/runtime.live.test.ts
// ORCA_AGENT picks the agent (default claude), ORCA_MODEL and ORCA_EFFORT its
// model and thinking level. Orca is run as Buzz runs it:
// the manifest's declared `orca` process (the `sh` locator) with the
// plugin's arguments after its own, from a PATH with nothing of Orca on it.
import { spawn as nodeSpawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HostProcess, HostProcessOptions } from "./buzz";
import { fakeKit, memoryStorage, mention, THREAD } from "./fake";
import { Orca } from "./orca";
import { MAILBOXES_KEY, OrcaRuntime } from "./runtime";

const live = process.env.ORCA_LIVE === "1";
const DECLARED = (
  JSON.parse(readFileSync(new URL("../plugin/manifest.json", import.meta.url), "utf8")) as {
    host: { processes: { id: string; program: string; args?: string[] }[] };
  }
).host.processes.find((process) => process.id === "orca");

/** Buzz's host spawn, done with Node: `null` env values are removed. */
async function spawn(id: string, options: HostProcessOptions = {}): Promise<HostProcess> {
  if (id !== "orca" || !DECLARED) throw new Error(`undeclared process ${id}`);
  const env: Record<string, string> = { PATH: "/usr/bin:/bin" };
  for (const [name, value] of Object.entries(process.env))
    if (value !== undefined && name !== "PATH") env[name] = value;
  for (const [name, value] of Object.entries(options.env ?? {})) {
    if (value === null) delete env[name];
    else env[name] = value;
  }
  const child = nodeSpawn(DECLARED.program, [...(DECLARED.args ?? []), ...(options.args ?? [])], {
    env,
    cwd: process.env.HOME,
  });
  child.stdout.on("data", (data: Buffer) => options.onStdout?.(data.toString()));
  child.stderr.on("data", (data: Buffer) => options.onStderr?.(data.toString()));
  const exited = new Promise<number | null>((resolve) => child.on("close", (code) => resolve(code)));
  return {
    write: async (data) => {
      child.stdin.write(data);
    },
    end: async (data = "") => {
      child.stdin.end(data);
    },
    kill: async () => {
      child.kill();
    },
    exited,
  };
}

describe.runIf(live)("live Orca", () => {
  it(
    "runs a worker from a mention and posts its report",
    async () => {
      const { kit, posted } = fakeKit(THREAD);
      const storage = memoryStorage();
      const orca = new Orca(spawn);
      const runtime = new OrcaRuntime(kit, orca, storage);
      const { delivery, working } = mention(
        "Live test of the Buzz to Orca plugin. Do not edit, create or delete any file, and run no commands. Report done with the summary: pong",
        {
          repo: process.env.ORCA_REPO ?? "",
          agent: process.env.ORCA_AGENT ?? "claude",
          model: process.env.ORCA_MODEL ?? "",
          effort: process.env.ORCA_EFFORT ?? "",
          placement: "main",
          keepOpen: false,
        },
      );
      await runtime.run(delivery);
      await Promise.all(working);
      runtime.dispose();
      // Close the mailbox terminal this run opened.
      const mailboxes = JSON.parse(storage.getItem(MAILBOXES_KEY) ?? "{}") as Record<string, string>;
      for (const handle of Object.values(mailboxes))
        await orca.call(["terminal", "close", "--terminal", handle, "--tab"]).catch(() => undefined);
      console.log(posted);
      expect(posted[0]?.text).toMatch(/^On it:/);
      expect(posted.at(-1)?.text).toMatch(/pong/i);
      expect(runtime.records()[0]?.status).toBe("done");
    },
    10 * 60_000,
  );
});
