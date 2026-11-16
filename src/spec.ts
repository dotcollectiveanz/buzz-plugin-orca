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

/** The worker's Task: who asked and where, the agent's instructions, the
 * request, and how its report gets back to Buzz. */
export function workerSpec(
  options: Readonly<{
    request: string;
    where: string;
    agentName: string;
    instructions: string;
  }>,
) {
  const instructions = options.instructions.trim();
  return [
    `This Task comes from Buzz, DotCollective's chat: the owner of the Buzz agent "${options.agentName}" asked for it in ${options.where}.`,
    instructions && `Standing instructions from the owner:\n\n${instructions}`,
    `The request:\n\n${options.request}`,
    [
      "How your work gets back to them:",
      "- Your `worker_done` report is posted to the Buzz conversation as the agent's reply. Write it for the person who asked: what you did, the outcome and its evidence, and anything still open. Keep it short. Markdown is fine.",
      "- If you need a decision or information only they have, `ask` the coordinator and end your turn. The question is posted to them in Buzz, and their answer comes back to you.",
      "- More messages from them in the same conversation reach you as follow-up Tasks.",
    ].join("\n"),
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
