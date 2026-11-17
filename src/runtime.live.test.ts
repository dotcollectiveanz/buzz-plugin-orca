// A real worker in your own Orca: Orca must be running. Starts one coding agent
// in the repo's checkout with a Task that edits nothing, and waits for its
// report, which attaches a picture the test puts in the checkout (and removes
// after), read with the host's file access as Buzz gives it. Nothing reaches
// Buzz.
//   ORCA_LIVE=1 ORCA_REPO=<name or path> npx vitest run src/runtime.live.test.ts
// ORCA_AGENT picks the agent (default claude), ORCA_MODEL and ORCA_EFFORT its
// model and thinking level. Orca is run as Buzz runs it:
// the manifest's declared `orca` process (the `sh` locator) with the
// plugin's arguments after its own, from a PATH with nothing of Orca on it.
import { spawn as nodeSpawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HostProcess, HostProcessOptions } from "./buzz";
import type { Files } from "./attachments";
import { fakeKit, memoryStorage, mention, PNG, THREAD } from "./fake";
import { Orca } from "./orca";
import { MAILBOXES_KEY, OrcaRuntime } from "./runtime";
import { repoSelector } from "./settings";

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

/** Buzz's `host.files`, done with Node. */
const files: Files = {
  readFile: async (path) => new Uint8Array(await readFile(path)),
  resolveDirectory: async (path) => {
    const real = await realpath(path);
    if (!(await stat(real)).isDirectory()) throw new Error(`Not a directory: ${path}`);
    return real;
  },
};

const PICTURE = ".buzz-live-test.png";

describe.runIf(live)("live Orca", () => {
  it(
    "runs a worker from a mention and posts its messages and its reply with a file",
    async () => {
      const { kit, posted, sent } = fakeKit(THREAD);
      const storage = memoryStorage();
      const orca = new Orca(spawn);
      const runtime = new OrcaRuntime(kit, orca, storage, Date.now, files);
      const selector = repoSelector(process.env.ORCA_REPO ?? "");
      const repo = selector ? await orca.repo(selector) : (await orca.repos())[0]!;
      const picture = join(repo.path, PICTURE);
      await writeFile(picture, PNG);
      const { delivery, working } = mention(
        `Live test of the Buzz to Orca plugin. Do not edit, create or delete any file, and run no commands except Orca's. First post a message to the conversation saying exactly: ping. Then report done with the summary: pong, attaching the file ${PICTURE} in your workspace.`,
        {
          repo: process.env.ORCA_REPO ?? "",
          agent: process.env.ORCA_AGENT ?? "claude",
          model: process.env.ORCA_MODEL ?? "",
          effort: process.env.ORCA_EFFORT ?? "",
          placement: "main",
          keepOpen: false,
        },
      );
      try {
        await runtime.run(delivery);
        await Promise.all(working);
      } finally {
        runtime.dispose();
        await rm(picture, { force: true });
      }
      // Close the mailbox terminal this run opened.
      const mailboxes = JSON.parse(storage.getItem(MAILBOXES_KEY) ?? "{}") as Record<string, string>;
      for (const handle of Object.values(mailboxes))
        await orca.call(["terminal", "close", "--terminal", handle, "--tab"]).catch(() => undefined);
      console.log(posted, sent);
      // The worker's message while it works, then its reply with the picture,
      // and nothing else.
      expect(posted.map((post) => post.text.trim().toLowerCase())).toEqual(["ping"]);
      expect(sent).toHaveLength(1);
      expect(String(sent[0]!.args.text).trim().toLowerCase().replace(/[.!]$/, "")).toBe("pong");
      expect(Object.values(sent[0]!.files)).toEqual([PNG]);
      expect(runtime.records()[0]?.status).toBe("done");
    },
    10 * 60_000,
  );
});
