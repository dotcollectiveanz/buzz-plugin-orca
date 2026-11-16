// Turns Buzz mentions into Orca workers. The plugin is the coordinator: each
// conversation (a thread, or a whole channel) gets its own Orca Run with one
// supervised worker, and the worker's mail (its report, a question, or a
// stop) is posted back to the conversation as the agent. Later mentions in the
// conversation go to the same worker as follow-ups, or answer its question.
//
// Orca's orchestration needs a terminal to receive workers' mail. Buzz is not
// an Orca terminal, so the plugin opens one quiet "Buzz mailbox" terminal per
// repository and names it with `--from` and `--terminal`.
import type {
  AgentHandle,
  Delivery,
  HarnessConversation,
  HarnessKit,
} from "./buzz";
import { type Message, type Orca, OrcaError, type Repo } from "./orca";
import { type Config, config, repoSelector } from "./settings";
import {
  messageText,
  placementArgs,
  questionText,
  reportText,
  stoppedText,
  taskTitle,
  workerSpec,
  workspaceName,
} from "./spec";

export const RECORDS_KEY = "buzz-plugin-orca.conversations.v1";
export const MAILBOXES_KEY = "buzz-plugin-orca.mailboxes.v1";
/** Records kept, newest first. */
const RECORDS_LIMIT = 200;
/** How long one `check --wait` blocks before it is asked again. */
export const WAIT_MS = 10 * 60_000;
/** The mail that ends a wait: a report, a question, or a stop. */
export const WAKE = ["worker_done", "question", "escalation"] as const;
/** Failed checks in a row before the conversation is told. */
const CHECK_RETRIES = 3;

export type Status = "working" | "question" | "done" | "failed" | "stopped";

export type ConversationRecord = Readonly<{
  /** The agent's key in Buzz. */
  agent: string;
  /** The conversation's key: the channel, or `<channel>/<root>`. */
  key: string;
  channel: string;
  root?: string;
  where: string;
  title: string;
  repo: string;
  mailbox: string;
  run: string;
  dispatch: string;
  workspace?: string;
  terminal?: string;
  status: Status;
  /** The worker's open question, answered by the next mention. */
  question?: string;
  error?: string;
  startedAt: number;
  updatedAt: number;
}>;

type Live = { agent: AgentHandle; conversation: HarnessConversation };
type Waiter = { done: Promise<void>; abort: AbortController };

const recordId = (agent: string, key: string) => `${agent}|${key}`;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function readJson<T>(storage: Storage | undefined, key: string, fallback: T): T {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(storage: Storage | undefined, key: string, value: unknown) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked store only loses the record, not the turn.
  }
}

export class OrcaRuntime {
  private readonly live = new Map<string, Live>();
  private readonly waiters = new Map<string, Waiter>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<() => void>();
  private readonly lifetime = new AbortController();

  constructor(
    private readonly kit: HarnessKit,
    private readonly orca: Orca,
    private readonly storage: Storage | undefined = globalThis.localStorage,
    private readonly now: () => number = Date.now,
  ) {}

  // Records ---------------------------------------------------------------

  records(agent?: string): ConversationRecord[] {
    const all = Object.values(
      readJson<Record<string, ConversationRecord>>(this.storage, RECORDS_KEY, {}),
    );
    return all
      .filter((record) => !agent || record.agent === agent)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private record(id: string): ConversationRecord | undefined {
    return readJson<Record<string, ConversationRecord>>(this.storage, RECORDS_KEY, {})[id];
  }

  private save(id: string, record: ConversationRecord) {
    const all = readJson<Record<string, ConversationRecord>>(this.storage, RECORDS_KEY, {});
    all[id] = record;
    const kept = Object.entries(all)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, RECORDS_LIMIT);
    writeJson(this.storage, RECORDS_KEY, Object.fromEntries(kept));
    this.notify();
    return record;
  }

