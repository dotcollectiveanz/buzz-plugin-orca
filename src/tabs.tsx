// The Orca harness's views: its fields in the New agent dialog, its Settings
// tab, and an Activity tab listing each conversation's worker.
import type {
  AgentCreateProps,
  AgentViewProps,
} from "./buzz";
import type { Orca, Repo } from "./orca";
import { React } from "./react";
import type { ConversationRecord, OrcaRuntime, Status } from "./runtime";
import { type Config, config, repoSelector } from "./settings";
import {
  Button,
  Field,
  Instructions,
  PreferenceRow,
  Select,
  SettingsGroup,
  TextInput,
  Toggle,
} from "./ui";

type Connection =
  | { state: "checking" }
  | { state: "ready"; repos: readonly Repo[] }
  | { state: "error"; message: string };

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Orca's state and repositories, read once per view. */
function useOrca(orca: Orca | undefined): Connection {
  const [connection, setConnection] = React.useState<Connection>({ state: "checking" });
  React.useEffect(() => {
    if (!orca) {
      setConnection({ state: "error", message: "Orca runs only in Buzz desktop." });
      return;
    }
    const abort = new AbortController();
    (async () => {
      try {
        const status = await orca.status(abort.signal);
        if (!status.app?.running || status.runtime?.reachable === false)
          throw new Error("Orca is not running. Open Orca, then come back here.");
        const repos = await orca.repos(abort.signal);
        setConnection({ state: "ready", repos });
      } catch (error) {
        if (!abort.signal.aborted)
          setConnection({ state: "error", message: errorText(error) });
      }
    })();
    return () => abort.abort();
  }, [orca]);
  return connection;
}

function Fields({
  value,
  connection,
  disabled,
  onChange,
}: {
  value: Config;
  connection: Connection;
  disabled: boolean;
  onChange(value: Config): void;
}) {
  const ids = {
    repo: React.useId(),
    agent: React.useId(),
    placement: React.useId(),
    base: React.useId(),
    model: React.useId(),
    effort: React.useId(),
    scope: React.useId(),
  };
  const set = (change: Partial<Config>) => onChange({ ...value, ...change });
  const selected = repoSelector(value.repo);
  const repos = connection.state === "ready" ? connection.repos : [];
  const repoOptions = [
    { value: "", label: "Choose a repository" },
    ...repos.map((repo) => ({ value: `id:${repo.id}`, label: repo.displayName || repo.path })),
    ...(selected && !repos.some((repo) => `id:${repo.id}` === selected)
      ? [{ value: selected, label: value.repo }]
      : []),
  ];
  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      <SettingsGroup layout="rows">
        <PreferenceRow
          title="Orca"
          description={
            connection.state === "checking"
              ? "Checking Orca…"
              : connection.state === "ready"
                ? `Connected. ${repos.length} ${repos.length === 1 ? "repository" : "repositories"}.`
                : connection.message
          }
        />
      </SettingsGroup>
      <Field
        id={ids.repo}
        label="Repository"
        description="Workers start in this Orca repository."
      >
        <Select
          id={ids.repo}
          value={selected}
          options={repoOptions}
          disabled={disabled}
          onChange={(repo) => set({ repo })}
        />
      </Field>
      <Field
        id={ids.agent}
        label="Coding agent"
        description="The agent Orca launches for each worker: claude, codex, opencode or another Orca knows."
      >
        <TextInput
          id={ids.agent}
          value={value.agent}
          disabled={disabled}
          onChange={(agent) => set({ agent })}
        />
      </Field>
      <Field id={ids.placement} label="Workspace">
        <Select
          id={ids.placement}
          value={value.placement}
          options={[
            { value: "new", label: "A new Orca workspace for each conversation" },
            { value: "main", label: "The repository's own checkout" },
          ]}
          disabled={disabled}
          onChange={(placement) => set({ placement: placement === "main" ? "main" : "new" })}
        />
      </Field>
      {value.placement === "new" && (
        <Field id={ids.base} label="Base branch" optional>
          <TextInput
            id={ids.base}
            value={value.baseBranch}
            disabled={disabled}
            onChange={(baseBranch) => set({ baseBranch })}
          />
        </Field>
      )}
      <Field id={ids.model} label="Model" optional description="Empty uses the coding agent's own.">
        <TextInput id={ids.model} value={value.model} disabled={disabled} onChange={(model) => set({ model })} />
      </Field>
      <Field id={ids.effort} label="Effort" optional>
        <TextInput id={ids.effort} value={value.effort} disabled={disabled} onChange={(effort) => set({ effort })} />
      </Field>
      <Field id={ids.scope} label="Conversations">
        <Select
          id={ids.scope}
          value={value.scope}
          options={[
            { value: "thread", label: "Each thread is its own worker" },
            { value: "channel", label: "The whole channel is one worker" },
          ]}
          disabled={disabled}
          onChange={(scope) => set({ scope: scope === "channel" ? "channel" : "thread" })}
        />
      </Field>
      <SettingsGroup layout="rows">
        <Toggle
          title="Keep workers open"
          description="Leave each worker's chat open in Orca after it reports, to watch it or talk to it there."
          checked={value.keepOpen}
          disabled={disabled}
          onChange={(keepOpen) => set({ keepOpen })}
        />
      </SettingsGroup>
      <Instructions
        value={value.instructions}
        disabled={disabled}
        onChange={(instructions) => set({ instructions })}
      />
    </div>
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
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return new Date(at).toLocaleDateString();
};

