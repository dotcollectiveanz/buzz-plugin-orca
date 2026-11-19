import { describe, expect, it } from "vitest";
import { beforeEach } from "vitest";
import { type Answer, attached, chat, fakeFiles, fakeKit, fakeMedia, fakeOrca, memoryStorage, mention, PNG, profile, relay, TEXT, THREAD } from "./fake";
import { Orca } from "./orca";
import { MAILBOXES_KEY, OrcaRuntime, QUIET_MS } from "./runtime";

const REPO = { id: "repo-1", path: "/code/shop", displayName: "shop" };
const CONFIG = { repo: "shop", agent: "claude" };

/** Orca with one repo, a mailbox, and mail given by `mail` per waiting
 * check; a check that doesn't wait takes `queued`, else finds none. */
function orcaWith(
  mail: Answer[],
  extra: (args: string[]) => Answer | undefined = () => undefined,
  queued: Answer[] = [],
) {
  return fakeOrca((args) => {
    const found = extra(args);
    if (found) return found;
    const [a, b] = args;
    if (a === "repo" && b === "show") return { result: { repo: REPO } };
    if (a === "repo" && b === "list") return { result: { repos: [REPO] } };
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
    if (b === "check" && !args.includes("--wait")) return queued.shift() ?? { result: { messages: [] } };
    if (b === "check") return mail.shift() ?? { wait: true };
    if (b === "send" || b === "reply" || b === "worker-stop") return { result: {} };
    return { error: { code: "unknown", message: args.join(" ") } };
  });
}

const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

