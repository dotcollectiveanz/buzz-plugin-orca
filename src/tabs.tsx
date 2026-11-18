// The Orca harness's views, in Buzz's own controls: its part of the New agent
// dialog, its Settings tab (split into identity and runtime parts, with the
// host's Harness row first), and an Activity tab of each conversation's worker.
import { AGENTS } from "./catalog";
import { agentLabel, effortNote, effortsFor, fit, modelNote, modelsOf } from "./choices";
import type { AgentCreateProps, AgentSettingsHost, AgentViewProps } from "./buzz";
import type { Environment, Orca, Repo } from "./orca";
import { React } from "./react";
import type { ConversationRecord, OrcaRuntime, Status } from "./runtime";
import { type Config, config, repoSelector } from "./settings";
import {
  Button,
  type Choice,
  ChoiceRow,
  Instructions,
  layout,
  SectionHeader,
  SettingsGroup,
  Toggle,
} from "./ui";

type Read<T> =
  | Readonly<{ state: "loading" }>
  | Readonly<{ state: "ready"; value: T }>
  | Readonly<{ state: "error"; message: string }>;

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Reads `load` once per `key`; nothing while `key` is empty. */
function useRead<T>(key: string, load: ((signal: AbortSignal) => Promise<T>) | undefined): Read<T> {
  const [read, setRead] = React.useState<Read<T>>({ state: "loading" });
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on `key`.
  React.useEffect(() => {
    if (!key || !load) return;
    const abort = new AbortController();
    setRead({ state: "loading" });
    load(abort.signal).then(
      (value) => !abort.signal.aborted && setRead({ state: "ready", value }),
      (error) =>
        !abort.signal.aborted && setRead({ state: "error", message: errorText(error) }),
    );
    return () => abort.abort();
  }, [key]);
  return read;
}

const DEFAULT = "";
const PLACEMENTS: readonly Choice[] = [
  { value: "new", label: "New workspace each time" },
  { value: "main", label: "Repository checkout" },
];
const SCOPES: readonly Choice[] = [
  { value: "thread", label: "One worker per thread" },
  { value: "channel", label: "One worker per channel" },
];

const agentChoices = (current: string): Choice[] => [
  ...AGENTS.map((agent) => ({ value: agent.id, label: agent.label })),
  ...(AGENTS.some((agent) => agent.id === current) ? [] : [{ value: current, label: current }]),
];

/** "Claude Code default", as Buzz's Claude agent says "Claude default". */
const defaultModel = (agent: string) => `${agentLabel(agent)} default`;

function modelChoices(agent: string): Choice[] {
  return [
    { value: DEFAULT, label: defaultModel(agent) },
    ...modelsOf(agent).map((model) => ({ value: model.id, label: model.label })),
  ];
}

function effortChoices(agent: string, model: string): Choice[] {
  return [
    { value: DEFAULT, label: "Default" },
    ...effortsFor(agent, model).map((effort) => ({ value: effort.id, label: effort.label })),
  ];
}

const THIS_COMPUTER = "This computer";

type PartProps = Readonly<{
  value: Config;
  hosts: Read<readonly Environment[]>;
  repos: Read<readonly Repo[]>;
  refs: Read<readonly string[]>;
  disabled: boolean;
  onChange(value: Config): void;
}>;

