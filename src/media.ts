// Files people attach in Buzz, for the worker: Buzz's media is fetched only as
// the agent, so the worker can't open a message's links. The plugin saves each
// file with the agent's `media` (Buzz checks its hash and keeps it in the
// system's temp folder) and tells the worker where it is, as Buzz's Claude
// agent saves one with `media_get`.
import type { AgentHandle, RelayEvent } from "./buzz";

/** Files saved for one turn at most, newest messages first. */
export const MEDIA_LIMIT = 10;
/** A file declared larger than this is named, not saved. */
export const MEDIA_BYTES = 100 * 1024 * 1024;
/** How long the turn's saves may take: Buzz bounds the whole hand-over. */
export const MEDIA_WAIT_MS = 45_000;

/** A file a message attaches, from its `imeta` tag. */
export type MediaRef = Readonly<{ url: string; name: string; type?: string; size?: number }>;

/** A file as the worker is told of it: where it was saved, or why not. */
export type MediaFile = MediaRef & Readonly<{ path?: string; error?: string }>;

/** The files `event` attaches, by its `imeta` tags. */
export function mediaRefs(event: Pick<RelayEvent, "tags">): MediaRef[] {
  const refs: MediaRef[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== "imeta") continue;
    const fields: Record<string, string> = {};
    for (const field of tag.slice(1)) {
      const space = field.indexOf(" ");
      if (space > 0) fields[field.slice(0, space)] ??= field.slice(space + 1).trim();
    }
    const url = fields.url;
    if (!url || !/^https:\/\//i.test(url) || refs.some((ref) => ref.url === url)) continue;
    const size = /^[1-9]\d*$/.test(fields.size ?? "") ? Number(fields.size) : undefined;
    const name = (fields.filename || url.split(/[?#]/)[0]!.split("/").pop() || "file")
      .replace(/[\u0000-\u001f`]/g, " ")
      .slice(0, 200);
    refs.push({ url, name, ...(fields.m && { type: fields.m }), ...(size && { size }) });
  }
  return refs;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `text` without the Markdown links to its attached files, which the worker
 * can't open: it is told where each was saved instead. */
export function withoutMediaLinks(text: string, refs: readonly MediaRef[]) {
  let result = text;
  for (const { url } of refs)
    result = result.replace(new RegExp(`!?\\[(?:[^\\]\\\\]|\\\\.)*\\]\\(<?${escapeRegExp(url)}>?\\)`, "g"), "");
  return result.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Saves the files of `groups`, the first group first (the request, then
 * the newest messages), up to the limits. Each comes back with its path, or
 * why it wasn't saved; a file past the limit is named only. */
export async function saveMedia(
  agent: AgentHandle,
  groups: readonly (readonly MediaRef[])[],
  waitMs = MEDIA_WAIT_MS,
): Promise<Map<string, MediaFile>> {
  const files = new Map<string, MediaFile>();
  const saves: Promise<void>[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"late">((resolve) => {
    timer = setTimeout(resolve, waitMs, "late");
  });
  for (const ref of groups.flat()) {
    if (files.has(ref.url)) continue;
    if (!agent.media) {
      files.set(ref.url, { ...ref, error: "this version of Buzz can't fetch files for the worker" });
      continue;
    }
    if (saves.length >= MEDIA_LIMIT) {
      files.set(ref.url, { ...ref, error: `only ${MEDIA_LIMIT} files are fetched a turn` });
      continue;
    }
    if (ref.size && ref.size > MEDIA_BYTES) {
      files.set(ref.url, { ...ref, error: "it is over 100 MB" });
      continue;
    }
    files.set(ref.url, { ...ref, error: "it took too long to fetch" });
    saves.push(
      Promise.race([agent.media(ref.url), deadline]).then(
        (saved) => {
          if (saved !== "late")
            files.set(ref.url, { ...ref, path: saved.path, type: saved.type || ref.type, size: saved.size });
        },
        (error: unknown) => {
          files.set(ref.url, { ...ref, error: errorText(error) });
        },
      ),
    );
  }
  await Promise.all(saves);
  clearTimeout(timer);
  return files;
}

const sizeText = (bytes?: number) =>
  bytes === undefined
    ? ""
    : bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** One line for each file: its name and type, and where it is saved. */
export function mediaLines(refs: readonly MediaRef[], files: ReadonlyMap<string, MediaFile>) {
  return refs.map((ref) => {
    const file = files.get(ref.url) ?? { ...ref, error: "it wasn't fetched" };
    const about = [file.type, sizeText(file.size)].filter(Boolean).join(", ");
    const name = `\`${file.name}\`${about ? ` (${about})` : ""}`;
    return file.path ? `${name}, saved at ${file.path}` : `${name}, not available: ${file.error}`;
  });
}

/** The files attached to the request, for the worker's Task. */
export function attachedText(refs: readonly MediaRef[], files: ReadonlyMap<string, MediaFile>) {
  if (!refs.length) return "";
  return [
    "Files attached to this message (open them from where they are saved; they are only on this computer):",
    ...mediaLines(refs, files).map((line) => `- ${line}`),
  ].join("\n");
}
