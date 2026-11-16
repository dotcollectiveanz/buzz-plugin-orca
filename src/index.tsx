// Orca agents for Buzz, as an installed plugin: an agent type whose turns run
// as Orca workers. Mention the agent and Orca starts a coding agent (Claude
// Code, Codex or another) in a workspace of the configured repository; the
// worker's report, questions and stops come back to the conversation.
import type { AgentType, Context } from "./buzz";
import { OrcaIcon } from "./icon";
import { Orca } from "./orca";
import { setReact } from "./react";
import { OrcaRuntime } from "./runtime";
import {
  type Config,
  DEFAULT_CONFIG,
  summary,
  syncedSettingsSchema,
  withSyncedSettings,
} from "./settings";
import { createTabs } from "./tabs";

export const TYPE_ID = "orca";
/** A run hands its work to Orca and returns; this bounds only the hand-over. */
const HANDOVER_MS = 2 * 60_000;

export const inject = ["react", "agents", "host"];

export function apply(ctx: Context) {
  setReact(ctx.react);
  const { agents, host } = ctx;
  const orca = host.spawn ? new Orca(host.spawn.bind(host)) : undefined;
  const runtime = orca ? new OrcaRuntime(agents.harness, orca) : undefined;
  if (runtime) ctx.effect(() => () => runtime.dispose());

  const tabs = runtime ? createTabs({ orca, runtime }) : undefined;
  const type: AgentType<Config> = {
    id: TYPE_ID,
    title: "Orca",
    icon: OrcaIcon,
    description:
      "Hands each request to a coding agent in Orca on this computer, in a workspace of your repository, and posts its report back. Each thread it is mentioned in is one worker.",
    defaults: () => ({ config: DEFAULT_CONFIG }),
    summary: (agent) => summary(agent.config),
    ...(tabs && {
      Create: tabs.Create,
      tabs: [
        { id: "settings", title: "Settings", role: "settings", component: tabs.SettingsTab },
        { id: "activity", title: "Activity", role: "activity", component: tabs.ActivityTab },
      ],
    }),
    ...(runtime && { run: (delivery) => runtime.run(delivery) }),
    timeoutMs: HANDOVER_MS,
    syncedSettings: { schema: syncedSettingsSchema, withSynced: withSyncedSettings },
    resumes: true,
  };
  agents.register<Config>(type);
}
