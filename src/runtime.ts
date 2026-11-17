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
  RelayEvent,
} from "./buzz";
import {
  type Attachment,
  type Files,
  escapeMentions,
  readAttachments,
  refusedText,
  splitAttachments,
  workspaceDir,
} from "./attachments";
import { launchChoice } from "./choices";
import { type Conversation, contextText, readConversation } from "./context";
import { attachedText, saveMedia } from "./media";
import { type Message, type Orca, OrcaError, type Repo } from "./orca";
import { type Config, config, repoSelector } from "./settings";
import {
  followUpText,
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
/** The mail a wait takes: a message for the conversation, or a report, a
 * question or a stop, which end the turn. */
export const WAKE = ["status", "worker_done", "question", "escalation"] as const;
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
  /** The newest conversation message (seconds) the worker has been shown. */
  seen?: number;
  /** The worker's open question, answered by the next mention. */
  question?: string;
  error?: string;
  startedAt: number;
  updatedAt: number;
}>;

type Live = { agent: AgentHandle; conversation: HarnessConversation; event: RelayEvent };
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
    /** The host's file access, for files workers attach. */
    private readonly files?: Files,
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
    this.live.set(id, { agent, conversation, event });
    const resumed = trigger.type === "mention" && "resumed" in trigger && !!trigger.resumed;
    // Handing over is one at a time per conversation; waiting for the worker
    // is not, so a follow-up reaches Orca while the worker is still busy.
    const handed = this.exclusive(id, () =>
      this.turn(id, delivery, settings, conversation, event, resumed),
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
    event: RelayEvent,
    resumed: boolean,
  ) {
    const existing = this.record(id);
    const open = existing && (existing.status === "working" || existing.status === "question");
    try {
      if (existing && resumed && open) {
        // The app closed while this turn was working: keep waiting for it.
        return;
      }
      // What was said since the worker last heard from the conversation, as
      // Buzz's own harnesses show a session the messages it hasn't seen.
      const said = await readConversation(delivery.agent, conversation, event, existing?.seen ?? 0);
      const { request, context } = await this.shown(delivery, said);
      if (existing?.status === "question" && existing.question) {
        delivery.step?.("orca", "answer");
        await this.orca.reply(
          {
            from: existing.mailbox,
            run: existing.run,
            id: existing.question,
            body: followUpText({ request, from: said.from, context }),
          },
          this.lifetime.signal,
        );
        this.update(id, { status: "working", question: undefined, error: undefined, seen: said.latest });
      } else if (existing) {
        delivery.step?.("orca", "follow-up");
        try {
          await this.orca.send(
            {
              from: existing.mailbox,
              run: existing.run,
              dispatch: existing.dispatch,
              subject: `Message from ${said.from}`,
              body: followUpText({ request, from: said.from, context }),
            },
            this.lifetime.signal,
          );
          this.update(id, { status: "working", error: undefined, seen: said.latest });
        } catch (error) {
          if (error instanceof OrcaError && error.code === "missing") throw error;
          await this.say(
            id,
            `The earlier Orca worker could not be reached (${errorText(error)}), so a new one is starting.`,
          );
          // A new worker is shown the whole conversation.
          const all = await readConversation(delivery.agent, conversation, event, 0);
          const shown = await this.shown(delivery, all);
          await this.start(id, delivery, settings, conversation, event, shown.request, all.from, shown.context, all.latest, all.request);
        }
      } else {
        await this.start(id, delivery, settings, conversation, event, request, said.from, context, said.latest, said.request);
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

  /** What the worker is shown of `said`: the request and the conversation,
   * with the files they attach saved where the worker can open them. */
  private async shown(delivery: Delivery<unknown>, said: Conversation) {
    const groups = [said.requestFiles, ...[...said.messages].reverse().map((item) => item.files)];
    if (groups.some((group) => group.length)) delivery.step?.("orca", "files");
    const files = await saveMedia(delivery.agent, groups);
    return {
      request: [said.request, attachedText(said.requestFiles, files)].filter(Boolean).join("\n\n"),
      context: contextText(said.messages, files),
    };
  }

  private async start(
    id: string,
    delivery: Delivery<unknown>,
    settings: Config,
    conversation: HarnessConversation,
    event: RelayEvent,
    request: string,
    from: string,
    context: string,
    seen: number,
    /** The request's own words, for its title. */
    text: string,
  ) {
    if (!request) throw new Error("The message has no request in it.");
    const signal = this.lifetime.signal;
    delivery.step?.("orca", "repository");
    // With no repository chosen (an agent switched to this type keeps none),
    // the agent uses Orca's first one and says so, rather than refusing.
    const selector = repoSelector(settings.repo);
    let repo: Repo;
    let fallback = false;
    if (selector) repo = await this.orca.repo(selector, signal);
    else {
      const [first] = await this.orca.repos(signal);
      if (!first) throw new Error("Orca has no repositories. Add one in Orca, then try again.");
      repo = first;
      fallback = true;
    }
    const mailbox = await this.mailbox(repo, signal);
    const title = taskTitle(text || "Files from Buzz");
    const run = await this.orca.runCreate(mailbox, `Buzz: ${title}`, signal);
    const name = workspaceName(title, conversation.root ?? event.id);
    delivery.step?.("orca", "worker");
    const started = await this.orca.workerStart(
      {
        from: mailbox,
        run,
        spec: workerSpec({
          request,
          from,
          where: conversation.where,
          agentName: delivery.agent.name,
          instructions: settings.instructions,
          context,
        }),
        title,
        agent: settings.agent,
        placement: placementArgs(settings, repo, name),
        ...launchChoice(
          settings.agent,
          delivery.model || settings.model,
          delivery.effort || settings.effort,
        ),
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
      seen,
      startedAt: now,
      updatedAt: now,
    });
    // Like Buzz's own agents, it says nothing until the worker does, except
    // when it had to pick the repository itself.
    if (fallback)
      await this.say(
        id,
        `No repository is set for this agent, so this runs in ${repo.displayName || repo.path}. Choose another in its Settings.`,
      );
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
    // Its `Attach: <path>` lines name files to post with the message.
    const { text: body, paths } = splitAttachments(message.body ?? "");
    if (message.type === "status") {
      // A message the worker posts while it works; the turn goes on.
      const text = body || (message.subject ?? "").trim();
      if (text || paths.length) await this.say(id, text, false, paths);
      return false;
    }
    if (message.type === "worker_done") {
      this.update(id, { status: "done", ...(dispatch && { dispatch }) });
      await this.say(id, reportText(body || (message.subject ?? ""), message.payload?.outcome), false, paths);
      return true;
    }
    if (message.type === "question") {
      this.update(id, { status: "question", question: message.id, ...(dispatch && { dispatch }) });
      await this.say(id, questionText(body || (message.subject ?? "")), true, paths);
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

  /** Posts `text` as the agent, with the files at `paths` attached. */
  private async say(id: string, text: string, notifyOwner = false, paths: readonly string[] = []) {
    const live = this.live.get(id);
    if (!live) return;
    let note = "";
    if (paths.length) {
      const record = this.record(id);
      const { attached, refused } =
        this.files && this.kit.tools && record
          ? await readAttachments(this.files, workspaceDir(record.workspace, record.repo), paths)
          : { attached: [], refused: paths.map((path) => ({ path, reason: "this version of Buzz can't attach files" })) };
      note = refusedText(refused);
      if (attached.length) {
        const failed = await this.send(live, [text, note].filter(Boolean).join("\n\n"), attached, notifyOwner);
        if (!failed) return;
        note = refusedText([...refused, ...attached.map(({ path }) => ({ path, reason: failed }))]);
      }
    }
    const posted = [text, note].filter(Boolean).join("\n\n");
    if (!posted) return;
    await this.kit
      .reply(live.agent, live.conversation, posted, notifyOwner ? { notifyOwner } : undefined)
      .catch(() => undefined);
  }

  /** Posts a message with files through Buzz's own `send` tool, as Buzz's
   * Claude agent does: it uploads each file as the agent and attaches it.
   * Resolves with why it failed, or undefined once posted. */
  private async send(live: Live, text: string, attached: readonly Attachment[], notifyOwner: boolean) {
    // `send` reads each file by the path it is given; its last part is the
    // name the message shows.
    const files = new Map(attached.map((file, index) => [`${index}/${file.name}`, file.data]));
    const handler = this.kit.tools!(live.agent, live.conversation, {
      read: async (path) => {
        const data = files.get(path);
        if (!data) throw new Error(`Not an attachment: ${path}`);
        return data;
      },
    });
    const { conversation, event } = live;
    try {
      const answer = (await handler({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "send",
          arguments: {
            ...(text && { text: escapeMentions(text) }),
            files: [...files.keys()],
            audience: "everyone",
            // Where `kit.reply` posts: in the mention's thread, unless the
            // conversation is the thread, which `send` replies in already,
            // or stays at the top level.
            ...(!conversation.topLevel && !conversation.root && { reply: event.id }),
            ...(notifyOwner && { mentions: [live.agent.owner] }),
          },
        },
      })) as {
        result?: { isError?: boolean; content?: { text?: string }[] };
        error?: { message?: string };
      };
      if (answer?.error) return answer.error.message ?? "Buzz refused the message";
      if (!answer?.result) return "Buzz gave no answer";
      if (answer.result.isError) return answer.result.content?.[0]?.text ?? "Buzz refused the message";
      return undefined;
    } catch (error) {
      return errorText(error);
    }
  }

  dispose() {
    this.lifetime.abort();
    for (const waiter of this.waiters.values()) waiter.abort.abort();
    this.waiters.clear();
    this.listeners.clear();
  }
}