/** Where workers start and which agent they are: the identity part. */
function IdentityRows({
  value,
  hosts,
  repos,
  disabled,
  onChange,
  typeControl,
}: PartProps & { typeControl?: React.ReactNode }) {
  const set = (change: Partial<Config>) => onChange(fit({ ...value, ...change }));
  const selected = repoSelector(value.repo);
  const listed = repos.state === "ready" ? repos.value : [];
  const repoChoices: Choice[] = [
    ...listed.map((repo) => ({ value: `id:${repo.id}`, label: repo.displayName || repo.path })),
    ...(selected && !listed.some((repo) => `id:${repo.id}` === selected)
      ? [{ value: selected, label: value.repo.replace(/^(name|path|id):/, "") }]
      : []),
  ];
  const servers = hosts.state === "ready" ? hosts.value : [];
  const hostChoices: Choice[] = [
    { value: DEFAULT, label: THIS_COMPUTER },
    ...servers.map((server) => ({ value: server.name, label: server.name })),
    ...(value.host && !servers.some((server) => server.name === value.host || server.id === value.host)
      ? [{ value: value.host, label: value.host }]
      : []),
  ];
  const noModel = modelNote(value.agent);
  const noEffort = effortNote(value.agent, value.model);
  return (
    <SettingsGroup>
      {typeControl}
      <ChoiceRow
        title="Runs on"
        value={servers.find((server) => server.id === value.host)?.name ?? value.host}
        choices={hostChoices}
        loading={hosts.state === "loading"}
        disabled={disabled}
        description={
          hosts.state === "error"
            ? hosts.message
            : "This computer's Orca, or a remote Orca server it is paired with."
        }
        // A repository and its branches are one server's: choose again.
        onChange={(host) => host !== value.host && set({ host, repo: "", baseBranch: "" })}
      />
      <ChoiceRow
        title="Repository"
        value={selected}
        valueLabel={selected ? undefined : repos.state === "loading" ? "Loading…" : "Choose"}
        choices={repoChoices}
        loading={repos.state === "loading"}
        disabled={disabled}
        description={repos.state === "error" ? repos.message : undefined}
        onChange={(repo) => set({ repo })}
      />
      <ChoiceRow
        title="Coding agent"
        value={value.agent}
        choices={agentChoices(value.agent)}
        disabled={disabled}
        onChange={(agent) => set({ agent })}
      />
      <ChoiceRow
        title="Model"
        value={noModel ? DEFAULT : value.model}
        choices={modelChoices(value.agent)}
        disabled={disabled || !!noModel}
        description={noModel}
        onChange={(model) => set({ model })}
      />
      <ChoiceRow
        title="Thinking"
        value={noEffort ? DEFAULT : value.effort}
        choices={effortChoices(value.agent, value.model)}
        disabled={disabled || !!noEffort}
        description={noEffort}
        onChange={(effort) => set({ effort })}
      />
    </SettingsGroup>
  );
}

/** How each worker runs: the runtime part. */
function RuntimeRows({ value, refs, disabled, onChange }: PartProps) {
  const set = (change: Partial<Config>) => onChange({ ...value, ...change });
  const refList = refs.state === "ready" ? refs.value : [];
  const baseChoices: Choice[] = [
    { value: DEFAULT, label: "Repository default" },
    ...refList.map((ref) => ({ value: ref, label: ref })),
    ...(value.baseBranch && !refList.includes(value.baseBranch)
      ? [{ value: value.baseBranch, label: value.baseBranch }]
      : []),
  ];
  return (
    <SettingsGroup>
      <ChoiceRow
        title="Workspace"
        value={value.placement}
        choices={PLACEMENTS}
        disabled={disabled}
        onChange={(placement) => set({ placement: placement === "main" ? "main" : "new" })}
      />
      {value.placement === "new" && (
        <ChoiceRow
          title="Base branch"
          value={value.baseBranch}
          choices={baseChoices}
          loading={refs.state === "loading" && !!value.repo}
          disabled={disabled}
          description={refs.state === "error" ? refs.message : undefined}
          onChange={(baseBranch) => set({ baseBranch })}
        />
      )}
      <ChoiceRow
        title="Conversations"
        value={value.scope}
        choices={SCOPES}
        disabled={disabled}
        onChange={(scope) => set({ scope: scope === "channel" ? "channel" : "thread" })}
      />
      <Toggle
        title="Keep workers open"
        description="Leave each worker open in Orca after it reports."
        checked={value.keepOpen}
        disabled={disabled}
        onChange={(keepOpen) => set({ keepOpen })}
      />
    </SettingsGroup>
  );
}

const STATUS: Readonly<Record<Status, string>> = {
  working: "Working",
  question: "Waiting for your answer",
  done: "Reported",
  failed: "Failed",
  stopped: "Stopped",
};

const when = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return new Date(at).toLocaleDateString();
};

