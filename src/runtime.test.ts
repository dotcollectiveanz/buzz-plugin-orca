import { describe, expect, it } from "vitest";
import { type Answer, fakeKit, fakeOrca, memoryStorage, mention, THREAD } from "./fake";
import { Orca } from "./orca";
import { MAILBOXES_KEY, OrcaRuntime } from "./runtime";

const REPO = { id: "repo-1", path: "/code/shop", displayName: "shop" };
const CONFIG = { repo: "shop", agent: "claude" };

/** Orca with one repo, a mailbox, and mail given by `mail` per check. */
function orcaWith(mail: Answer[], extra: (args: string[]) => Answer | undefined = () => undefined) {
  return fakeOrca((args) => {
    const found = extra(args);
    if (found) return found;
    const [a, b] = args;
    if (a === "repo" && b === "show") return { result: { repo: REPO } };
    if (a === "terminal" && b === "create") return { result: { terminal: { handle: "term_mail" } } };
    if (a === "terminal" && b === "show") return { result: { terminal: { status: "running" } } };
    if (b === "run-create") return { result: { runId: "run_1" } };
    if (b === "worker-start")
      return {
        result: {
          dispatchId: "ctx_1",
          taskId: "task_1",
          runId: "run_1",
          terminal: "term_worker",
          workspace: "repo-1::/code/shop-wt",
        },
      };
    if (b === "check") return mail.shift() ?? { wait: true };
    if (b === "send" || b === "reply" || b === "worker-stop") return { result: {} };
    return { error: { code: "unknown", message: args.join(" ") } };
  });
}

const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

