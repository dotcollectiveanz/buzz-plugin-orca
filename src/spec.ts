// What an Orca worker is told, and the names Orca shows for it.
import type { Config } from "./settings";

/** A message's text without the `nostr:` mentions Buzz writes for people
 * and agents, which mean nothing to an Orca worker. */
export function messageText(content: string) {
  return content
    .replace(/nostr:(npub1|nprofile1)[0-9a-z]+/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** A short title for the Task: the request's first line. */
export function taskTitle(text: string, limit = 60) {
  const line = text.split("\n").find((value) => value.trim())?.trim() ?? "";
  const title = line || "Request from Buzz";
  return title.length > limit ? `${title.slice(0, limit - 1).trimEnd()}…` : title;
}

/** A worktree name for a conversation: `buzz-<words>-<id>`, short, lowercase
 * and safe for a Git branch. */
export function workspaceName(title: string, id: string) {
  const words = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28)
    .replace(/-+$/g, "");
  const suffix = id.replace(/[^0-9a-f]/gi, "").slice(0, 6).toLowerCase() || "x";
  return ["buzz", words, suffix].filter(Boolean).join("-");
}

/** The `--worktree` flags for a new worker. */
export function placementArgs(
  settings: Pick<Config, "placement" | "baseBranch">,
  repo: Readonly<{ id: string; path: string }>,
  name: string,
): string[] {
  if (settings.placement === "main") return ["--worktree", `path:${repo.path}`];
  return [
    "--worktree",
    "new-top-level",
    "--repo",
    `id:${repo.id}`,
    "--name",
    name,
    ...(settings.baseBranch ? ["--base-branch", settings.baseBranch] : []),
  ];
}

const ATTACH =
  "- To attach files to any of these messages (a screenshot, an image, a video, a PDF), add a line `Attach: <path>` to its body for each, up to 10, with the path inside your workspace (relative to it, or absolute). Save or copy a file into your workspace first. Images, videos (MP4, MOV) and PDFs only. The lines are taken out and the files posted with the message.";
/** What a worker on a remote Orca server is told instead of `ATTACH`. */
const NO_ATTACH =
  "- You run on a remote Orca server, so files can't be attached to your messages yet, and files people send in Buzz don't reach you. Link to them (a pull request, a hosted preview) or describe them instead.";

/** How the worker talks with the Buzz conversation, as Buzz's own Claude
 * agent does with its tools: messages any time, a final reply, questions. */
export const RELAY = [
  "You are the Buzz agent in this conversation: whatever you post appears in Buzz as its message, so write as you would reply in chat. Your messages go only to this conversation.",
  "- To post a message while you work (a progress note, a partial result, a link to look at), run `orca orchestration send --type status --subject \"<a few words>\" --body \"<the message>\"`. Post when it helps the person; not for every step.",
  "- Your `worker_done` report is your reply for this turn: write it for the person who asked, with what you did, the outcome and its evidence, and anything open. Markdown is fine.",
  ATTACH,
  "- If you need a decision or information only they have, `ask` the coordinator and end your turn. Your question is posted to them, and their answer comes back to you.",
  "- Never end a turn silently. End it with `worker_done` (your reply), an `ask`, or, when you are waiting on background work (subagents, a `/loop`, a long build or review), a `status` saying what you are waiting on. When that work finishes, carry on and send `worker_done` with the result.",
  "- Nobody in Buzz can see your terminal. Don't use interactive question forms, option pickers or plan-approval prompts (such as AskUserQuestion or ExitPlanMode); ask in plain text with `ask` instead.",
  "- New messages in the conversation reach you as follow-up Tasks, with what was said since your last message.",
].join("\n");

/** The worker's Task: who asked and where, the agent's instructions, what was
 * said before in the conversation, the request, and how to talk back. */
export function workerSpec(
  options: Readonly<{
    request: string;
    from?: string;
    where: string;
    agentName: string;
    instructions: string;
    context?: string;
    /** The worker runs on a remote Orca server: no files either way. */
    remote?: boolean;
  }>,
) {
  const instructions = options.instructions.trim();
  return [
    `This Task comes from Buzz, DotCollective's chat: ${options.from ?? "the owner"} asked the Buzz agent "${options.agentName}" in ${options.where}.`,
    instructions && `The agent's standing instructions:\n\n${instructions}`,
    options.context && `Earlier in the conversation (context, not new requests):\n\n${options.context}`,
    `The request from ${options.from ?? "the owner"}:\n\n${options.request}`,
    options.remote ? RELAY.replace(ATTACH, NO_ATTACH) : RELAY,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** A follow-up for a worker: what was said since, then the new message. */
export function followUpText(
  options: Readonly<{ request: string; from: string; context?: string }>,
) {
  return [
    options.context && `Said in the conversation since your last message (context, not new requests):\n\n${options.context}`,
    `New message from ${options.from}:\n\n${options.request || "(no text)"}`,
    "Reply as before: `status` messages while you work if useful, and `worker_done` with your reply.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Buzz's reply for a worker's report. */
export function reportText(body: string, outcome?: string) {
  const text = body.trim() || "The worker reported without a summary.";
  return outcome === "failed" ? `**The worker reported a failure.**\n\n${text}` : text;
}

/** Buzz's reply for a worker's question. Only a reply that tags the agent
 * reaches the worker, so it says so. */
export function questionText(body: string, agentName: string) {
  return `**The Orca worker asks:**\n\n${body.trim()}\n\nReply here and tag @${agentName} so the worker gets your answer.`;
}

/** Why files can't go either way for a worker on a remote Orca server. */
export const REMOTE_FILES = "files can't reach a worker on a remote Orca server yet";
export const REMOTE_ATTACH = "files from a remote Orca server can't be attached yet";

/** Orca's stop reasons that may only mean the worker is idle on purpose
 * (waiting on background work) or misread as a prompt: the plugin keeps
 * following the worker through them. */
export const SOFT_STOPS: ReadonlySet<string> = new Set(["finished", "needs-input"]);

/** What a stop's body says the worker last showed, without the
 * coordinator's Orca CLI instructions, which nobody in Buzz can run. */
export function lastOutput(body: string | undefined) {
  const text = (body ?? "").trim();
  const marker = text.match(/^Last output:\s*$/m);
  const tail = marker ? text.slice((marker.index ?? 0) + marker[0].length) : text;
  return tail
    .split("\n")
    .filter(
      (line) =>
        !/^Full output: /.test(line) &&
        !/^Worker \S+ (ended its turn|is stopped at a prompt|exited)/.test(line) &&
        !/^The Dispatch is still open\./.test(line) &&
        !/^If it is idle on purpose, leave it/.test(line) &&
        !/\borchestration (send|reply|worker-read|worker-show|worker-stop|check)\b/.test(line),
    )
    .join("\n")
    .trim();
}

/** Plain words for Orca's stop reasons. */
const REASONS: Readonly<Record<string, string>> = {
  finished: "it ended its turn without a reply",
  errored: "it hit an error",
  exited: "its process ended",
  "needs-input": "it is waiting at a prompt",
};

/** Buzz's reply when a worker stopped without reporting. */
export function stoppedText(reason: string | undefined, body: string | undefined, agentName: string) {
  const why = reason ? (REASONS[reason] ?? reason) : "";
  const last = lastOutput(body);
  return [
    `**The Orca worker stopped without reporting**${why ? `: ${why}.` : "."}`,
    last && `Its last output:\n\n${quote(last)}`,
    `Reply here and tag @${agentName} to send it more work, or open it in Orca from the agent's Activity tab.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Buzz's message when a worker waits at a prompt in its terminal, which
 * nobody can answer from Buzz. `reason` is Orca's, when it confirmed one. */
export function waitingText(reason: string | undefined, body: string | undefined, agentName: string) {
  const last = lastOutput(body);
  return [
    reason
      ? `**The Orca worker is waiting at a prompt in its terminal** (${reason}).`
      : "**The Orca worker may be waiting at a prompt in its terminal.** Orca couldn't confirm it.",
    last && `What it shows:\n\n${quote(last)}`,
    `This can't be answered from Buzz: open the worker in Orca (Show in Orca, in the agent's Activity tab) to answer it. To give it other instructions instead, reply here and tag @${agentName}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** What the plugin sends a worker that ended its turn without a reply. */
export const NUDGE =
  "You ended your turn without `worker_done`. If you are waiting on background work, send a `status` saying what you are waiting on, then carry on when it finishes. Otherwise send `worker_done` with your reply now.";

/** `text` as a Markdown quote, its last lines only. */
function quote(text: string, lines = 12) {
  const kept = text.split("\n").slice(-lines);
  return kept.map((line) => `> ${line}`).join("\n");
}
