// The parts of Buzz's plugin API (`@buzz/author`) this plugin uses, as types
// only. Buzz supplies every capability at runtime through `ctx`; nothing here
// is imported at runtime. Copied from block/buzz-app v0.7.0-preview.260.1
// (`src/features/agents/service.ts`, `src/features/agent-harness/kit.ts`,
// `src/features/host/service.ts`) and trimmed to what this plugin calls. See
// NOTICE.md. Keep it in step with the Buzz release in `BUZZ_REF`
// (scripts/types.mjs) when the API changes.
import type * as ReactTypes from "react";
import type { ComponentType } from "react";

/** One agent's membership in one community: `<pubkey>:<relay>` style key. */
export type AgentKey = string;

export type RelayEvent = Readonly<{
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
  tags: readonly (readonly string[])[];
  sig?: string;
}>;

export type AgentEventTemplate = Readonly<{
  kind: number;
  content: string;
  tags: readonly (readonly string[])[];
}>;

export type AgentHandle = Readonly<{
  key: AgentKey;
  pubkey: string;
  relay: string;
  name: string;
  owner: string;
  publish(event: AgentEventTemplate, check?: () => void): Promise<RelayEvent>;
}>;

export type Trigger =
  | Readonly<{ type: "mention"; event: RelayEvent; resumed?: true }>
  | Readonly<{ type: string; event?: RelayEvent }>;

export type Delivery<Config = unknown> = Readonly<{
  trigger: Trigger;
  channelId?: string;
  agent: AgentHandle;
  config: Config;
  model?: string;
  effort?: string;
  signal: AbortSignal;
  workingUntil(done: PromiseLike<unknown>): void;
  step?(tool: string, target?: string): void;
  ignored?(): void;
  acknowledged?(): void;
  interruptible?(stop: () => Promise<void>): void;
  named?(title: string): void;
}>;

export type HarnessScope = "thread" | "channel";

export type HarnessConversation = Readonly<{
  /** The channel id, or `<channel>/<root>` for a thread's own conversation. */
  key: string;
  channel: string;
  root?: string;
  topLevel: boolean;
  /** `#name`, `DM` or a short channel id, for titles. */
  where: string;
}>;

export type HarnessKit = Readonly<{
  /** Undefined when the harness must not act: a mention that is not the
   * owner's own or attested by them, another trigger, or no channel. */
  conversation(
    delivery: Delivery,
    scope: HarnessScope,
  ): Promise<HarnessConversation | undefined>;
  /** Posts `text` as the agent in the conversation's thread, or at the top
   * level. `notifyOwner` tags the owner. */
  reply(
    agent: AgentHandle,
    conversation: HarnessConversation,
    text: string,
    options?: Readonly<{ notifyOwner?: boolean }>,
  ): Promise<void>;
}>;

export type Agent<Config = unknown> = Readonly<{
  key: AgentKey;
  pubkey: string;
  name: string;
  /** The agent type's key, `pluginId/typeId`. */
  type: string;
  owner: string;
  relay: string;
  config: Config;
}>;

export type AgentViewProps<Config = unknown> = {
  agent: Agent<Config>;
  openConversation?: (channelId: string, threadRootId?: string) => void;
  /** Replaces the type's whole config: spread `agent.config` to change one field. */
  save(config: Config): Promise<void>;
};

export type AgentCreateProps<Config = unknown> = {
  agent?: Agent<Config>;
  config: Config;
  onChange(config: Config, options?: { suggested?: boolean }): void;
  onReadyChange?: (ready: boolean) => void;
  disabled: boolean;
};

export type AgentTab<Config = unknown> = Readonly<{
  id: string;
  title: string;
  role?: "settings" | "activity";
  splitSettings?: boolean;
  component: ComponentType<AgentViewProps<Config>>;
}>;

export type AgentType<Config = unknown> = {
  id: string;
  title: string;
  description?: string;
  icon?: unknown;
  defaults(): Readonly<{ config: Config }>;
  summary?(agent: Agent<Config>): string;
  Create?: ComponentType<AgentCreateProps<Config>>;
  tabs?: readonly AgentTab<Config>[];
  run?(delivery: Delivery<Config>): void | Promise<void>;
  /** The settings that sync across devices and how they merge into this
   * device's config. An agent whose settings sync can't start or save on a
   * type without them. */
  syncedSettings?: Readonly<{
    schema: Readonly<Record<string, "string" | readonly string[]>>;
    withSynced(config: Config, settings: Readonly<Record<string, string>>): Config;
  }>;
  /** Per-run deadline in milliseconds, up to 30 minutes. */
  timeoutMs?: number;
  resumes?: boolean;
};

export type Agents = Readonly<{
  harness: HarnessKit;
  register<Config>(type: AgentType<Config>): void;
}>;

export type HostProcessOptions = Readonly<{
  /** Follow the arguments the manifest declares. */
  args?: readonly string[];
  cwd?: string;
  /** Added to the app's environment; `null` removes a variable. */
  env?: Readonly<Record<string, string | null>>;
  onStdout?(data: string): void;
  onStderr?(data: string): void;
}>;

export type HostProcess = Readonly<{
  write(data: string): Promise<void>;
  /** Writes any final `data`, then closes stdin. */
  end(data?: string): Promise<void>;
  kill(): Promise<void>;
  /** The exit code once it exits; null when a signal ended it. */
  exited: Promise<number | null>;
}>;

export type Host = Readonly<{
  spawn?: (id: string, options?: HostProcessOptions) => Promise<HostProcess>;
}>;

export type Context = Readonly<{
  react: typeof ReactTypes;
  agents: Agents;
  host: Host;
  pluginOwner?: Readonly<{ id: string }>;
  effect(start: () => void | (() => void)): void;
}>;
