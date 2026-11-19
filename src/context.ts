// The Buzz conversation a worker hasn't seen yet, read as the agent, as Buzz's
// own harnesses show a session the thread's messages since its last turn.
import type { AgentHandle, HarnessConversation, RelayEvent } from "./buzz";
import { type MediaFile, type MediaRef, mediaLines, mediaRefs, withoutMediaLinks } from "./media";
import { messageText } from "./spec";

/** Chat message kinds: channel messages and DM messages. */
const CHAT = [9, 40002];
/** Messages carried into one turn at most, newest kept. */
export const CONTEXT_LIMIT = 30;
/** Characters of one message carried into a turn at most. */
const CONTENT_LIMIT = 4_000;
const READ_TIMEOUT_MS = 4_000;

export type ContextMessage = Readonly<{
  id: string;
  author: string;
  createdAt: number;
  text: string;
  /** The files it attaches. */
  files: readonly MediaRef[];
}>;

export type Conversation = Readonly<{
  /** Messages after `since`, oldest first, without the agent's own or the
   * triggering message. */
  messages: readonly ContextMessage[];
  /** Who sent the triggering message. */
  from: string;
  /** The triggering message's text, without links to its files. */
  request: string;
  /** The files the triggering message attaches. */
  requestFiles: readonly MediaRef[];
  /** The newest message time read, for the next turn's `since`. */
  latest: number;
}>;

const withTimeout = <T>(work: Promise<T>, fallback: T) =>
  Promise.race([
    work.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), READ_TIMEOUT_MS)),
  ]);

/** Display names for `pubkeys` from their profiles, read as the agent. */
export async function names(
  agent: AgentHandle,
  pubkeys: readonly string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (!pubkeys.length) return found;
  const profiles = await withTimeout(
    agent.query([{ kinds: [0], authors: [...pubkeys], limit: pubkeys.length * 2 }]),
    [] as RelayEvent[],
  );
  const newest = new Map<string, RelayEvent>();
  for (const profile of profiles)
    if ((newest.get(profile.pubkey)?.created_at ?? -1) < profile.created_at)
      newest.set(profile.pubkey, profile);
  for (const [pubkey, profile] of newest) {
    try {
      const body = JSON.parse(profile.content) as { display_name?: unknown; name?: unknown };
      const name =
        (typeof body.display_name === "string" && body.display_name.trim()) ||
        (typeof body.name === "string" && body.name.trim());
      if (name) found.set(pubkey, name);
    } catch {
      // A profile that isn't JSON names no one.
    }
  }
  return found;
}

/** Reads the conversation's messages after `since` (seconds; 0 for all). A
 * failed or slow read gives none: the turn still goes ahead. */
export async function readConversation(
  agent: AgentHandle,
  conversation: HarnessConversation,
  event: RelayEvent,
  since: number,
): Promise<Conversation> {
  const filters = conversation.root
    ? [
        { ids: [conversation.root], "#h": [conversation.channel], limit: 1 },
        { kinds: CHAT, "#h": [conversation.channel], "#e": [conversation.root], limit: 200 },
      ]
    : [{ kinds: CHAT, "#h": [conversation.channel], limit: CONTEXT_LIMIT + 1 }];
  const read = await withTimeout(agent.query(filters), [] as RelayEvent[]);
  const unique = new Map(read.map((item) => [item.id, item]));
  const messages = [...unique.values()]
    .filter(
      (item) =>
        CHAT.includes(item.kind) &&
        item.id !== event.id &&
        item.pubkey !== agent.pubkey &&
        item.created_at > since &&
        item.created_at <= event.created_at,
    )
    .sort((a, b) => a.created_at - b.created_at)
    .slice(-CONTEXT_LIMIT);
  const named = await names(agent, [...new Set([event.pubkey, ...messages.map((item) => item.pubkey)])]);
  const nameOf = (pubkey: string) =>
    named.get(pubkey) ?? (pubkey === agent.owner ? "the owner" : `${pubkey.slice(0, 8)}…`);
  const requestFiles = mediaRefs(event);
  return {
    messages: messages
      .map((item) => {
        const files = mediaRefs(item);
        return {
          id: item.id,
          author: nameOf(item.pubkey),
          createdAt: item.created_at,
          text: withoutMediaLinks(messageText(item.content), files).slice(0, CONTENT_LIMIT),
          files,
        };
      })
      .filter((item) => item.text || item.files.length),
    from: nameOf(event.pubkey),
    request: withoutMediaLinks(messageText(event.content), requestFiles),
    requestFiles,
    latest: Math.max(event.created_at, ...messages.map((item) => item.created_at)),
  };
}

/** The messages as a worker reads them: one line of author and time each,
 * and a line for each file, saved in `files`. */
export function contextText(
  messages: readonly ContextMessage[],
  files: ReadonlyMap<string, MediaFile> = new Map(),
) {
  return messages
    .map((item) => {
      const at = new Date(item.createdAt * 1000).toISOString().slice(0, 16).replace("T", " ");
      const attached = mediaLines(item.files, files).map((line) => `\n  Attached: ${line}`);
      return `- ${item.author} (${at} UTC): ${(item.text || "(no text)").replace(/\n/g, "\n  ")}${attached.join("")}`;
    })
    .join("\n");
}
