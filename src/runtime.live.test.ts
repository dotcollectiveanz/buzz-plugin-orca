// A real worker in your own Orca: Orca must be running. Starts one coding agent
// in the repo's checkout with a Task that edits nothing, and waits for its
// report. Nothing reaches Buzz.
//   ORCA_LIVE=1 ORCA_REPO=<name or path> npx vitest run src/runtime.live.test.ts
// ORCA_AGENT picks the agent (default claude); ORCA_BIN the CLI.
import { spawn as nodeSpawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { HostProcess, HostProcessOptions } from "./buzz";
import { fakeKit, memoryStorage, mention, THREAD } from "./fake";
import { Orca } from "./orca";
import { OrcaRuntime } from "./runtime";

const live = process.env.ORCA_LIVE === "1";
const BIN = process.env.ORCA_BIN ?? "/Applications/Orca.app/Contents/Resources/bin/orca";

/** Buzz's host spawn, done with Node: `null` env values are removed. */
async function spawn(id: string, options: HostProcessOptions = {}): Promise<HostProcess> {
  if (id !== "orca") throw new Error(`undeclared process ${id}`);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
  for (const [name, value] of Object.entries(options.env ?? {})) {
    if (value === null) delete env[name];
    else env[name] = value;
  }
  const child = nodeSpawn(BIN, [...(options.args ?? [])], { env, cwd: process.env.HOME });
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
      const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
      const { delivery, working } = mention(
        "Live test of the Buzz to Orca plugin. Do not edit, create or delete any file, and run no commands. Report done with the summary: pong",
        {
          repo: process.env.ORCA_REPO ?? "",
          agent: process.env.ORCA_AGENT ?? "claude",
          placement: "main",
          keepOpen: false,
        },
      );
      await runtime.run(delivery);
      await Promise.all(working);
      console.log(posted);
      expect(posted[0]?.text).toMatch(/^On it:/);
      expect(posted.at(-1)?.text).toMatch(/pong/i);
      expect(runtime.records()[0]?.status).toBe("done");
      runtime.dispose();
    },
    10 * 60_000,
  );
});
