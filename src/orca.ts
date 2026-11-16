// Orca's CLI, run through Buzz's host as the manifest's `orca` process. Every
// call adds `--json` and reads Orca's envelope: `{ ok, result }` or
// `{ ok: false, error: { code, message } }`.
import type { HostProcess, HostProcessOptions } from "./buzz";

export type Spawn = (
  id: string,
  options?: HostProcessOptions,
) => Promise<HostProcess>;

/** Nothing of an Orca terminal Buzz may have been started from reaches the
 * CLI: the plugin names its own terminal with `--from` and `--terminal`. */
export const ENV: Readonly<Record<string, string | null>> = {
  ORCA_TERMINAL_HANDLE: null,
  ORCA_PANE_KEY: null,
  ORCA_TAB_ID: null,
  ORCA_WORKTREE_ID: null,
  ORCA_WORKSPACE_ID: null,
  ORCA_AGENT_LAUNCH: null,
  ORCA_AGENT_LAUNCH_TOKEN: null,
  ORCA_ENVIRONMENT: null,
  ORCA_PAIRING_CODE: null,
};

export const MISSING =
  "Orca is not installed on this computer. Install Orca, open it once, then try again.";

/** The manifest's `orca` process is `sh -c <locator> orca`: it runs the CLI
 * inside Orca.app (in /Applications, ~/Applications, or wherever Spotlight
 * finds it), else an `orca` on the PATH, else answers `orca_not_installed`.
 * No link or PATH setup is needed. */
const NOT_INSTALLED = "orca_not_installed";
/** Orca's code when its app is not running. */
const NOT_RUNNING = "runtime_unavailable";

export class OrcaError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OrcaError";
  }
}

/** Orca's JSON envelope from a command's stdout: the whole output, or the
 * last line that parses when something printed before it. */
export function envelope(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    const lines = text.split("\n").reverse();
    for (const line of lines) {
      try {
        return JSON.parse(line);
      } catch {
        // keep looking
      }
    }
    return undefined;
  }
}

export type Message = Readonly<{
  id: string;
  type: string;
  from?: string;
  subject?: string;
  body?: string;
  payload?: Readonly<{
    taskId?: string;
    dispatchId?: string;
    outcome?: string;
    stopReason?: string;
  }>;
}>;

export type Repo = Readonly<{ id: string; path: string; displayName: string }>;

export type Started = Readonly<{
  dispatchId: string;
  taskId: string;
  runId: string;
  terminal?: string;
  workspace?: string;
}>;

export class Orca {
  constructor(private readonly spawn: Spawn) {}

  private opening: Promise<unknown> | undefined;

  /** Runs `orca <args> --json`, writing `input` to stdin, and resolves with
   * the envelope's `result`. When Orca is not running it opens Orca and
   * tries once more. Aborting `signal` kills the command. */
  async call<T>(
    args: readonly string[],
    options: Readonly<{ input?: string; signal?: AbortSignal }> = {},
  ): Promise<T> {
    try {
      return await this.once<T>(args, options);
    } catch (error) {
      if (!(error instanceof OrcaError) || error.code !== NOT_RUNNING || args[0] === "open")
        throw error;
      // One `orca open` at a time, however many calls found Orca closed.
      this.opening ??= this.once(["open"], { signal: options.signal }).finally(() => {
        this.opening = undefined;
      });
      await this.opening;
      return this.once<T>(args, options);
    }
  }

