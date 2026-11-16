# Changelog

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
