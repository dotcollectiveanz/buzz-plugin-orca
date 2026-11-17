# Orca for Buzz

A [Buzz](https://github.com/block/buzz-app) desktop plugin (`orca`) that adds an **Orca** harness:
Buzz agents that hand each request to a coding agent in [Orca](https://github.com/stablyai/orca) on
your computer, and post its report back to the conversation.

Mention an Orca agent in a channel or a DM. Orca starts a worker (Claude Code, Codex or another
agent Orca knows) in a workspace of the repository you chose. The worker's report is posted to
the thread as the agent's reply. You can watch the worker, or talk to it, in Orca at any time.

## What it does

- **Chat both ways.** As with Buzz's own Claude agent: the worker sees the conversation (what was
  said before, then each new message with what was said since), and its messages appear in the
  thread as the agent while it works, ending with its reply.
- **One worker per conversation.** Each thread (or each channel, if you choose) gets its own
  supervised Orca worker, in a new Orca workspace or in the repository's own checkout.
- **Follow-ups go to the same worker.** Another message in the thread reaches the worker as a
  follow-up Task, even while it is still busy.
- **Files both ways.** Files people attach in the conversation reach the worker: it is told where
  each is saved on this computer. A worker can attach screenshots, images, videos and PDFs from its
  workspace to its messages. They are posted with the message, as Buzz's own agents attach files.
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
- Orca installed on the same computer, with at least one repository added to it.

Nothing else to set up: no link, no PATH change, no key. If Orca is closed, the plugin opens it.

## Install

1. In Buzz: **Settings → Plugins → Manage plugins → Add → Browse** under "Add from folder", pick this
   repository's `plugin/` folder, review the access it asks for, and install.
2. Create an agent with **Orca** as its Harness. It starts with Orca's first repository chosen;
   pick another if you want.
3. Add it to a channel, or open a DM with it, and mention it.

### Access it asks for

- Run Orca's CLI through `sh`. The declared command is a short script that finds `Orca.app` (in
  `/Applications`, in `~/Applications`, or wherever Spotlight finds it, else an `orca` on your
  PATH) and runs its CLI with the plugin's arguments.
- Read files, only to attach what a worker names in its messages: images, videos and PDFs inside
  that worker's own workspace. Nothing else is read. No network, no MCP.

## How it works

The plugin is an Orca orchestration coordinator. For each conversation it:

1. opens one quiet **Buzz mailbox** terminal in the repository (once per repository), because Orca
   sends workers' mail to a terminal and Buzz is not one. The terminal runs `cat > /dev/null`, so
   nothing typed into it does anything;
2. creates a Run from that mailbox (`orca orchestration run-create --from <mailbox>`);
3. starts a worker with the request as its Task (`orca orchestration worker-start --spec-file -`),
   with the conversation's earlier messages, read as the agent, and how to post back. Files attached
   to those messages are saved as the agent (in the system's temp folder, as Buzz's own agents save
   them) and the worker is told where;
4. waits for the Run's mail (`orca orchestration check --terminal <mailbox> --wait`) and posts each
   `status` message (the worker's messages while it works) to the conversation, then the
   `worker_done` reply, a `question` or an `escalation`, which end the turn. Files the worker names
   with `Attach: <path>` lines are posted with the message through Buzz's own `send` tool, which
   uploads them as the agent.

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
ORCA_LIVE=1 ORCA_REPO=<repo> npx vitest run src/runtime.live.test.ts   # a real worker in your Orca, run as Buzz runs it
```

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