  private update(id: string, change: Partial<ConversationRecord>) {
    const found = this.record(id);
    if (!found) return undefined;
    const next: Record<string, unknown> = { ...found, ...change, updatedAt: this.now() };
    for (const [name, value] of Object.entries(change))
      if (value === undefined) delete next[name];
    return this.save(id, next as ConversationRecord);
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  /** Whether a conversation's worker is being followed now. */
  following(agent: string, key: string) {
    return this.waiters.has(recordId(agent, key));
  }

  // Turns -----------------------------------------------------------------

  async run(delivery: Delivery<unknown>) {
    const trigger = delivery.trigger;
    const event = trigger.type === "mention" ? trigger.event : undefined;
    const settings = config(delivery.config);
    const conversation = event
      ? await this.kit.conversation(delivery, settings.scope)
      : undefined;
    if (!event || !conversation) {
      delivery.ignored?.();
      return;
    }
    delivery.acknowledged?.();
    const agent = delivery.agent;
    const id = recordId(agent.key, conversation.key);
    this.live.set(id, { agent, conversation });
    const resumed = trigger.type === "mention" && "resumed" in trigger && !!trigger.resumed;
    // Handing over is one at a time per conversation; waiting for the worker
    // is not, so a follow-up reaches Orca while the worker is still busy.
    const handed = this.exclusive(id, () =>
      this.turn(id, delivery, settings, conversation, messageText(event.content), resumed, event.id),
    );
    // Buzz reads `{ ok: false, error }` as a failed request; the turn has
    // already told the conversation why.
    const done = handed
      .then(() => this.follow(id))
      .then(
        () => ({ ok: true }),
        (error: unknown) => ({ ok: false, error: errorText(error) }),
      );
    delivery.workingUntil(done);
    delivery.interruptible?.(() => this.stop(id));
    await handed.catch(() => undefined);
  }

  /** Runs `work` after any earlier turn of the same conversation. */
  private exclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
    const before = this.locks.get(id) ?? Promise.resolve();
    const next = before.catch(() => undefined).then(work);
    const held = next.catch(() => undefined);
    this.locks.set(id, held);
    void held.then(() => {
      if (this.locks.get(id) === held) this.locks.delete(id);
    });
    return next;
  }

  private async turn(
    id: string,
    delivery: Delivery<unknown>,
    settings: Config,
    conversation: HarnessConversation,
    request: string,
    resumed: boolean,
    eventId: string,
  ) {
    const existing = this.record(id);
    const open = existing && (existing.status === "working" || existing.status === "question");
    try {
      if (existing && resumed && open) {
        // The app closed while this turn was working: keep waiting for it.
      } else if (existing?.status === "question" && existing.question) {
        delivery.step?.("orca", "answer");
        await this.orca.reply(
          {
            from: existing.mailbox,
            run: existing.run,
            id: existing.question,
            body: request || "(The owner replied with no text.)",
          },
          this.lifetime.signal,
        );
        this.update(id, { status: "working", question: undefined, error: undefined });
      } else if (existing) {
        delivery.step?.("orca", "follow-up");
        try {
          await this.orca.send(
            {
              from: existing.mailbox,
              run: existing.run,
              dispatch: existing.dispatch,
              subject: taskTitle(request),
              body: request || "(The owner sent no text.)",
            },
            this.lifetime.signal,
          );
          this.update(id, { status: "working", error: undefined });
        } catch (error) {
          if (error instanceof OrcaError && error.code === "missing") throw error;
          await this.say(
            id,
            `The earlier Orca worker could not be reached (${errorText(error)}), so a new one is starting.`,
          );
          await this.start(id, delivery, settings, conversation, request, eventId);
        }
      } else {
        await this.start(id, delivery, settings, conversation, request, eventId);
      }
      const record = this.record(id);
      if (record) delivery.named?.(record.title);
    } catch (error) {
      const message = errorText(error);
      this.update(id, { status: "failed", error: message });
      await this.say(id, `I couldn't hand this to Orca. ${message}`, true);
      throw error;
    }
  }

  private async start(
    id: string,
    delivery: Delivery<unknown>,
    settings: Config,
    conversation: HarnessConversation,
    request: string,
    eventId: string,
  ) {
    if (!request) throw new Error("The message has no request in it.");
    const signal = this.lifetime.signal;
    delivery.step?.("orca", "repository");
    // With no repository chosen (an agent switched to this type keeps none),
    // the agent uses Orca's first one and says so, rather than refusing.
    const selector = repoSelector(settings.repo);
    let chosen = "";
    let repo: Repo;
    if (selector) repo = await this.orca.repo(selector, signal);
    else {
      const [first] = await this.orca.repos(signal);
      if (!first) throw new Error("Orca has no repositories. Add one in Orca, then try again.");
      repo = first;
      chosen = ` No repository is set for this agent, so I used ${first.displayName || first.path}: choose another in its Settings.`;
    }
    const mailbox = await this.mailbox(repo, signal);
    const title = taskTitle(request);
    const run = await this.orca.runCreate(mailbox, `Buzz: ${title}`, signal);
    const name = workspaceName(title, conversation.root ?? eventId);
    delivery.step?.("orca", "worker");
    const started = await this.orca.workerStart(
      {
        from: mailbox,
        run,
        spec: workerSpec({
          request,
          where: conversation.where,
          agentName: delivery.agent.name,
          instructions: settings.instructions,
        }),
        title,
        agent: settings.agent,
        placement: placementArgs(settings, repo, name),
        model: delivery.model || settings.model,
        effort: delivery.effort || settings.effort,
        keepOpen: settings.keepOpen,
      },
      signal,
    );
    const now = this.now();
    this.save(id, {
      agent: delivery.agent.key,
      key: conversation.key,
      channel: conversation.channel,
      ...(conversation.root && { root: conversation.root }),
      where: conversation.where,
      title,
      repo: repo.path,
      mailbox,
      run: started.runId,
      dispatch: started.dispatchId,
      ...(started.workspace && { workspace: started.workspace }),
      ...(started.terminal && { terminal: started.terminal }),
      status: "working",
      startedAt: now,
      updatedAt: now,
    });
    const place =
      settings.placement === "new" ? `a new Orca workspace, \`${name}\`` : `\`${repo.displayName || repo.path}\` in Orca`;
    await this.say(id, `On it: ${settings.agent} is working in ${place}.${chosen}`);
  }

