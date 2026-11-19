# Instructions for coding agents

This repo is a Buzz desktop plugin (`orca`) that registers an agent harness whose turns run as Orca
orchestration workers. Read [README.md](README.md) first.

## Hard rules

- **One self-contained module.** Buzz loads `plugin/plugin.js` from a blob URL: no runtime imports, no
  CSS or asset files, no code splitting. `build.mjs` and `scripts/check.mjs` enforce it.
- **React comes from Buzz.** Never import `react` or `react-dom` at runtime. JSX compiles to
  `React.createElement` against `src/react.ts`, set from `ctx.react` in `apply`. Tests may import React.
- **Types only from Buzz.** `src/buzz.ts` is a type-only copy of the parts of Buzz's plugin API
  (`@buzz/author`) this plugin uses. Keep it in step with Buzz when the API changes, and never import
  anything from it at runtime.
- **No Buzz UI components.** Buzz exposes none to plugins. Build UI in `src/ui.tsx` with Buzz's global
  `buzz-*` classes and design tokens (`var(--space-2)` etc.), matching Buzz's own markup: choices are
  `ChoiceRow` menus in a `SettingsGroup`, never free text where Orca can list the values.
- **The Settings tab places the host's Harness row** (`settingsHost.typeControl`) first in its identity
  part, or the agent can't change type; it is split (`splitSettings`) into identity and runtime parts.
- **Synced settings are text only**, from `syncedSettingsSchema`: Buzz refuses a non-text value or an
  unknown key, and an agent whose settings sync can't save or start without them.
- **Commit the build.** After changing `src/`, run `npm run build` and commit `plugin/plugin.js`;
  `npm run check` fails if it's stale.
- **Install and go.** The plugin must work with nothing set up beyond installing it in Buzz: no links,
  PATH changes or keys. Buzz runs a declared program by bare name from the PATH, so the manifest declares
  `sh -c <locator> orca`: the locator finds `Orca.app` and execs its CLI with the plugin's arguments,
  or answers `orca_not_installed` as Orca's JSON. It must stay under Buzz's 1,024-byte argument limit.
  A closed Orca is opened (`orca open`) and the call tried once more.
- **The manifest asks only for that process and `files`.** `files` (`host.readFile`,
  `host.resolveDirectory`) is only for reading what workers attach. A `manifest.host` change needs the
  owner's approval on update in Buzz; keep it minimal, and update `scripts/check.mjs` with it.
- **A remote agent's commands all go to its server.** `Config.host` names a saved remote Orca
  server; `Orca.on(host)` adds `--environment <host>` to every command but `open`. A record keeps
  its `host`, and every later call for it (check, send, reply, stop, activate) uses that one, as its
  handles belong to that server. The host stays on the device, never synced.
- **Orca is reached only through its CLI** (`src/orca.ts`), always with `--json`, and never with an Orca
  terminal's environment (`ENV`): the plugin names its own mailbox terminal with `--from` and
  `--terminal`.
- **The plugin is the coordinator.** It may take its own Runs' mail with a consuming `check`. It never
  steers a worker through its terminal: it uses `send` and `reply`.
- **Chat relays both ways, like Buzz's own harness.** Forward: each turn carries the conversation's
  messages the worker hasn't seen (`seen` on the record), with names. Back: the worker's `status`
  messages are posted as they arrive and the turn goes on; `worker_done`, `question` and a hard
  `escalation` (an error, an ended process) end it. The plugin posts nothing of its own on a normal
  turn. Mail left from an earlier turn is posted before a follow-up is sent.
- **Soft stops don't end a turn.** Orca's `finished` and `needs-input` stops often mean the worker is
  idle on purpose, waiting on background work (`SOFT_STOPS` in `src/spec.ts`). The plugin keeps
  following it. On the first `finished` of a turn it sends the worker one nudge (`NUDGE`); on a later
  one it stays quiet if the worker posted a `status` since the last stop, and otherwise posts its
  last output, untagged. On `needs-input` it asks `worker-show --full` first: a prompt Orca confirms,
  or can't check, is posted once, tagging `questionsTo`; one Orca rules out posts nothing. Stop texts
  never carry Orca's CLI instructions (`lastOutput`). A worker that sends no mail for `QUIET_MS`
  after a soft stop is no longer followed.
- **Mail belongs to a dispatch.** A follow-up to a finished worker gets a new dispatch, which `send`
  returns; the record keeps it and the ones it replaced (`older`). Mail from an older dispatch is
  posted but ends nothing. State learned while handling a stop is dropped if a newer turn (`turn`)
  began meanwhile. Every message of a checked batch is posted.
- **Files go back through Buzz's own `send`.** A worker attaches files with `Attach: <path>` lines in a
  `status`, `worker_done` or `question` body (Orca's `--payload` can't be combined with `--outcome`).
  The plugin reads them (`src/attachments.ts`) and posts the message with `kit.tools()`'s `send`
  `files`, as Buzz's Claude agent does, so Buzz uploads them and writes the `imeta` tags. Only media
  (by its bytes: images, ISO video, PDF) from inside the worker's workspace, with symbolic links
  resolved, is read: a worker's mail decides what is uploaded. Text sent this way has `@` escaped
  outside code, as `send` would resolve it as a mention. Anything refused, or a `send` that fails,
  falls back to `kit.reply` with a note naming each file and why.
