// An Orca agent's settings: which Orca repository its workers start in, how,
// and with which coding agent. No credentials live in this config.

export type Scope = "thread" | "channel";
/** `new`: each conversation gets its own new Orca workspace (a worktree);
 * `main`: workers start in the repository's own checkout. */
export type Placement = "new" | "main";

export type Config = Readonly<{
  /** Where workers run: empty for this computer's Orca, or the name (or id)
   * of a saved remote Orca server (`orca environment list`), such as
   * "GCP build-loop". The repository is that server's. */
  host: string;
  /** An Orca repo selector (`name:dot-mcp`, `id:…`, `path:/…`), or a plain
   * name or path, which `repoSelector` turns into one. */
  repo: string;
  /** The coding agent Orca launches for each worker, such as `claude`. */
  agent: string;
  placement: Placement;
  /** The ref a new workspace starts from; empty uses the repo's default. */
  baseBranch: string;
  /** A model id for the worker; empty uses the agent's own. */
  model: string;
  /** A reasoning effort for the worker; empty uses the agent's own. */
  effort: string;
  /** Keep each worker open in Orca after it reports, to watch or talk to it. */
  keepOpen: boolean;
  /** Added to every worker's brief. */
  instructions: string;
  /** Whether each thread is its own worker, or the whole channel is one. */
  scope: Scope;
}>;

export const DEFAULT_CONFIG: Config = Object.freeze({
  host: "",
  repo: "",
  agent: "claude",
  placement: "new",
  baseBranch: "",
  model: "",
  effort: "",
  keepOpen: true,
  instructions: "",
  scope: "thread",
});

const text = (value: unknown, fallback: string) =>
  typeof value === "string" ? value.trim() : fallback;

/** A saved config, filled from the defaults and cleaned. */
export const config = (value: unknown): Config => {
  const saved =
    value && typeof value === "object" ? (value as Partial<Config>) : {};
  const agent = text(saved.agent, DEFAULT_CONFIG.agent);
  return {
    host: text(saved.host, ""),
    repo: text(saved.repo, ""),
    agent: /^[A-Za-z0-9._-]{1,64}$/.test(agent) ? agent : DEFAULT_CONFIG.agent,
    placement: saved.placement === "main" ? "main" : "new",
    baseBranch: text(saved.baseBranch, ""),
    model: text(saved.model, ""),
    effort: text(saved.effort, ""),
    keepOpen: saved.keepOpen !== false,
    instructions:
      typeof saved.instructions === "string" ? saved.instructions : "",
    scope: saved.scope === "channel" ? "channel" : "thread",
  };
};

/** Orca's selector for the configured repo: a selector as given, a path as
 * `path:`, anything else as `name:`. Empty when none is set. */
export const repoSelector = (repo: string) => {
  const value = repo.trim();
  if (!value) return "";
  if (/^(id|name|path):/.test(value)) return value;
  if (value.startsWith("/") || value.startsWith("~")) return `path:${value}`;
  return `name:${value}`;
};

/** One short line under the agent's name. */
export const summary = (value: unknown) => {
  const { host, repo, agent, placement } = config(value);
  const where = repo ? repoSelector(repo).replace(/^(name|path|id):/, "") : "no repo";
  return `${agent} · ${where}${host ? ` · on ${host}` : ""}${placement === "new" ? " · new workspaces" : ""}`;
};

// Synced settings (NIP-AP `buzz.agent.settings`). An agent whose settings
// sync through its community can't start or save on a type without them, so
// the type must declare them. Buzz requires every synced value to be text and
// refuses unknown keys. The host, repository, base branch and keep-open choice
// stay on this device: a remote server is one this computer's Orca has paired
// with, and a repository is that Orca's.
type SettingsSchema = Readonly<Record<string, "string" | readonly string[]>>;
export const syncedSettingsSchema = {
  agent: "string",
  placement: ["new", "main"],
  scope: ["thread", "channel"],
  model: "string",
  effort: "string",
} as const satisfies SettingsSchema;

const pick = (value: object) =>
  Object.fromEntries(
    Object.keys(syncedSettingsSchema)
      .filter((name) => name in value)
      .map((name) => [name, (value as Record<string, unknown>)[name]]),
  ) as Record<string, string>;

/** Synced fields come only from `settings`, a left-out one from the default;
 * everything else stays this device's. */
export const withSyncedSettings = (
  value: Config,
  settings: Readonly<Record<string, string>>,
): Config => config({ ...value, ...pick(DEFAULT_CONFIG), ...pick(settings) });