  /** The repository's mailbox terminal, made again when it has gone. */
  private async mailbox(repo: Repo, signal: AbortSignal) {
    const saved = readJson<Record<string, string>>(this.storage, MAILBOXES_KEY, {});
    const known = saved[repo.path];
    if (known && (await this.orca.live(known, signal))) return known;
    const handle = await this.orca.mailbox(`path:${repo.path}`, signal);
    writeJson(this.storage, MAILBOXES_KEY, { ...saved, [repo.path]: handle });
    return handle;
  }

  /** Waits for the conversation's worker to report, ask or stop, and posts
   * what it said. Resolves then, or at once when nothing is open. */
  private follow(id: string): Promise<void> {
    const found = this.waiters.get(id);
    if (found) return found.done;
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, this.lifetime.signal]);
    const done = (async () => {
      let failures = 0;
      while (!signal.aborted) {
        const record = this.record(id);
        if (!record || record.status !== "working") return;
        let messages: readonly Message[];
        try {
          messages = await this.orca.check(
            { terminal: record.mailbox, run: record.run, types: WAKE, timeoutMs: WAIT_MS },
            signal,
          );
          failures = 0;
        } catch (error) {
          if (signal.aborted) return;
          failures += 1;
          if (failures >= CHECK_RETRIES) {
            this.update(id, { status: "failed", error: errorText(error) });
            await this.say(
              id,
              `I lost track of the Orca worker: ${errorText(error)}. It may still be working: open it in Orca, or reply here to try again.`,
              true,
            );
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 2_000 * failures));
          continue;
        }
        for (const message of messages)
          if (await this.deliver(id, message)) return;
      }
    })().finally(() => {
      if (this.waiters.get(id)?.done === done) this.waiters.delete(id);
      this.notify();
    });
    this.waiters.set(id, { done, abort });
    this.notify();
    return done;
  }

  /** Posts one message of the Run's mail. True when the wait is over. */
  private async deliver(id: string, message: Message) {
    const dispatch = message.payload?.dispatchId;
    if (message.type === "worker_done") {
      this.update(id, { status: "done", ...(dispatch && { dispatch }) });
      await this.say(id, reportText(message.body ?? message.subject ?? "", message.payload?.outcome));
      return true;
    }
    if (message.type === "question") {
      this.update(id, { status: "question", question: message.id, ...(dispatch && { dispatch }) });
      await this.say(id, questionText(message.body ?? message.subject ?? ""), true);
      return true;
    }
    if (message.type === "escalation") {
      this.update(id, { status: "stopped", ...(dispatch && { dispatch }) });
      await this.say(id, stoppedText(message.payload?.stopReason, message.body), true);
      return true;
    }
    return false;
  }

  /** The owner's Stop: stops the worker and the wait. */
  private async stop(id: string) {
    const record = this.record(id);
    this.waiters.get(id)?.abort.abort();
    if (!record) return;
    try {
      await this.orca.stop(record.dispatch, this.lifetime.signal);
      this.update(id, { status: "stopped" });
      await this.say(id, "Stopped the Orca worker.");
    } catch (error) {
      this.update(id, { status: "stopped", error: errorText(error) });
      await this.say(id, `Stopped following the Orca worker, but Orca did not confirm it stopped: ${errorText(error)}`, true);
    }
  }

  /** Shows a conversation's worker in Orca. */
  async show(record: ConversationRecord) {
    if (record.workspace) await this.orca.activate(record.workspace);
  }

  private async say(id: string, text: string, notifyOwner = false) {
    const live = this.live.get(id);
    if (!live) return;
    await this.kit
      .reply(live.agent, live.conversation, text, notifyOwner ? { notifyOwner } : undefined)
      .catch(() => undefined);
  }

  dispose() {
    this.lifetime.abort();
    for (const waiter of this.waiters.values()) waiter.abort.abort();
    this.waiters.clear();
    this.listeners.clear();
  }
}
