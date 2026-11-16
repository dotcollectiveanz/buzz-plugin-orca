# Changelog

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