- **Questions go to `questionsTo`, everything else to the owner.** A worker's `question`, and a
  `needs-input` prompt Orca confirms or can't check, are posted through `send` tagging the agent's
  `questionsTo` (`say(…, "question")`). If they can't be tagged (not in the channel, no `kit.tools`),
  the owner is tagged with `unreachedText` saying why. Stops, errors and failed hand-overs always tag
  the owner. A question tells the answerer to tag the agent: only a mention reaches the worker.
  Buzz gives plugins no member list, so the setting is a public key; the name a question reads for
  it is kept (`NAMES_KEY`) for the Settings and Activity tabs.
- **Remote workers get no files either way, and are told so.** Media people send isn't saved for a
  worker on a remote server (`unsavedMedia`, `REMOTE_FILES`); the worker is told the names and the
  conversation is told once. `Attach:` lines from a remote worker are refused (`REMOTE_ATTACH`)
  without reading this computer's disk, and its brief says not to use them (`NO_ATTACH`).
- **Files people send reach the worker as local paths.** The worker can't open Buzz's media links
  (they are fetched only as the agent), so before handing over the plugin saves the files of the
  request and of each message the worker hasn't seen with `agent.media` (`src/media.ts`), as Buzz's
  Claude agent does with `media_get`: Buzz saves them in the system's temp folder. The worker is
  told each file's name, type and path instead of its link. Saves are bounded (count, declared size,
  and a wait inside the two-minute hand-over); a file not saved is still named, with why.
- **Share lists the worker's coding agent.** Buzz's agent menu offers Share for a type with
  `exportShared`, and a share's instructions come from `carry` (`src/share.ts`). The Marketplace has
  no Orca runtime, so the share names the configured coding agent's runtime (`claude`, `codex`,
  `goose`, `pi`) and its model where Orca sets one; any other agent throws why, which Buzz shows.
  `adopt` takes only instructions from another harness: never a working folder as a repository.
  Don't add `importShared`: Buzz imports a listing as the first type that accepts it, which would
  take Claude and Codex listings from Buzz's own agents.
- **Live tests clean up after themselves.** A live run leaves a "Buzz mailbox" terminal in the repo:
  close it. Never run a live test from a self-restarting launcher (`launchctl submit`, a watch loop).

## Layout

| Path | What it is |
| --- | --- |
| `src/index.tsx` | `apply(ctx)`: registers the agent type, its tabs and icon |
| `src/runtime.ts` | Turns Buzz mentions into Orca workers and posts their mail |
| `src/orca.ts` | Orca's CLI over Buzz's `host.spawn`, and its JSON envelope |
| `src/spec.ts` | The worker's brief, names, placement flags and reply texts |
| `src/settings.ts` | Config, defaults and the repo selector |
| `src/tabs.tsx` | New agent fields, Settings tab and Activity tab |
| `src/ui.tsx` | Buzz-styled controls |
| `src/buzz.ts` | The Buzz plugin API types this plugin uses |
| `src/context.ts` | Reads the conversation as the agent: what a worker hasn't seen, with names |
| `src/attachments.ts` | Files workers attach: `Attach:` lines, the workspace and media checks |
| `src/media.ts` | Files people send: their `imeta` tags, saved with `agent.media` for the worker |
| `src/share.ts` | Share and type changes: `exportShared`, `carry`, `adopt` |
| `src/choices.ts` | Model and thinking rules shared by the menus and the runtime (`launchChoice`) |
| `src/catalog.ts` | GENERATED by `npm run catalog` from the installed Orca: its agents, models and efforts |
| `src/fake.ts` | Test doubles: a fake `orca`, a fake harness kit with `send`, fake files and media, memory storage |

## Checks

- `npm test`: unit tests, including loading the built `plugin.js` and rendering every view.
- `npm run typecheck`.
- `ORCA_LIVE=1 ORCA_REPO=<repo> npx vitest run src/runtime.live.test.ts`: a real worker in your Orca,
  run through the manifest's locator from a PATH with no Orca on it, as Buzz runs it (`ORCA_AGENT`
  picks the agent, default `claude`). Its reply attaches a picture the test puts in the checkout and
  removes after; a second worker is sent a picture saved in the temp folder, as Buzz saves media, and
  must name its colour. With `ORCA_HOST=<saved server>` (and a repo and agent on that server), a third
  runs a worker on that remote server and checks its messages come back. It closes its mailbox terminals; release the workers' terminals if Orca
  hasn't yet. Nothing reaches Buzz.
- Before a release, also try the change in Buzz itself: install from `plugin/`, create an Orca agent,
  mention it, and check its reply and its Activity tab. Say what you tried in the PR's "Tried in
  Buzz" section (`.github/pull_request_template.md`).
- The Check workflow (`.github/workflows/check.yml`) runs `npm run check` on every pull request and
  push to `main`. `main` is protected: changes land through a pull request with that check passing
  and one approving review from someone other than the author.

## Releases

1. After an Orca update, `npm run catalog` and commit `src/catalog.ts` if it changed.
2. Update `version` in `package.json` and `package-lock.json` (its top two `version` fields), and add
   a `## X.Y.Z (date)` section to `CHANGELOG.md`.
3. `npm run build && npm run check`.
4. Commit, tag `vX.Y.Z` and push the tag. The Release workflow (`.github/workflows/release.yml`)
   checks the tag matches `package.json`, runs the check, and publishes the GitHub release with that
   changelog section and the plugin folder as a zip. Never create a release by hand.
