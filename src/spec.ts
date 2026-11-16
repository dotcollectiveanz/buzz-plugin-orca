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

/** How the worker talks with the Buzz conversation, as Buzz's own Claude
 * agent does with its tools: messages any time, a final reply, questions. */
export const RELAY = [
  "You are the Buzz agent in this conversation: whatever you post appears in Buzz as its message, so write as you would reply in chat. Your messages go only to this conversation.",
  "- To post a message while you work (a progress note, a partial result, a link to look at), run `orca orchestration send --type status --subject \"<a few words>\" --body \"<the message>\"`. Post when it helps the person; not for every step.",
  "- Your `worker_done` report is your reply for this turn: write it for the person who asked, with what you did, the outcome and its evidence, and anything open. Markdown is fine.",
  "- If you need a decision or information only they have, `ask` the coordinator and end your turn. Your question is posted to them, and their answer comes back to you.",
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
  }>,
) {
  const instructions = options.instructions.trim();
  return [
    `This Task comes from Buzz, DotCollective's chat: ${options.from ?? "the owner"} asked the Buzz agent "${options.agentName}" in ${options.where}.`,
    instructions && `The agent's standing instructions:\n\n${instructions}`,
    options.context && `Earlier in the conversation (context, not new requests):\n\n${options.context}`,
    `The request from ${options.from ?? "the owner"}:\n\n${options.request}`,
    RELAY,
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

/** Buzz's reply for a worker's question. */
export function questionText(body: string) {
  return `**The Orca worker asks:**\n\n${body.trim()}\n\nReply in this conversation to answer it.`;
}

/** Buzz's reply when a worker stopped without reporting. */
export function stoppedText(reason: string | undefined, body?: string) {
  const detail = [reason && `Reason: ${reason}.`, body?.trim()]
    .filter(Boolean)
    .join("\n\n");
  return `**The Orca worker stopped without reporting.**${detail ? `\n\n${detail}` : ""}\n\nReply here to send it more work, or open it in Orca.`;
}