describe("OrcaRuntime", () => {
  it("starts a worker for a new thread and posts its report", async () => {
    const { spawn, calls } = orcaWith([
      { result: { messages: [{ id: "m1", type: "worker_done", body: "Fixed the header.", payload: { outcome: "succeeded", dispatchId: "ctx_1" } }] } },
    ]);
    const { kit, posted } = fakeKit(THREAD);
    const storage = memoryStorage();
    const runtime = new OrcaRuntime(kit, new Orca(spawn), storage);
    const { delivery, working } = mention("nostr:npub1abc fix the header please", CONFIG);
    await runtime.run(delivery);
    await Promise.all(working);

    const start = calls.find((call) => call.args[1] === "worker-start");
    expect(start).toBeDefined();
    expect(flag(start!.args, "--from")).toBe("term_mail");
    expect(flag(start!.args, "--run")).toBe("run_1");
    expect(flag(start!.args, "--agent")).toBe("claude");
    expect(flag(start!.args, "--worktree")).toBe("new-top-level");
    expect(flag(start!.args, "--repo")).toBe("id:repo-1");
    expect(flag(start!.args, "--name")).toBe("buzz-fix-the-header-please-abcdef");
    expect(start!.args).toContain("--keep-open");
    expect(start!.args.at(-1)).toBe("--json");
    expect(start!.input).toContain("fix the header please");
    expect(start!.input).not.toContain("nostr:");
    const check = calls.find((call) => call.args[1] === "check");
    expect(flag(check!.args, "--terminal")).toBe("term_mail");
    expect(flag(check!.args, "--types")).toBe("worker_done,question,escalation");
    expect(start!.env?.ORCA_TERMINAL_HANDLE).toBeNull();

    expect(posted.map((post) => post.text)).toEqual([
      "On it: claude is working in a new Orca workspace, `buzz-fix-the-header-please-abcdef`.",
      "Fixed the header.",
    ]);
    expect(JSON.parse(storage.getItem(MAILBOXES_KEY) ?? "{}")).toEqual({ "/code/shop": "term_mail" });
    expect(runtime.records()[0]).toMatchObject({ status: "done", run: "run_1", dispatch: "ctx_1" });
  });

  it("sends a later mention to the same worker as a follow-up", async () => {
    const { spawn, calls } = orcaWith([
      { result: { messages: [{ id: "m1", type: "worker_done", body: "Done." }] } },
      { result: { messages: [{ id: "m2", type: "worker_done", body: "Also done." }] } },
    ]);
    const { kit, posted } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    const first = mention("make the button blue", CONFIG);
    await runtime.run(first.delivery);
    await Promise.all(first.working);
    const second = mention("now make it green", CONFIG);
    await runtime.run(second.delivery);
    await Promise.all(second.working);

    expect(calls.filter((call) => call.args[1] === "worker-start")).toHaveLength(1);
    const send = calls.find((call) => call.args[1] === "send");
    expect(flag(send!.args, "--to")).toBe("dispatch:ctx_1");
    expect(flag(send!.args, "--body")).toBe("now make it green");
    // The mailbox is reused while its terminal is live.
    expect(calls.filter((call) => call.args[0] === "terminal" && call.args[1] === "create")).toHaveLength(1);
    expect(posted.at(-1)?.text).toBe("Also done.");
  });

  it("posts a worker's question and sends the next mention as its answer", async () => {
    const { spawn, calls } = orcaWith([
      { result: { messages: [{ id: "q1", type: "question", body: "Which branch?" }] } },
      { result: { messages: [{ id: "m2", type: "worker_done", body: "Shipped on main." }] } },
    ]);
    const { kit, posted } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    const first = mention("ship it", CONFIG);
    await runtime.run(first.delivery);
    await Promise.all(first.working);
    expect(posted.at(-1)).toMatchObject({ notifyOwner: true });
    expect(posted.at(-1)?.text).toContain("Which branch?");
    expect(runtime.records()[0]).toMatchObject({ status: "question", question: "q1" });

    const answer = mention("main", CONFIG);
    await runtime.run(answer.delivery);
    await Promise.all(answer.working);
    const reply = calls.find((call) => call.args[1] === "reply");
    expect(flag(reply!.args, "--id")).toBe("q1");
    expect(flag(reply!.args, "--body")).toBe("main");
    expect(posted.at(-1)?.text).toBe("Shipped on main.");
  });

  it("tells the owner when the worker stops without reporting", async () => {
    const { spawn } = orcaWith([
      { result: { messages: [{ id: "x1", type: "escalation", body: "", payload: { stopReason: "context limit" } }] } },
    ]);
    const { kit, posted } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    const { delivery, working } = mention("refactor everything", CONFIG);
    await runtime.run(delivery);
    await Promise.all(working);
    expect(posted.at(-1)?.text).toContain("stopped without reporting");
    expect(posted.at(-1)?.text).toContain("context limit");
    expect(runtime.records()[0]?.status).toBe("stopped");
  });

  it("ignores mentions the harness kit does not admit", async () => {
    const { spawn, calls } = orcaWith([]);
    const { kit, posted } = fakeKit(undefined);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    let ignored = false;
    const { delivery } = mention("delete the repo", CONFIG);
    await runtime.run({ ...delivery, ignored: () => { ignored = true; } });
    expect(ignored).toBe(true);
    expect(calls).toHaveLength(0);
    expect(posted).toHaveLength(0);
  });

  it("asks for a repository before starting anything", async () => {
    const { spawn, calls } = orcaWith([]);
    const { kit, posted } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    const { delivery, working } = mention("do a thing", { agent: "claude" });
    await runtime.run(delivery);
    await expect(working[0]).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/repository/) });
    expect(calls).toHaveLength(0);
    expect(posted[0]).toMatchObject({ notifyOwner: true });
    expect(posted[0]?.text).toContain("Choose the Orca repository");
  });

  it("uses the repository's checkout when placement is main", async () => {
    const { spawn, calls } = orcaWith([{ result: { messages: [{ id: "m", type: "worker_done", body: "ok" }] } }]);
    const { kit } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    const { delivery, working } = mention("check the build", { ...CONFIG, placement: "main", keepOpen: false });
    await runtime.run(delivery);
    await Promise.all(working);
    const start = calls.find((call) => call.args[1] === "worker-start");
    expect(flag(start!.args, "--worktree")).toBe("path:/code/shop");
    expect(start!.args).not.toContain("--keep-open");
    expect(start!.args).not.toContain("new-top-level");
  });

  it("makes a new mailbox when the saved one has gone", async () => {
    const storage = memoryStorage();
    storage.setItem(MAILBOXES_KEY, JSON.stringify({ "/code/shop": "term_old" }));
    const { spawn, calls } = orcaWith(
      [{ result: { messages: [{ id: "m", type: "worker_done", body: "ok" }] } }],
      (args) =>
        args[0] === "terminal" && args[1] === "show"
          ? { error: { code: "terminal_not_found", message: "gone" } }
          : undefined,
    );
    const { kit } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), storage);
    const { delivery, working } = mention("hello", CONFIG);
    await runtime.run(delivery);
    await Promise.all(working);
    expect(calls.some((call) => call.args[0] === "terminal" && call.args[1] === "create")).toBe(true);
    expect(JSON.parse(storage.getItem(MAILBOXES_KEY) ?? "{}")["/code/shop"]).toBe("term_mail");
  });

  it("stops the worker on the owner's Stop", async () => {
    const { spawn, calls } = orcaWith([]); // the check waits until killed
    const { kit, posted } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    let stop: (() => Promise<void>) | undefined;
    const { delivery, working } = mention("long job", CONFIG);
    await runtime.run({ ...delivery, interruptible: (fn) => { stop = fn; } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.following(delivery.agent.key, THREAD.key)).toBe(true);
    await stop?.();
    await Promise.all(working);
    expect(calls.some((call) => call.args[1] === "worker-stop" && flag(call.args, "--dispatch") === "ctx_1")).toBe(true);
    expect(posted.at(-1)?.text).toBe("Stopped the Orca worker.");
    expect(runtime.records()[0]?.status).toBe("stopped");
  });
});