export function createTabs(
  options: Readonly<{ orca: Orca | undefined; runtime: OrcaRuntime }>,
) {
  const { orca, runtime } = options;

  function Create(props: AgentCreateProps<Config>) {
    const connection = useOrca(orca);
    const value = config(props.config);
    const ready = !!repoSelector(value.repo);
    const { onReadyChange } = props;
    React.useEffect(() => onReadyChange?.(ready), [ready, onReadyChange]);
    return (
      <Fields
        value={value}
        connection={connection}
        disabled={props.disabled}
        onChange={(next) => props.onChange(next)}
      />
    );
  }

  function SettingsTab(props: AgentViewProps<Config>) {
    const connection = useOrca(orca);
    const saved = config(props.agent.config);
    const [draft, setDraft] = React.useState<Config>(saved);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState<string>();
    const changed = JSON.stringify(draft) !== JSON.stringify(saved);
    const save = async () => {
      setSaving(true);
      setError(undefined);
      try {
        await props.save({ ...props.agent.config, ...draft });
      } catch (failure) {
        setError(errorText(failure));
      } finally {
        setSaving(false);
      }
    };
    return (
      <div style={{ display: "grid", gap: "var(--space-4)", padding: "var(--space-panel-inset, 16px)" }}>
        <Fields value={draft} connection={connection} disabled={saving} onChange={setDraft} />
        {error && (
          <p role="alert" className="buzz-field-error m-0">
            {error}
          </p>
        )}
        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
          <Button variant="subtle" disabled={!changed || saving} onClick={() => setDraft(saved)}>
            Reset
          </Button>
          <Button variant="prominent" disabled={!changed || saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
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
    if (!records.length)
      return (
        <p className="m-0 text-body-sm text-subtle" style={{ padding: "var(--space-panel-inset, 16px)" }}>
          No workers yet. Mention this agent in a channel or a DM to start one in Orca.
        </p>
      );
    return (
      <div style={{ display: "grid", gap: "var(--space-2)", padding: "var(--space-panel-inset, 16px)" }}>
        <SettingsGroup layout="rows">
          {records.map((record) => (
            <PreferenceRow
              key={`${record.key}|${record.run}`}
              title={record.title}
              description={`${STATUS[record.status]} · ${record.where} · ${when(record.updatedAt)}${record.error ? ` · ${record.error}` : ""}`}
              trailing={
                <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                  {props.openConversation && (
                    <Button
                      size="sm"
                      onClick={() => props.openConversation?.(record.channel, record.root)}
                    >
                      Conversation
                    </Button>
                  )}
                  {record.workspace && (
                    <Button size="sm" onClick={() => void runtime.show(record).catch(() => undefined)}>
                      Show in Orca
                    </Button>
                  )}
                </div>
              }
            />
          ))}
        </SettingsGroup>
      </div>
    );
  }

  return { Create, SettingsTab, ActivityTab };
}
