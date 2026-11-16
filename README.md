# Orca for Buzz

A [Buzz](https://github.com/block/buzz-app) desktop plugin (`orca`) that adds an **Orca** harness:
Buzz agents that hand each request to a coding agent in [Orca](https://github.com/stablyai/orca) on
your computer, and post its report back to the conversation.

Mention an Orca agent in a channel or a DM. Orca starts a worker (Claude Code, Codex or another
agent Orca knows) in a workspace of the repository you chose. The worker's report is posted to
the thread as the agent's reply. You can watch the worker, or talk to it, in Orca at any time.

## What it does

- **One worker per conversation.** Each thread (or each channel, if you choose) gets its own
  supervised Orca worker, in a new Orca workspace or in the repository's own checkout.
- **Follow-ups go to the same worker.** Another message in the thread reaches the worker as a
  follow-up Task, even while it is still busy.
- **Questions come to you.** When the worker needs a decision, it asks. The question is posted in
  the thread and tags you. Your next message in the thread is its answer.
- **Stops are reported.** When a worker stops without reporting, the thread says why and tags you.
  Buzz's Stop on a working turn stops the worker.
- **Settings:** repository, coding agent, workspace (new or the checkout), base branch, model,
  effort, whether workers stay open in Orca, instructions for every worker, and conversations
  (per thread or per channel).
- **Activity:** each conversation's worker, its state, and buttons to open the conversation or
  show the worker in Orca.

It acts only on your own mentions, or ones you attested: Buzz's harness kit admits nothing else.
Orca's workers run on your computer with your coding agents' own sign-in and permissions.

## Requirements

- Buzz desktop 1.0 on macOS.
- Orca running on the same computer, with the repository added to it.
- Orca's CLI on the PATH Buzz gets, under the name `orca`. Buzz runs programs by name only. Orca's
  own link in `/usr/local/bin` may not be readable by you, so link it yourself:

  ```sh
  mkdir -p ~/.local/bin
  ln -sf /Applications/Orca.app/Contents/Resources/bin/orca ~/.local/bin/orca
  ```

  `~/.local/bin` must be on your login shell's PATH. Restart Buzz after you add the link. The
  agent's Settings tab says when Orca can't be reached.

## Install

In Buzz: **Settings → Plugins → Manage plugins → Add → Browse** under "Add from folder", pick this
repository's `plugin/` folder, review the access it asks for, and install. Then create an agent with
**Orca** as its Harness, choose its repository, add it to a channel and mention it.

### Access it asks for

- Run `orca` (Orca's CLI). Nothing else: no network, no files, no MCP.

## How it works

The plugin is an Orca orchestration coordinator. For each conversation it:

1. opens one quiet **Buzz mailbox** terminal in the repository (once per repository), because Orca
   sends workers' mail to a terminal and Buzz is not one. The terminal runs `cat > /dev/null`, so
   nothing typed into it does anything;
2. creates a Run from that mailbox (`orca orchestration run-create --from <mailbox>`);
3. starts a worker with the request as its Task (`orca orchestration worker-start --spec-file -`);
4. waits for the Run's mail (`orca orchestration check --terminal <mailbox> --wait`) and posts a
   `worker_done` report, a `question` or an `escalation` to the conversation.

A later message goes to the worker with `orchestration send`, or answers its question with
`orchestration reply`. Each conversation's Run, worker and state are kept in Buzz's local storage.

If Buzz closes while a worker is busy, the worker keeps going in Orca. Its report waits in the
mailbox: Buzz's **Resume** on the stopped turn, or your next message in the thread, picks it up.

## Develop

See [AGENTS.md](AGENTS.md).

```sh
npm install
npm run build        # src/ → plugin/plugin.js
npm test
npm run check        # typecheck, tests, manifest, icon and build freshness
ORCA_LIVE=1 ORCA_REPO=<repo> npx vitest run src/runtime.live.test.ts   # a real worker in your Orca
```

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
