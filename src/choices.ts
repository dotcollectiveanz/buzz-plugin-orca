// Which model and thinking (effort) choices each coding agent offers, and what
// a worker is started with. One rule for the Settings menus and the runtime:
// - Orca's worker-start takes `--model` only for MODEL_AGENTS; the others use
//   the model from their own config, so they offer no choice here.
// - `--effort` needs `--model`. Claude Code takes its own `default` model
//   alias, so a Claude worker can have a thinking level on its default model;
//   other agents need a model chosen first.
import { AGENTS, type CatalogChoice, type CatalogModel, MODEL_AGENTS, MODELS } from "./catalog";
import type { Config } from "./settings";

/** Claude Code's alias for the account's own default model. */
export const CLAUDE_DEFAULT_MODEL = "default";

export const agentLabel = (agent: string) =>
  AGENTS.find((item) => item.id === agent)?.label ?? agent;

/** Whether Orca can start this agent's worker on a chosen model. */
export const takesModel = (agent: string) => MODEL_AGENTS.includes(agent);

export const modelsOf = (agent: string): readonly CatalogModel[] =>
  takesModel(agent) ? (MODELS[agent] ?? []) : [];

/** The thinking levels offered for `model` ("" for the agent's default). */
export function effortsFor(agent: string, model: string): readonly CatalogChoice[] {
  const models = modelsOf(agent);
  if (model) return models.find((item) => item.id === model)?.efforts ?? [];
  if (agent !== "claude") return [];
  // Claude's default model: every level a Claude model offers, in order.
  const seen = new Map<string, CatalogChoice>();
  for (const item of models) for (const effort of item.efforts) seen.set(effort.id, effort);
  return [...seen.values()];
}

/** Why the thinking menu is off, or undefined when it is on. */
export function effortNote(agent: string, model: string): string | undefined {
  const name = agentLabel(agent);
  if (!takesModel(agent)) return `Orca starts ${name} with its own thinking settings.`;
  if (effortsFor(agent, model).length) return undefined;
  if (!model) return `Choose a model first: Orca sets ${name}'s thinking only with a model.`;
  return `${modelsOf(agent).find((item) => item.id === model)?.label ?? model} has no thinking levels.`;
}

/** Why the model menu is off, or undefined when it is on. */
export function modelNote(agent: string): string | undefined {
  const name = agentLabel(agent);
  if (!takesModel(agent)) return `Orca starts ${name} with the model from its own settings.`;
  if (!modelsOf(agent).length) return `Orca lists no models for ${name}: it uses its own default.`;
  return undefined;
}

/** A config with any model or thinking level its agent doesn't offer dropped. */
export function fit(next: Config): Config {
  const models = modelsOf(next.agent);
  const model = next.model && models.some((item) => item.id === next.model) ? next.model : "";
  const effort =
    next.effort && effortsFor(next.agent, model).some((item) => item.id === next.effort)
      ? next.effort
      : "";
  return { ...next, model, effort };
}

/** The model and thinking level a worker is started with: nothing Orca would
 * refuse, and Claude's default model named when only a level is set. */
export function launchChoice(
  agent: string,
  model: string,
  effort: string,
): Readonly<{ model?: string; effort?: string }> {
  if (!takesModel(agent)) return {};
  if (model && effort) return { model, effort };
  if (model) return { model };
  if (effort && agent === "claude") return { model: CLAUDE_DEFAULT_MODEL, effort };
  return {};
}