describe("OrcaRuntime", () => {
  beforeEach(() => {
    relay.events = [];
    relay.queries = [];
  });

  it("shows a new worker the conversation so far, with names, like Buzz's own agents", async () => {
    relay.events = [
      profile("ownerpub", "Oscar"),
      profile("annpub", "Ann"),
      chat(THREAD.root!, "annpub", 900, "The checkout button is broken on mobile"),
      chat("own", "agentpub", 950, "an earlier reply of the agent's own"),
      chat("later", "annpub", 2_000, "sent after the mention"),
    ];
    const { spawn, calls } = orcaWith([{ result: { messages: [{ id: "m", type: "worker_done", body: "ok" }] } }]);
    const { kit } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    const { delivery, working } = mention("nostr:npub1x can you fix this?", CONFIG);
    await runtime.run(delivery);
    await Promise.all(working);
    const spec = calls.find((call) => call.args[1] === "worker-start")!.input;
    expect(spec).toContain("Oscar asked the Buzz agent");
    expect(spec).toContain("Ann (");
    expect(spec).toContain("The checkout button is broken on mobile");
    expect(spec).toContain("The request from Oscar:\n\ncan you fix this?");
    expect(spec).not.toContain("an earlier reply of the agent's own");
    expect(spec).not.toContain("sent after the mention");
    expect(spec).toContain("orca orchestration send --type status");
    expect(relay.queries[0]).toContainEqual(expect.objectContaining({ "#e": [THREAD.root] }));
    expect(runtime.records()[0]?.seen).toBe(1_000);
  });

  it("sends a follow-up only what was said since the worker last heard", async () => {
    const { spawn, calls } = orcaWith([
      { result: { messages: [{ id: "m1", type: "worker_done", body: "Done." }] } },
      { result: { messages: [{ id: "m2", type: "worker_done", body: "Again." }] } },
    ]);
    const { kit } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    relay.events = [chat("old", "annpub", 500, "old news")];
    const first = mention("first ask", CONFIG, { id: "a".repeat(64), at: 1_000 });
    await runtime.run(first.delivery);
    await Promise.all(first.working);
    relay.events.push(chat("between", "annpub", 1_500, "a note in between"));
    const second = mention("second ask", CONFIG, { id: "b".repeat(64), at: 2_000 });
    await runtime.run(second.delivery);
    await Promise.all(second.working);
    const body = flag(calls.find((call) => call.args[1] === "send")!.args, "--body");
    expect(body).toContain("a note in between");
    expect(body).not.toContain("old news");
    expect(body).toContain("New message from the owner:\n\nsecond ask");
    expect(runtime.records()[0]?.seen).toBe(2_000);
  });

  it("posts the worker's messages as it works, then its reply", async () => {
    const { spawn } = orcaWith([
      { result: { messages: [{ id: "s1", type: "status", subject: "Looking", body: "Found the bug in cart.liquid." }] } },
      { result: { messages: [{ id: "h", type: "heartbeat" }, { id: "s2", type: "status", subject: "Tests running" }] } },
      { result: { messages: [{ id: "m", type: "worker_done", body: "Fixed and tested." }] } },
    ]);
    const { kit, posted } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    const { delivery, working } = mention("fix the cart", CONFIG);
    await runtime.run(delivery);
    await Promise.all(working);
    expect(posted.map((post) => post.text)).toEqual([
      "Found the bug in cart.liquid.",
      "Tests running",
      "Fixed and tested.",
    ]);
    expect(runtime.records()[0]?.status).toBe("done");
  });

  it("still starts when the conversation can't be read", async () => {
    const { spawn, calls } = orcaWith([{ result: { messages: [{ id: "m", type: "worker_done", body: "ok" }] } }]);
    const { kit } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    const { delivery, working } = mention("go", CONFIG);
    await runtime.run({ ...delivery, agent: { ...delivery.agent, query: async () => { throw new Error("offline"); } } });
    await Promise.all(working);
    expect(calls.some((call) => call.args[1] === "worker-start")).toBe(true);
  });

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
    expect(flag(check!.args, "--types")).toBe("status,worker_done,question,escalation");
    expect(start!.env?.ORCA_TERMINAL_HANDLE).toBeNull();

    // Like Buzz's own agents, it posts nothing of its own: only the reply.
    expect(posted.map((post) => post.text)).toEqual(["Fixed the header."]);
    expect(JSON.parse(storage.getItem(MAILBOXES_KEY) ?? "{}")).toEqual({ "/code/shop": "term_mail" });
    expect(runtime.records()[0]).toMatchObject({ status: "done", run: "run_1", dispatch: "ctx_1" });
  });

  it("runs a remote agent's worker, mailbox and follow-ups on its Orca server", async () => {
    const { spawn, calls } = orcaWith([
      { result: { messages: [{ id: "m1", type: "worker_done", body: "Done." }] } },
      { result: { messages: [{ id: "m2", type: "worker_done", body: "Also done." }] } },
    ]);
    const { kit } = fakeKit(THREAD);
    const storage = memoryStorage();
    const runtime = new OrcaRuntime(kit, new Orca(spawn), storage);
    const remote = { ...CONFIG, host: "GCP build-loop" };
    const first = mention("build the header", remote);
    await runtime.run(first.delivery);
    await Promise.all(first.working);
    // A later change of host doesn't move the conversation's worker.
    const second = mention("now the footer", CONFIG);
    await runtime.run(second.delivery);
    await Promise.all(second.working);

    for (const call of calls) expect(flag(call.args, "--environment")).toBe("GCP build-loop");
    expect(calls.map((call) => call.args[1])).toEqual(
      expect.arrayContaining(["show", "create", "run-create", "worker-start", "check", "send"]),
    );
    expect(JSON.parse(storage.getItem(MAILBOXES_KEY) ?? "{}")).toEqual({ "GCP build-loop|/code/shop": "term_mail" });
    expect(runtime.records()[0]).toMatchObject({ host: "GCP build-loop", status: "done" });
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
    expect(flag(send!.args, "--body")).toContain("New message from the owner:\n\nnow make it green");
    // The mailbox is reused while its terminal is live.
    expect(calls.filter((call) => call.args[0] === "terminal" && call.args[1] === "create")).toHaveLength(1);
    expect(posted.at(-1)?.text).toBe("Also done.");
  });

  it("tags whoever questions go to, and the owner for a stop", async () => {
    const to = "b".repeat(64);
    const { spawn } = orcaWith([
      { result: { messages: [{ id: "q1", type: "question", body: "Which branch?" }] } },
    ]);
    const { kit, posted, sent } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    const first = mention("ship it", { ...CONFIG, questionsTo: to });
    await runtime.run(first.delivery);
    await Promise.all(first.working);
    expect(sent.at(-1)?.args).toMatchObject({ mentions: [to] });
    expect(sent.at(-1)?.args.text).toContain("Which branch?");
    expect(sent.at(-1)?.args).not.toHaveProperty("files");
    expect(posted.some((post) => post.text.includes("Which branch?"))).toBe(false);
  });

  it("tags the owner when the question can't tag whoever it goes to", async () => {
    const { spawn } = orcaWith([
      { result: { messages: [{ id: "q1", type: "question", body: "Which branch?" }] } },
    ]);
    const { kit, posted } = fakeKit(THREAD, { refuse: "not a member" });
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    const first = mention("ship it", { ...CONFIG, questionsTo: "c".repeat(64) });
    await runtime.run(first.delivery);
    await Promise.all(first.working);
    expect(posted.at(-1)).toMatchObject({ notifyOwner: true });
    expect(posted.at(-1)?.text).toContain("Which branch?");
    expect(posted.at(-1)?.text).toContain("not a member");
  });

  it("still tags the owner when a worker stops, whoever questions go to", async () => {
    const { spawn } = orcaWith([
      { result: { messages: [{ id: "e1", type: "escalation", body: "Stuck.", payload: { stopReason: "errored" } }] } },
    ]);
    const { kit, posted, sent } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    const first = mention("ship it", { ...CONFIG, questionsTo: "d".repeat(64) });
    await runtime.run(first.delivery);
    await Promise.all(first.working);
    expect(sent).toHaveLength(0);
    expect(posted.at(-1)).toMatchObject({ notifyOwner: true });
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
    expect(flag(reply!.args, "--body")).toContain("main");
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

  it("uses Orca's first repository when none is set, and says so", async () => {
    const { spawn, calls } = orcaWith([{ result: { messages: [{ id: "m", type: "worker_done", body: "ok" }] } }]);
    const { kit, posted } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    const { delivery, working } = mention("do a thing", { agent: "claude" });
    await runtime.run(delivery);
    await Promise.all(working);
    expect(calls.some((call) => call.args[0] === "repo" && call.args[1] === "show")).toBe(false);
    expect(flag(calls.find((call) => call.args[1] === "worker-start")!.args, "--repo")).toBe("id:repo-1");
    expect(posted[0]?.text).toContain("No repository is set for this agent, so this runs in shop");
  });

  it("says when Orca has no repositories", async () => {
    const { spawn } = orcaWith([], (args) =>
      args[0] === "repo" && args[1] === "list" ? { result: { repos: [] } } : undefined,
    );
    const { kit, posted } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    const { delivery, working } = mention("do a thing", { agent: "claude" });
    await runtime.run(delivery);
    await expect(working[0]).resolves.toMatchObject({ ok: false });
    expect(posted[0]).toMatchObject({ notifyOwner: true });
    expect(posted[0]?.text).toContain("Orca has no repositories");
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

describe("background work and prompts", () => {
  beforeEach(() => {
    relay.events = [];
    relay.queries = [];
  });

  const mail = (...messages: object[]): Answer => ({ result: { messages } });
  const stop = (reason: string, body = "") => ({ id: `x-${reason}`, type: "escalation", body, payload: { stopReason: reason } });
  const FINISHED_BODY = [
    "Worker term_w ended its turn without sending worker_done for task task_1.",
    "The Dispatch is still open. Answer it with your Orca CLI's `orchestration send --to dispatch:ctx_1 --subject \"<topic>\" --body \"<guidance>\"`, retry it, or stop the worker.",
    "If it is idle on purpose, leave it: its later idle turns are not reported until you write to it.",
    "Last output:",
    "Waiting on the release review.",
    "Full output: orchestration worker-read --dispatch ctx_1",
  ].join("\n");

  async function turn(answers: Answer[], show: Answer = { result: {} }, config: object = CONFIG) {
    const { spawn, calls } = orcaWith(answers, (args) => (args[1] === "worker-show" ? show : undefined));
    const { kit, posted, sent } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    const { delivery, working } = mention("review and merge", config);
    await runtime.run(delivery);
    await Promise.all(working);
    return { calls, posted, sent, runtime };
  }

  it("keeps following a worker that ends its turn, nudges it once, and posts its later report", async () => {
    const { calls, posted, runtime } = await turn([
      mail(stop("finished", FINISHED_BODY)),
      mail({ id: "s", type: "status", body: "Waiting on the release review." }),
      mail(stop("finished", FINISHED_BODY)),
      mail({ id: "d", type: "worker_done", body: "Review clean, merged #405." }),
    ]);
    const sends = calls.filter((call) => call.args[1] === "send");
    expect(sends).toHaveLength(1);
    expect(flag(sends[0]!.args, "--to")).toBe("dispatch:ctx_1");
    expect(flag(sends[0]!.args, "--body")).toContain("send a `status` saying what you are waiting on");
    expect(posted.map((post) => post.text)).toEqual(["Waiting on the release review.", "Review clean, merged #405."]);
    expect(posted.some((post) => post.notifyOwner)).toBe(false);
    expect(runtime.records()[0]?.status).toBe("done");
  });

  it("nudges once even after an early status, then stays quiet while the worker says what it waits on", async () => {
    const { calls, posted } = await turn([
      mail({ id: "s1", type: "status", body: "On it." }, stop("finished", FINISHED_BODY)),
      mail({ id: "s2", type: "status", body: "Running 11 subagents." }, stop("finished", FINISHED_BODY)),
      mail({ id: "d", type: "worker_done", body: "All 11 done." }),
    ]);
    expect(calls.filter((call) => call.args[1] === "send")).toHaveLength(1);
    expect(posted.map((post) => post.text)).toEqual(["On it.", "Running 11 subagents.", "All 11 done."]);
  });

  it("posts every message of a batch, and a report from an older dispatch ends nothing", async () => {
    const { spawn } = orcaWith(
      [
        mail({ id: "d1", type: "worker_done", body: "First done.", payload: { dispatchId: "ctx_1" } }, { id: "s0", type: "status", body: "Also, one note." }),
        mail({ id: "d1b", type: "worker_done", body: "Late report for the first.", payload: { dispatchId: "ctx_1" } }),
        mail({ id: "d2", type: "worker_done", body: "Second done.", payload: { dispatchId: "ctx_2" } }),
      ],
      (args) => (args[1] === "send" ? { result: { dispatchId: "ctx_2", delivery: "started_fresh" } } : undefined),
    );
    const { kit, posted } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    const first = mention("first", CONFIG, { id: "a".repeat(64), at: 1_000 });
    await runtime.run(first.delivery);
    await Promise.all(first.working);
    const second = mention("second", CONFIG, { id: "b".repeat(64), at: 2_000 });
    await runtime.run(second.delivery);
    await Promise.all(second.working);
    expect(posted.map((post) => post.text)).toEqual(["First done.", "Also, one note.", "Late report for the first.", "Second done."]);
    expect(runtime.records()[0]).toMatchObject({ status: "done", dispatch: "ctx_2", older: ["ctx_1"] });
  });

  it("keeps the day's cut-off after the worker posts a status", async () => {
    let clock = 0;
    let checks = 0;
    const { spawn } = orcaWith(
      [mail(stop("finished")), mail({ id: "s", type: "status", body: "Still waiting on CI." }), mail()],
      (args) => {
        if (args[1] === "check" && ++checks === 3) clock += QUIET_MS;
        return undefined;
      },
    );
    const { kit, posted } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage(), () => clock);
    const { delivery, working } = mention("watch CI", CONFIG);
    await runtime.run(delivery);
    await Promise.all(working);
    expect(posted.at(-1)?.text).toContain("said nothing for 24 hours");
    expect(runtime.records()[0]?.status).toBe("stopped");
  });

  it("posts the last output, untagged, when a nudged worker ends its turn silently again", async () => {
    const { calls, posted, runtime } = await turn([
      mail(stop("finished", FINISHED_BODY)),
      mail(stop("finished", FINISHED_BODY)),
      mail({ id: "d", type: "worker_done", body: "Done." }),
    ]);
    expect(calls.filter((call) => call.args[1] === "send")).toHaveLength(1);
    expect(posted.map((post) => post.text)).toEqual(["Waiting on the release review.", "Done."]);
    expect(posted.some((post) => /orchestration|Orca CLI|worker-read/.test(post.text))).toBe(false);
    expect(runtime.records()[0]?.status).toBe("done");
  });

  it("stays quiet on a needs-input stop when Orca finds no prompt", async () => {
    const { calls, posted, sent } = await turn([
      mail(stop("needs-input", "Worker term_w is stopped at a prompt that needs a person.")),
      mail({ id: "d", type: "worker_done", body: "Shipped." }),
    ], { result: { observation: { status: "live", agentWait: null } } });
    const show = calls.find((call) => call.args[1] === "worker-show")!.args;
    expect(flag(show, "--dispatch")).toBe("ctx_1");
    expect(show).toContain("--full");
    expect(sent).toHaveLength(0);
    expect(posted.map((post) => post.text)).toEqual(["Shipped."]);
  });

  it("marks a worker waiting on background work while it's followed", async () => {
    const { spawn } = orcaWith([mail(stop("needs-input"))], (args) =>
      args[1] === "worker-show" ? { result: { observation: { agentWait: null } } } : undefined,
    );
    const runtime = new OrcaRuntime(fakeKit(THREAD).kit, new Orca(spawn), memoryStorage());
    const { delivery } = mention("loop over the backlog", CONFIG);
    await runtime.run(delivery);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runtime.following(delivery.agent.key, THREAD.key)).toBe(true);
    expect(runtime.records()[0]).toMatchObject({ status: "working", waiting: "background" });
    runtime.dispose();
  });

  it("tags whoever questions go to, once, when the worker really waits at a prompt", async () => {
    const to = "b".repeat(64);
    const body = "Worker term_w is stopped at a prompt that needs a person.\nLast output:\nAllow edits to .env? (y/n)\nFull output: orchestration worker-read --dispatch ctx_1";
    const { sent, posted, runtime } = await turn(
      [
        mail(stop("needs-input", body)),
        mail(stop("needs-input", body)),
        mail({ id: "d", type: "worker_done", body: "Done after approval." }),
      ],
      { result: { observation: { agentWait: { reason: "permission-request", source: "hook" } } } },
      { ...CONFIG, questionsTo: to },
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.args).toMatchObject({ mentions: [to] });
    expect(sent[0]!.args.text).toContain("waiting at a prompt in its terminal");
    expect(sent[0]!.args.text).toContain("> Allow edits to .env? (y/n)");
    expect(sent[0]!.args.text).not.toContain("worker-read");
    expect(posted.map((post) => post.text)).toEqual(["Done after approval."]);
    expect(runtime.records()[0]?.status).toBe("done");
  });

  it("says a prompt is unconfirmed when Orca couldn't look", async () => {
    const { posted } = await turn(
      [mail(stop("needs-input")), mail({ id: "d", type: "worker_done", body: "ok" })],
      { result: { observation: { status: "live" } } },
    );
    expect(posted[0]).toMatchObject({ notifyOwner: true });
    expect(posted[0]?.text).toContain("may be waiting at a prompt");
    expect(posted.at(-1)?.text).toBe("ok");
  });

  it("names the stop in plain words, without Orca's CLI instructions", async () => {
    const { posted } = await turn([mail(stop("errored", FINISHED_BODY.replace("ended its turn", "ended its turn on an error")))]);
    const text = posted.at(-1)?.text ?? "";
    expect(text).toContain("stopped without reporting**: it hit an error.");
    expect(text).toContain("> Waiting on the release review.");
    expect(text).toContain("tag @Orca Agent");
    expect(text).not.toMatch(/orchestration|Orca CLI|Dispatch is still open/);
  });

  it("posts a question left from an earlier turn untagged, and answers it with the new message", async () => {
    const { spawn, calls } = orcaWith(
      [mail({ id: "d1", type: "worker_done", body: "First done." }), mail({ id: "d2", type: "worker_done", body: "Second done." })],
      undefined,
      [mail({ id: "q9", type: "question", body: "Also: staging or prod?" })],
    );
    const { kit, posted, sent } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    const first = mention("first", { ...CONFIG, questionsTo: "b".repeat(64) }, { id: "a".repeat(64), at: 1_000 });
    await runtime.run(first.delivery);
    await Promise.all(first.working);
    const second = mention("staging", CONFIG, { id: "b".repeat(64), at: 2_000 });
    await runtime.run(second.delivery);
    await Promise.all(second.working);
    expect(sent).toHaveLength(0);
    expect(posted[1]).toMatchObject({ notifyOwner: false });
    expect(posted[1]?.text).toContain("Your new message is being sent to it as the answer.");
    expect(flag(calls.find((call) => call.args[1] === "reply")!.args, "--id")).toBe("q9");
  });

  it("posts mail left from an earlier turn before sending a follow-up", async () => {
    const { spawn, calls } = orcaWith(
      [mail({ id: "m1", type: "escalation", payload: { stopReason: "exited" } }), mail({ id: "m3", type: "worker_done", body: "Second done." })],
      undefined,
      [mail({ id: "m2", type: "worker_done", body: "Late report from the first turn." }), mail(stop("finished"))],
    );
    const { kit, posted } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage());
    const first = mention("first", CONFIG, { id: "a".repeat(64), at: 1_000 });
    await runtime.run(first.delivery);
    await Promise.all(first.working);
    const second = mention("second", CONFIG, { id: "b".repeat(64), at: 2_000 });
    await runtime.run(second.delivery);
    await Promise.all(second.working);
    const order = calls.map((call) => `${call.args[1]}${call.args.includes("--wait") ? ":wait" : ""}`);
    expect(order.indexOf("check")).toBeLessThan(order.indexOf("send"));
    expect(posted.map((post) => post.text).slice(1)).toEqual(["Late report from the first turn.", "Second done."]);
  });

  it("stops following a worker that stays silent for a day after ending its turn", async () => {
    let clock = 0;
    let checks = 0;
    const { spawn } = orcaWith(
      [mail({ id: "s", type: "status", body: "Waiting on CI." }, stop("finished")), mail()],
      (args) => {
        if (args[1] === "check" && ++checks === 2) clock += QUIET_MS;
        return undefined;
      },
    );
    const { kit, posted } = fakeKit(THREAD);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage(), () => clock);
    const { delivery, working } = mention("watch CI", CONFIG);
    await runtime.run(delivery);
    await Promise.all(working);
    expect(posted.at(-1)?.text).toContain("said nothing for 24 hours");
    expect(posted.at(-1)?.notifyOwner).toBe(false);
    expect(runtime.records()[0]?.status).toBe("stopped");
  });

  it("tells the worker never to end a turn silently or use question forms", async () => {
    const { calls } = await turn([mail({ id: "d", type: "worker_done", body: "ok" })]);
    const spec = calls.find((call) => call.args[1] === "worker-start")!.input;
    expect(spec).toContain("Never end a turn silently");
    expect(spec).toContain("AskUserQuestion");
  });
});

