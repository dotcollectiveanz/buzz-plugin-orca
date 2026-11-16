# Changelog

## 0.4.0 (16 Nov 2026)

- **Chat both ways, as with Buzz's own Claude agent.** A worker now sees the conversation, not only
  the message that mentioned it: a new worker is shown what was said before, with each person's
  name, and each later message reaches it with what was said since its last one.
- **The worker talks in the thread while it works.** Its messages (progress, a partial result, a
  link) are posted to the conversation as the agent as they come, then its reply ends the turn.
  Questions and stops still come to you as before.
- **No extra messages.** The agent no longer posts "On it" when a worker starts; Buzz shows it as
  working, as it does for its own agents.

## 0.3.1 (16 Nov 2026)

- **Fix: Model and Thinking defaults.** Model's default now reads "Claude Code default" (or the
  agent's own name) instead of guessing from Orca's catalogue, and Thinking's reads "Default".
- **Thinking works on Claude's default model.** Orca needs a model to set thinking, so a Claude
  worker with only a thinking level starts on Claude Code's own `default` model alias.
- **Only choices Orca can apply.** Models are offered only for the agents Orca can start on a
  chosen model (Claude, Codex, Cursor, Antigravity, Grok, Muse and OMP, read from Orca's own help);
  for the others, and where thinking needs a model first, the menu is off and says why.

## 0.3.0 (16 Nov 2026)

- **Fix: the Harness row is back.** The Settings tab now shows Buzz's Harness control, so an Orca
  agent can switch to another harness. The tab is split into Buzz's identity and runtime parts.
- **Settings look like Buzz's own.** Rows with menus in a settings group, Buzz's switch, and the
  Activity tab in Buzz's activity layout.
- **Menus, not text boxes.** Repository, coding agent, model, thinking and base branch are picked
  from lists: Orca's repositories, the 45 coding agents Orca can launch, each agent's models and
  effort levels from Orca's own catalogue, and the repository's branches. Changing the agent or the
  model drops a choice the new one doesn't offer; thinking needs a model, as Orca requires.
- Each version tag now publishes a GitHub release with its notes and the plugin as a zip.

## 0.2.1 (16 Nov 2026)

- **Fix: an agent switched to Orca can save and run.** An agent whose settings sync through its
  community could not save ("This agent type has no synced settings") or start on this type. The
  type now syncs the coding agent, workspace, conversations, model and effort; the repository,
  base branch and keep-open choice stay on each computer.
- An agent with no repository uses Orca's first one and says so in its reply, and its Settings tab
  offers that repository, so one Save sets it.

## 0.2.0 (16 Nov 2026)

- **Install and go.** Orca's CLI is found inside `Orca.app` by a short locator the manifest declares,
  so no link or PATH change is needed. A closed Orca is opened when the plugin needs it.
- A new agent starts with Orca's first repository chosen.
- Orca not installed is said plainly in the conversation and in Settings.

## 0.1.0 (16 Nov 2026)

- First release: the **Orca** harness. A mention starts a supervised Orca worker for the
  conversation and posts its report, questions and stops back to the thread.
- Settings for the repository, coding agent, workspace, base branch, model, effort, keeping
  workers open, instructions and conversation scope; an Activity tab of each conversation's worker.
