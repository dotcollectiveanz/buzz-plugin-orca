import { describe, expect, it } from "vitest";
import { fakeOrca } from "./fake";
import { envelope, MISSING, Orca, OrcaError } from "./orca";
import { config, repoSelector, summary } from "./settings";
import { messageText, placementArgs, taskTitle, workerSpec, workspaceName } from "./spec";

describe("settings", () => {
  it("fills and cleans a saved config", () => {
    expect(config(undefined)).toMatchObject({ agent: "claude", placement: "new", keepOpen: true, scope: "thread" });
    expect(config({ agent: "rm -rf /", placement: "x", scope: "channel", keepOpen: false })).toMatchObject({
      agent: "claude",
      placement: "new",
      scope: "channel",
      keepOpen: false,
    });
  });
  it("turns a repo into an Orca selector", () => {
    expect(repoSelector("")).toBe("");
    expect(repoSelector("shop")).toBe("name:shop");
    expect(repoSelector("/code/shop")).toBe("path:/code/shop");
    expect(repoSelector("~/code/shop")).toBe("path:~/code/shop");
    expect(repoSelector("id:abc")).toBe("id:abc");
    expect(summary({ repo: "shop", agent: "codex", placement: "main" })).toBe("codex · shop");
  });
});

describe("spec", () => {
  it("drops nostr mentions", () => {
    expect(messageText("nostr:npub1qqq fix  it \n nostr:nprofile1zzz")).toBe("fix it");
  });
  it("titles and names a worker", () => {
    expect(taskTitle("\n  First line\nsecond")).toBe("First line");
    expect(taskTitle("x".repeat(80))).toHaveLength(60);
    expect(workspaceName("Fix the Header & Footer!", "ABCDEF99")).toBe("buzz-fix-the-header-footer-abcdef");
    expect(workspaceName("!!!", "zz")).toBe("buzz-x");
  });
  it("places a worker", () => {
    const repo = { id: "r1", path: "/code/shop" };
    expect(placementArgs({ placement: "main", baseBranch: "dev" }, repo, "n")).toEqual(["--worktree", "path:/code/shop"]);
    expect(placementArgs({ placement: "new", baseBranch: "dev" }, repo, "n")).toEqual([
      "--worktree", "new-top-level", "--repo", "id:r1", "--name", "n", "--base-branch", "dev",
    ]);
  });
  it("briefs a worker", () => {
    const spec = workerSpec({ request: "Do X", where: "#builds", agentName: "Orca Agent", instructions: "Run tests." });
    expect(spec).toContain("#builds");
    expect(spec).toContain("Run tests.");
    expect(spec).toContain("Do X");
    expect(spec).toContain("worker_done");
  });
});

describe("Orca CLI", () => {
  it("reads the envelope", () => {
    expect(envelope('{"ok":true,"result":1}')).toEqual({ ok: true, result: 1 });
    expect(envelope('noise\n{"ok":true,"result":2}')).toEqual({ ok: true, result: 2 });
    expect(envelope("")).toBeUndefined();
  });
  it("raises Orca's error code", async () => {
    const { spawn } = fakeOrca(() => ({ error: { code: "no_active_sender_terminal", message: "nope" } }));
    await expect(new Orca(spawn).call(["x"])).rejects.toMatchObject({ code: "no_active_sender_terminal" });
  });
  it("explains a missing orca", async () => {
    const orca = new Orca(async () => {
      throw new Error("No such file or directory (os error 2)");
    });
    await expect(orca.call(["status"])).rejects.toEqual(new OrcaError("missing", MISSING));
    const { spawn } = fakeOrca(() => ({ raw: "", code: 127 }));
    await expect(new Orca(spawn).call(["status"])).rejects.toMatchObject({ code: "missing" });
    const located = fakeOrca(() => ({ error: { code: "orca_not_installed", message: "x" } }));
    await expect(new Orca(located.spawn).call(["status"])).rejects.toEqual(new OrcaError("missing", MISSING));
  });
  it("opens Orca once when it is not running, then retries", async () => {
    let open = false;
    const { spawn, calls } = fakeOrca((args) => {
      if (args[0] === "open") {
        open = true;
        return { result: {} };
      }
      return open
        ? { result: { repos: [{ id: "r", path: "/p", displayName: "p" }] } }
        : { error: { code: "runtime_unavailable", message: "Orca is not running" } };
    });
    const orca = new Orca(spawn);
    const [a, b] = await Promise.all([orca.repos(), orca.repos()]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(calls.filter((call) => call.args[0] === "open")).toHaveLength(1);
  });
  it("does not retry other errors", async () => {
    const { spawn, calls } = fakeOrca(() => ({ error: { code: "selector_not_found", message: "no repo" } }));
    await expect(new Orca(spawn).repo("name:x")).rejects.toMatchObject({ code: "selector_not_found" });
    expect(calls).toHaveLength(1);
  });
  it("sends a spec on stdin", async () => {
    const { spawn, calls } = fakeOrca(() => ({ result: { dispatchId: "d", runId: "r" } }));
    await new Orca(spawn).workerStart({
      from: "t", run: "r", spec: "long spec", title: "T", agent: "claude", placement: ["--worktree", "path:/x"],
    });
    expect(calls[0]?.input).toBe("long spec");
    expect(calls[0]?.args).toContain("--spec-file");
  });
});