describe("attachments", () => {
  beforeEach(() => {
    relay.events = [];
    relay.queries = [];
  });

  const FILES = { "/code/shop-wt/shots/home.png": PNG, "/code/shop-wt/shots/cart.png": PNG, "/code/shop-wt/.env": TEXT };
  const done = (body: string, type = "worker_done") => ({ result: { messages: [{ id: "m", type, subject: "Done", body }] } });

  async function turn(
    mail: Answer[],
    options: Readonly<{ files?: boolean; tools?: boolean; refuse?: string; conversation?: typeof THREAD }> = {},
  ) {
    const { spawn, calls } = orcaWith(mail);
    const { kit, posted, sent } = fakeKit(options.conversation ?? THREAD, options);
    const files = options.files === false ? undefined : fakeFiles(FILES);
    const runtime = new OrcaRuntime(kit, new Orca(spawn), memoryStorage(), Date.now, files);
    const { delivery, working } = mention("show me the cart", CONFIG);
    await runtime.run(delivery);
    await Promise.all(working);
    return { posted, sent, calls, runtime };
  }

  it("tells the worker how to attach files", async () => {
    const { calls } = await turn([done("ok")]);
    expect(calls.find((call) => call.args[1] === "worker-start")!.input).toContain("Attach: <path>");
  });

  it("posts the worker's files with its reply through Buzz's send", async () => {
    const { posted, sent, runtime } = await turn([
      done("Here is the cart, @ann.\nAttach: shots/home.png\nAttach: /code/shop-wt/shots/cart.png"),
    ]);
    expect(posted).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.args).toEqual({
      text: "Here is the cart, \\@ann.",
      files: ["0/home.png", "1/cart.png"],
      audience: "everyone",
    });
    expect(sent[0]!.files["0/home.png"]).toBe(PNG);
    expect(sent[0]!.conversation).toBe(THREAD.key);
    expect(runtime.records()[0]?.status).toBe("done");
  });

  it("posts files from status messages as the worker works", async () => {
    const { posted, sent } = await turn([
      { result: { messages: [{ id: "s", type: "status", subject: "Screenshot", body: "Attach: shots/home.png" }] } },
      done("All done."),
    ]);
    expect(sent.map((item) => item.args)).toEqual([
      { text: "Screenshot", files: ["0/home.png"], audience: "everyone" },
    ]);
    expect(posted.map((item) => item.text)).toEqual(["All done."]);
  });

  it("attaches what it may and notes the rest", async () => {
    const { posted, sent } = await turn([done("Report.\nAttach: shots/home.png\nAttach: .env\nAttach: ../../etc/passwd")]);
    expect(posted).toEqual([]);
    expect(sent[0]!.args.files).toEqual(["0/home.png"]);
    expect(sent[0]!.args.text).toBe(
      "Report.\n\n_Some files couldn't be attached:_\n- `.env`: only images, videos and PDFs are attached\n- `../../etc/passwd`: it is outside the worker's workspace",
    );
  });

  it("posts text with a note when no file can be attached", async () => {
    const { posted, sent } = await turn([done("Report.\nAttach: shots/none.png")]);
    expect(sent).toEqual([]);
    expect(posted.map((item) => item.text)).toEqual([
      "Report.\n\n_A file couldn't be attached:_\n- `shots/none.png`: there is no such file",
    ]);
  });

  it("falls back to text when Buzz refuses the message", async () => {
    const { posted, sent } = await turn([done("Report.\nAttach: shots/home.png")], { refuse: "Upload failed: too large" });
    expect(sent).toEqual([]);
    expect(posted.map((item) => item.text)).toEqual([
      "Report.\n\n_A file couldn't be attached:_\n- `shots/home.png`: Upload failed: too large",
    ]);
  });

  it("says so on a Buzz without file access or tools", async () => {
    for (const options of [{ files: false }, { tools: false }]) {
      const { posted } = await turn([done("Report.\nAttach: shots/home.png")], options);
      expect(posted[0]?.text).toContain("`shots/home.png`: this version of Buzz can't attach files");
    }
  });

  it("tags the owner on a question with files, and replies in the mention's thread outside a thread", async () => {
    const channel = { key: "chan", channel: "chan", topLevel: false, where: "#builds" };
    const { sent, runtime } = await turn([done("Which one?\nAttach: shots/home.png", "question")], { conversation: channel });
    expect(sent[0]!.args).toMatchObject({
      files: ["0/home.png"],
      reply: "e".repeat(64),
      mentions: ["ownerpub"],
    });
    expect(sent[0]!.args.text).toContain("**The Orca worker asks:**\n\nWhich one?");
    expect(runtime.records()[0]?.status).toBe("question");
  });
});

