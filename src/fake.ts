// Test doubles: an Orca CLI answering through a fake `host.spawn`, and the
// parts of Buzz's harness kit the runtime calls. Not bundled (tests only).
import type {
  AgentHandle,
  Delivery,
  HarnessConversation,
  HarnessKit,
  HostProcess,
  HostProcessOptions,
  RelayEvent,
} from "./buzz";
import type { Spawn } from "./orca";

export type Call = { args: string[]; input: string; env: HostProcessOptions["env"] };
export type Answer =
  | { result: unknown }
  | { error: { code: string; message: string } }
  | { raw: string; code?: number }
  | { wait: true };

/** A fake `orca` whose answers come from `respond`, keyed by the call's args. */
export function fakeOrca(respond: (args: string[], input: string) => Answer) {
  const calls: Call[] = [];
  const spawn: Spawn = async (id: string, options: HostProcessOptions = {}) => {
    if (id !== "orca") throw new Error(`undeclared process ${id}`);
    const args = [...(options.args ?? [])];
    let input = "";
    let exit!: (code: number | null) => void;
    const exited = new Promise<number | null>((resolve) => {
      exit = resolve;
    });
    const process: HostProcess = {
      write: async (data) => {
        input += data;
      },
      end: async (data = "") => {
        input += data;
        calls.push({ args, input, env: options.env });
        const answer = respond(args, input);
        if ("wait" in answer) return; // stays running until killed
        queueMicrotask(() => {
          if ("raw" in answer) {
            options.onStdout?.(answer.raw);
            exit(answer.code ?? 0);
          } else if ("error" in answer) {
            options.onStdout?.(JSON.stringify({ ok: false, error: answer.error }));
            exit(1);
          } else {
            options.onStdout?.(JSON.stringify({ ok: true, result: answer.result }));
            exit(0);
          }
        });
      },
      kill: async () => exit(null),
      exited,
    };
    return process;
  };
  return { spawn, calls };
}

export type Posted = { text: string; notifyOwner: boolean; conversation: string };

export function fakeKit(conversation: HarnessConversation | undefined) {
  const posted: Posted[] = [];
  const kit: HarnessKit = {
    conversation: async () => conversation,
    reply: async (_agent, where, text, options) => {
      posted.push({ text, notifyOwner: !!options?.notifyOwner, conversation: where.key });
    },
  };
  return { kit, posted };
}

/** What the fake relay holds: chat messages and profiles, by kind. */
export const relay: { events: RelayEvent[]; queries: object[][] } = { events: [], queries: [] };

export const AGENT: AgentHandle = {
  key: "agentpub:wss://relay.example",
  pubkey: "agentpub",
  relay: "wss://relay.example",
  name: "Orca Agent",
  owner: "ownerpub",
  publish: async () => {
    throw new Error("not used");
  },
  query: async (filters) => {
    relay.queries.push([...filters]);
    const kinds = new Set(filters.flatMap((filter) => (filter as { kinds?: number[] }).kinds ?? []));
    return relay.events.filter((event) => kinds.has(event.kind));
  },
};

/** A chat message on the fake relay. */
export function chat(id: string, pubkey: string, at: number, content: string): RelayEvent {
  return { id, pubkey, created_at: at, kind: 9, content, tags: [] };
}

/** A profile on the fake relay. */
export function profile(pubkey: string, name: string): RelayEvent {
  return { id: `p-${pubkey}`, pubkey, created_at: 1, kind: 0, content: JSON.stringify({ display_name: name }), tags: [] };
}

export const THREAD: HarnessConversation = {
  key: "chan/abcdef0123456789",
  channel: "chan",
  root: "abcdef0123456789",
  topLevel: false,
  where: "#builds",
};

export function mention(
  content: string,
  config: unknown,
  extra: Partial<{ resumed: true; id: string; at: number }> = {},
) {
  const working: PromiseLike<unknown>[] = [];
  const delivery: Delivery<unknown> = {
    trigger: {
      type: "mention",
      event: {
        id: extra.id ?? "e".repeat(64),
        pubkey: "ownerpub",
        created_at: extra.at ?? 1_000,
        kind: 9,
        content,
        tags: [],
      },
      ...(extra.resumed && { resumed: true as const }),
    },
    agent: AGENT,
    config,
    signal: new AbortController().signal,
    workingUntil: (done) => {
      working.push(done);
    },
  };
  return { delivery, working };
}

/** A Storage held in memory. */
export function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}