export function createTabs(
  options: Readonly<{ orca: Orca | undefined; runtime: OrcaRuntime }>,
) {
  const { orca, runtime } = options;
  /** The remote servers Orca has saved, the chosen server's repositories,
   * and the chosen repository's branches. */
  function useOrca(value: Config) {
    const server = orca?.on(value.host);
    const hosts = useRead("hosts", orca ? (signal) => orca.environments(signal) : undefined);
    const repos = useRead(
      `repos|${value.host}`,
      server ? (signal) => server.repos(signal) : undefined,
    );
    const selected = repoSelector(value.repo);
    const refs = useRead(
      value.placement === "new" && selected ? `${value.host}|${selected}` : "",
      server ? (signal) => server.refs(selected, signal) : undefined,
    );
    return { hosts, repos, refs };
  }

  /** Offers Orca's first repository to a config with none. */
  function useFirstRepo(
    repos: Read<readonly Repo[]>,
    value: Config,
    apply: (next: Config) => void,
  ) {
    const first = repos.state === "ready" ? repos.value[0] : undefined;
    // biome-ignore lint/correctness/useExhaustiveDependencies: once the list arrives.
    React.useEffect(() => {
      if (first && !value.repo) apply({ ...value, repo: `id:${first.id}` });
    }, [first]);
  }

  function Create(props: AgentCreateProps<Config>) {
    const value = config(props.config);
    const { hosts, repos, refs } = useOrca(value);
    const { onReadyChange, onChange } = props;
    const ready = !!repoSelector(value.repo);
    React.useEffect(() => onReadyChange?.(ready), [ready, onReadyChange]);
    useFirstRepo(repos, value, (next) => onChange(next, { suggested: true }));
    const part = { value, hosts, repos, refs, disabled: props.disabled, onChange: (next: Config) => onChange(next) };
    return (
      <div className="grid gap-4">
        <IdentityRows {...part} />
        <RuntimeRows {...part} />
      </div>
    );
  }

  function SettingsTab({
    agent,
    save,
    settingsHost,
    settingsSection,
    settingsContent,
  }: AgentViewProps<Config> & { settingsHost?: AgentSettingsHost }) {
    const saved = config(agent.config);
    const [draft, setDraft] = React.useState<Config>(saved);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState("");
    const { hosts, repos, refs } = useOrca(draft);
    useFirstRepo(repos, draft, (next) => setDraft((current) => (current.repo ? current : next)));
    const configChanged = JSON.stringify(draft) !== JSON.stringify(saved);
    const changed = configChanged || Boolean(settingsHost?.pendingSave);
    const submit = async () => {
      setSaving(true);
      setError("");
      try {
        await save({ ...agent.config, ...draft });
      } catch (reason) {
        setError(errorText(reason));
      } finally {
        setSaving(false);
      }
    };
    const part = { value: draft, hosts, repos, refs, disabled: saving, onChange: setDraft };
    return (
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {error && (
          <p role="alert" className="buzz-field-error">
            {error}
          </p>
        )}
        {settingsSection !== "runtime" && (
          <>
            <IdentityRows {...part} typeControl={settingsHost?.typeControl?.(configChanged)} />
            <Instructions
              value={draft.instructions}
              disabled={saving}
              onChange={(instructions) => setDraft({ ...draft, instructions })}
            />
          </>
        )}
        {settingsSection !== "identity" && <RuntimeRows {...part} />}
        <Button type="submit" variant="prominent" disabled={!changed || saving} wide>
          {saving ? "Saving…" : "Save"}
        </Button>
        {settingsSection !== "identity" && settingsContent}
      </form>
    );
  }

  function ActivityTab(props: AgentViewProps<Config>) {
    const [records, setRecords] = React.useState<ConversationRecord[]>(() =>
      runtime.records(props.agent.key),
    );
    React.useEffect(() => {
      const read = () => setRecords(runtime.records(props.agent.key));
      read();
      return runtime.subscribe(read);
    }, [props.agent.key]);
    const entry = (record: ConversationRecord, index: number, all: readonly ConversationRecord[]) => (
      <li key={`${record.key}|${record.run}`} style={layout.entry(index === 0, index === all.length - 1)}>
        <div style={layout.row}>
          <span style={layout.copy}>
            <span className="block truncate text-label-sm" title={record.title}>
              {record.title}
            </span>
            <span className="block text-body-sm text-subtle">
              {[STATUS[record.status], record.where, record.host && `on ${record.host}`, when(record.updatedAt), record.error]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          {props.openConversation && (
            <Button
              variant="subtle"
              size="sm"
              label={`Open conversation: ${record.title}`}
              onClick={() => props.openConversation?.(record.channel, record.root)}
            >
              Conversation
            </Button>
          )}
          {record.workspace && (
            <Button
              variant="subtle"
              size="sm"
              label={`Show in Orca: ${record.title}`}
              onClick={() => void runtime.show(record).catch(() => undefined)}
            >
              Show in Orca
            </Button>
          )}
        </div>
      </li>
    );
    return (
      <div style={layout.activity}>
        <section aria-label="Workers" style={layout.section}>
          <SectionHeader title="Workers" />
          {records.length ? (
            <SettingsGroup layout="form">
              <ul style={layout.list}>{records.map(entry)}</ul>
            </SettingsGroup>
          ) : (
            <p className="m-0 text-body-sm text-subtle">
              None yet. A worker starts in Orca when the agent is mentioned.
            </p>
          )}
        </section>
      </div>
    );
  }

  return { Create, SettingsTab, ActivityTab };
}
