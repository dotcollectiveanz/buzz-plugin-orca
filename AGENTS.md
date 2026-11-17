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
- **Orca is reached only through its CLI** (`src/orca.ts`), always with `--json`, and never with an Orca
  terminal's environment (`ENV`): the plugin names its own mailbox terminal with `--from` and
  `--terminal`.
- **The plugin is the coordinator.** It may take its own Runs' mail with a consuming `check`. It never
  steers a worker through its terminal: it uses `send` and `reply`.
- **Chat relays both ways, like Buzz's own harness.** Forward: each turn carries the conversation's
  messages the worker hasn't seen (`seen` on the record), with names. Back: the worker's `status`
  messages are posted as they arrive and the turn goes on; `worker_done`, `question` and `escalation`
  end it. The plugin posts nothing of its own on a normal turn.
- **Files go back through Buzz's own `send`.** A worker attaches files with `Attach: <path>` lines in a
  `status`, `worker_done` or `question` body (Orca's `--payload` can't be combined with `--outcome`).
  The plugin reads them (`src/attachments.ts`) and posts the message with `kit.tools()`'s `send`
  `files`, as Buzz's Claude agent does, so Buzz uploads them and writes the `imeta` tags. Only media
  (by its bytes: images, ISO video, PDF) from inside the worker's workspace, with symbolic links
  resolved, is read: a worker's mail decides what is uploaded. Text sent this way has `@` escaped
  outside code, as `send` would resolve it as a mention. Anything refused, or a `send` that fails,
  falls back to `kit.reply` with a note naming each file and why.
- **Files people send reach the worker as local paths.** The worker can't open Buzz's media links
  (they are fetched only as the agent), so before handing over the plugin saves the files of the
  request and of each message the worker hasn't seen with `agent.media` (`src/media.ts`), as Buzz's
  Claude agent does with `media_get`: Buzz saves them in the system's temp folder. The worker is
  told each file's name, type and path instead of its link. Saves are bounded (count, declared size,
  and a wait inside the two-minute hand-over); a file not saved is still named, with why.
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
  must name its colour. It closes its mailbox terminals; release the workers' terminals if Orca
  hasn't yet. Nothing reaches Buzz.
- Before a release, also try the change in Buzz itself: install from `plugin/`, create an Orca agent,
  mention it, and check its reply and its Activity tab.

## Releases

1. After an Orca update, `npm run catalog` and commit `src/catalog.ts` if it changed.
2. Update `version` in `package.json` and add a `## X.Y.Z (date)` section to `CHANGELOG.md`.
3. `npm run build && npm run check`.
4. Commit, tag `vX.Y.Z` and push the tag. The Release workflow (`.github/workflows/release.yml`)
   checks the tag matches `package.json`, runs the check, and publishes the GitHub release with that
   changelog section and the plugin folder as a zip. Never create a release by hand.