describe("files from Buzz", () => {
  beforeEach(() => {
    relay.events = [];
    relay.queries = [];
  });

  const done = { result: { messages: [{ id: "m", type: "worker_done", body: "ok" }] } };

  it("saves the request's files and the unseen messages' and tells a new worker where they are", async () => {
    const mockup = attached("mockup.png");
    const shot = attached("cart-bug.png");
    relay.events = [{ ...chat(THREAD.root!, "annpub", 900, `The cart is broken\n${shot.markdown}`), tags: [shot.tag] }];
    const { media, asked } = fakeMedia();
    const { spawn, calls } = orcaWith([done]);
    const runtime = new OrcaRuntime(fakeKit(THREAD).kit, new Orca(spawn), memoryStorage());
    const { delivery, working } = mention(`Make it match this\n${mockup.markdown}`, CONFIG, { tags: [mockup.tag] });
    const steps: string[] = [];
    await runtime.run({ ...delivery, agent: { ...delivery.agent, media }, step: (_tool, target) => steps.push(target ?? "") });
    await Promise.all(working);
    expect(asked).toEqual([mockup.url, shot.url]);
    expect(steps).toContain("files");
    const start = calls.find((call) => call.args[1] === "worker-start")!;
    expect(flag(start.args, "--task-title")).toBe("Make it match this");
    expect(start.input).toContain(
      "Make it match this\n\nFiles attached to this message (open them from where they are saved; they are only on this computer):\n- `mockup.png` (image/png, 2 KB), saved at /tmp/buzz-agent-media/",
    );
    expect(start.input).toContain("The cart is broken\n  Attached: `cart-bug.png` (image/png, 2 KB), saved at /tmp/buzz-agent-media/");
    expect(start.input).not.toContain("https://media.example");
  });

  it("starts a worker from files with no text", async () => {
    const shot = attached("only.png");
    const { media } = fakeMedia();
    const { spawn, calls } = orcaWith([done]);
    const runtime = new OrcaRuntime(fakeKit(THREAD).kit, new Orca(spawn), memoryStorage());
    const { delivery, working } = mention(`nostr:npub1agent ${shot.markdown}`, CONFIG, { tags: [shot.tag] });
    await runtime.run({ ...delivery, agent: { ...delivery.agent, media } });
    await Promise.all(working);
    const start = calls.find((call) => call.args[1] === "worker-start")!;
    expect(flag(start.args, "--task-title")).toBe("Files from Buzz");
    expect(start.input).toContain("`only.png` (image/png, 2 KB), saved at");
  });

  it("sends a follow-up its files, and names ones it couldn't fetch", async () => {
    const shot = attached("second.png");
    const { media } = fakeMedia({ [shot.url]: "The community refused the media: 403" });
    const { spawn, calls } = orcaWith([done, done]);
    const runtime = new OrcaRuntime(fakeKit(THREAD).kit, new Orca(spawn), memoryStorage());
    const first = mention("first", CONFIG, { id: "a".repeat(64), at: 1_000 });
    await runtime.run(first.delivery);
    await Promise.all(first.working);
    const second = mention(`and this\n${shot.markdown}`, CONFIG, { id: "b".repeat(64), at: 2_000, tags: [shot.tag] });
    await runtime.run({ ...second.delivery, agent: { ...second.delivery.agent, media } });
    await Promise.all(second.working);
    const body = flag(calls.find((call) => call.args[1] === "send")!.args, "--body");
    expect(body).toContain("New message from the owner:\n\nand this\n\nFiles attached to this message");
    expect(body).toContain("`second.png` (image/png, 2 KB), not available: The community refused the media: 403");
  });
});