  private async once<T>(
    args: readonly string[],
    options: Readonly<{ input?: string; signal?: AbortSignal }>,
  ): Promise<T> {
    const { input, signal } = options;
    signal?.throwIfAborted();
    let stdout = "";
    let stderr = "";
    let process: HostProcess;
    try {
      process = await this.spawn("orca", {
        args: [...args, "--json"],
        env: ENV,
        onStdout: (data) => {
          stdout += data;
        },
        onStderr: (data) => {
          stderr += data;
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw /os error 2|no such file|not found|not declared/i.test(message)
        ? new OrcaError("missing", MISSING)
        : new OrcaError("spawn_failed", message);
    }
    const kill = () => void process.kill().catch(() => undefined);
    signal?.addEventListener("abort", kill, { once: true });
    try {
      await process.end(input ?? "");
      const code = await process.exited;
      signal?.throwIfAborted();
      const parsed = envelope(stdout) as
        | { ok?: boolean; result?: T; error?: { code?: string; message?: string } }
        | undefined;
      if (!parsed || typeof parsed !== "object") {
        const detail = (stderr || stdout).trim().split("\n").slice(-3).join(" ");
        throw new OrcaError(
          code === 127 ? "missing" : "bad_output",
          code === 127
            ? MISSING
            : `Orca gave no answer (exit ${code ?? "signal"})${detail ? `: ${detail}` : ""}`,
        );
      }
      if (parsed.error?.code === NOT_INSTALLED) throw new OrcaError("missing", MISSING);
      if (parsed.ok === false || parsed.error)
        throw new OrcaError(
          parsed.error?.code ?? "action_failed",
          parsed.error?.message ?? "Orca refused the command",
        );
      return parsed.result as T;
    } finally {
      signal?.removeEventListener("abort", kill);
    }
  }

  status(signal?: AbortSignal) {
    return this.call<{
      app?: { running?: boolean };
      runtime?: { state?: string; reachable?: boolean };
    }>(["status"], { signal });
  }

  async repos(signal?: AbortSignal): Promise<readonly Repo[]> {
    const result = await this.call<{ repos?: Repo[] }>(["repo", "list"], {
      signal,
    });
    return result.repos ?? [];
  }

  async repo(selector: string, signal?: AbortSignal): Promise<Repo> {
    const result = await this.call<{ repo?: Repo } & Partial<Repo>>(
      ["repo", "show", "--repo", selector],
      { signal },
    );
    const repo = result.repo ?? (result as Repo);
    if (!repo?.path) throw new OrcaError("not_found", `Orca has no repo ${selector}`);
    return repo;
  }

  /** A repository's branches and tags, as base refs for a new workspace:
   * remote refs as `origin/<name>`, local ones by their branch name. */
  async refs(selector: string, signal?: AbortSignal): Promise<readonly string[]> {
    const result = await this.call<{ refs?: string[] }>(
      ["repo", "search-refs", "--repo", selector, "--query", "*", "--limit", "100"],
      { signal },
    );
    const names = (result.refs ?? []).map((ref) => ref.replace(/^refs\/(heads|tags)\//, ""));
    return [...new Set(names)];
  }

  /** Whether a terminal handle is still live in Orca. */
  async live(handle: string, signal?: AbortSignal) {
    try {
      const result = await this.call<{
        terminal?: { status?: string; handle?: string };
      }>(["terminal", "show", "--terminal", handle], { signal });
      const status = result.terminal?.status;
      return !status || status === "running";
    } catch (error) {
      if (error instanceof OrcaError && error.code !== "missing") return false;
      throw error;
    }
  }

  /** A quiet terminal the plugin owns, as the coordinator's mailbox: Orca's
   * orchestration needs a terminal to send workers' mail to. It runs
   * `cat > /dev/null`, so anything Orca types into it does nothing. */
  async mailbox(worktree: string, signal?: AbortSignal): Promise<string> {
    const result = await this.call<{ terminal?: { handle?: string } }>(
      [
        "terminal",
        "create",
        "--worktree",
        worktree,
        "--title",
        "Buzz mailbox",
        "--command",
        "cat > /dev/null",
      ],
      { signal },
    );
    const handle = result.terminal?.handle;
    if (!handle) throw new OrcaError("bad_output", "Orca made no mailbox terminal");
    return handle;
  }

  async runCreate(from: string, objective: string, signal?: AbortSignal) {
    const result = await this.call<{ runId?: string }>(
      ["orchestration", "run-create", "--from", from, "--objective", objective],
      { signal },
    );
    if (!result.runId) throw new OrcaError("bad_output", "Orca made no Run");
    return result.runId;
  }

  /** Starts one supervised worker with `spec` as its Task, read from stdin. */
  async workerStart(
    options: Readonly<{
      from: string;
      run: string;
      spec: string;
      title: string;
      agent: string;
      /** `--worktree` and the flags it needs, from `placementArgs`. */
      placement: readonly string[];
      model?: string;
      effort?: string;
      keepOpen?: boolean;
    }>,
    signal?: AbortSignal,
  ): Promise<Started> {
    const args = [
      "orchestration",
      "worker-start",
      "--from",
      options.from,
      "--run",
      options.run,
      "--spec-file",
      "-",
      "--task-title",
      options.title,
      "--agent",
      options.agent,
      ...options.placement,
      ...(options.model ? ["--model", options.model] : []),
      // Orca takes an effort only with a model.
      ...(options.model && options.effort ? ["--effort", options.effort] : []),
      ...(options.keepOpen ? ["--keep-open"] : []),
    ];
    const result = await this.call<Partial<Started>>(args, {
      input: options.spec,
      signal,
    });
    if (!result.dispatchId || !result.runId)
      throw new OrcaError("bad_output", "Orca started no worker");
    return {
      dispatchId: result.dispatchId,
      taskId: result.taskId ?? "",
      runId: result.runId,
      ...(result.terminal && { terminal: result.terminal }),
      ...(result.workspace && { workspace: result.workspace }),
    };
  }

  /** Takes the Run's next batch of mail, waiting up to `timeoutMs` for one
   * that holds a message of `types`. Empty when the wait ran out. */
  async check(
    options: Readonly<{
      terminal: string;
      run: string;
      types: readonly string[];
      timeoutMs: number;
    }>,
    signal?: AbortSignal,
  ): Promise<readonly Message[]> {
    const result = await this.call<{ messages?: Message[] }>(
      [
        "orchestration",
        "check",
        "--terminal",
        options.terminal,
        "--run",
        options.run,
        "--wait",
        "--types",
        options.types.join(","),
        "--timeout-ms",
        String(options.timeoutMs),
      ],
      { signal },
    );
    return result.messages ?? [];
  }

  send(
    options: Readonly<{
      from: string;
      run: string;
      dispatch: string;
      subject: string;
      body: string;
    }>,
    signal?: AbortSignal,
  ) {
    return this.call<unknown>(
      [
        "orchestration",
        "send",
        "--from",
        options.from,
        "--run",
        options.run,
        "--to",
        `dispatch:${options.dispatch}`,
        "--subject",
        options.subject,
        "--body",
        options.body,
      ],
      { signal },
    );
  }

  reply(
    options: Readonly<{ from: string; run: string; id: string; body: string }>,
    signal?: AbortSignal,
  ) {
    return this.call<unknown>(
      [
        "orchestration",
        "reply",
        "--from",
        options.from,
        "--run",
        options.run,
        "--id",
        options.id,
        "--body",
        options.body,
      ],
      { signal },
    );
  }

  stop(dispatch: string, signal?: AbortSignal) {
    return this.call<unknown>(
      ["orchestration", "worker-stop", "--dispatch", dispatch],
      { signal },
    );
  }

  /** Shows a worker's workspace in Orca. */
  activate(workspace: string, signal?: AbortSignal) {
    return this.call<unknown>(
      ["worktree", "activate", "--worktree", `id:${workspace}`],
      { signal },
    );
  }
}
