// A real worker in your own Orca: Orca must be running. Starts one coding agent
// in the repo's checkout with a Task that edits nothing, and waits for its
// report, which attaches a picture the test puts in the checkout (and removes
// after), read with the host's file access as Buzz gives it. A second worker is
// sent a picture saved where Buzz's agent media goes (the system temp folder)
// and must say what it shows. Nothing reaches Buzz.
//   ORCA_LIVE=1 ORCA_REPO=<name or path> npx vitest run src/runtime.live.test.ts
// ORCA_AGENT picks the agent (default claude), ORCA_MODEL and ORCA_EFFORT its
// model and thinking level. Orca is run as Buzz runs it:
// the manifest's declared `orca` process (the `sh` locator) with the
// plugin's arguments after its own, from a PATH with nothing of Orca on it.
import { spawn as nodeSpawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { HostProcess, HostProcessOptions } from "./buzz";
import type { Files } from "./attachments";
import type { AgentHandle } from "./buzz";
import { attached, fakeKit, memoryStorage, mention, PNG, THREAD } from "./fake";
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

/** A 32 by 32 PNG of one colour. */
function solidPng([r, g, b]: [number, number, number]) {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(32, 0);
  header.writeUInt32BE(32, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 32 }, () => [r, g, b]).flat())]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: 32 }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Closes the mailbox terminals a run opened. */
async function closeMailboxes(orca: Orca, storage: Storage) {
  const mailboxes = JSON.parse(storage.getItem(MAILBOXES_KEY) ?? "{}") as Record<string, string>;
  for (const handle of Object.values(mailboxes))
    await orca.call(["terminal", "close", "--terminal", handle, "--tab"]).catch(() => undefined);
}

const CONFIG = {
  repo: process.env.ORCA_REPO ?? "",
  agent: process.env.ORCA_AGENT ?? "claude",
  model: process.env.ORCA_MODEL ?? "",
  effort: process.env.ORCA_EFFORT ?? "",
  placement: "main",
  keepOpen: false,
};

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
        CONFIG,
      );
      try {
        await runtime.run(delivery);
        await Promise.all(working);
      } finally {
        runtime.dispose();
        await rm(picture, { force: true });
      }
      await closeMailboxes(orca, storage);
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

  it(
    "shows a worker a picture sent in Buzz, saved where Buzz saves the agent's media",
    async () => {
      const { kit, posted } = fakeKit(THREAD);
      const storage = memoryStorage();
      const orca = new Orca(spawn);
      const runtime = new OrcaRuntime(kit, orca, storage, Date.now, files);
      const shot = attached("swatch.png");
      const dir = join(tmpdir(), "buzz-agent-media");
      const saved = join(dir, `${shot.url.split("/").pop()}`);
      // As Buzz's `media` does: the file in the temp folder, named by its hash.
      const media: NonNullable<AgentHandle["media"]> = async () => {
        const data = solidPng([220, 20, 20]);
        await mkdir(dir, { recursive: true });
        await writeFile(saved, data);
        return { path: saved, type: "image/png", size: data.length };
      };
      const { delivery, working } = mention(
        `Live test of the Buzz to Orca plugin. Do not edit, create or delete any file. Look at the picture attached to this message and report done with only the name of its colour, in one word.\n${shot.markdown}`,
        CONFIG,
        { tags: [shot.tag] },
      );
      try {
        await runtime.run({ ...delivery, agent: { ...delivery.agent, media } });
        await Promise.all(working);
      } finally {
        runtime.dispose();
        await rm(saved, { force: true });
      }
      await closeMailboxes(orca, storage);
      console.log(posted);
      expect(posted).toHaveLength(1);
      expect(posted[0]!.text.toLowerCase()).toContain("red");
      expect(runtime.records()[0]?.status).toBe("done");
    },
    10 * 60_000,
  );
});
