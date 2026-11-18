// Sharing an Orca agent, and moving it to and from another harness. Buzz's
// agent menu offers Share for a type with `exportShared`: the Marketplace
// lists a catalog runtime (`claude`, `codex`, `goose`, `pi`) with its model,
// and the instructions from `carry`. There is no Orca runtime, so an Orca agent
// is listed as the coding agent its workers run: whoever adds it gets that
// agent running on their own computer, without Orca. The repository and every
// other setting stay behind, as Buzz shares nothing else.
import type { Carry } from "./buzz";
import { agentLabel, takesModel } from "./choices";
import { type Config, config } from "./settings";

/** The Orca coding agents the Marketplace has a runtime for. */
export const SHARED_RUNTIMES: Readonly<Record<string, string>> = {
  claude: "claude",
  codex: "codex",
  goose: "goose",
  pi: "pi",
};

/** What a share of `value` lists: its coding agent's runtime and model. A
 * model is listed only where Orca starts the worker on it; the others use
 * their own. Throws, with why, for an agent the Marketplace has no runtime
 * for: Buzz shows it as "<name> can't be shared. <why>". */
export function exportShared(value: unknown): Readonly<{ runtime: string; model: string }> {
  const { agent, model } = config(value);
  const runtime = SHARED_RUNTIMES[agent];
  if (!runtime)
    throw new Error(
      `Its workers run ${agentLabel(agent)}, and the Marketplace lists only Claude Code, Codex, Goose and Pi agents. Choose one of those as its coding agent to share it.`,
    );
  return { runtime, model: takesModel(agent) ? model : "" };
}

/** What another harness may take from `value` when the agent changes type,
 * and what a share lists as its instructions. */
export function carry(value: unknown): Carry {
  const { instructions } = config(value);
  return instructions.trim() ? { instructions } : {};
}

/** `value` with the instructions an agent brings from another harness, or a
 * creation request's. Its working folder isn't taken: Orca works in its own
 * repositories. */
export function adopt(brought: Carry, value: Config): Config {
  const saved = config(value);
  return { ...saved, instructions: brought.instructions ?? saved.instructions };
}
