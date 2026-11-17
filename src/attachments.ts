// Files a worker attaches to its messages, as Buzz's own Claude agent attaches
// them with `send`'s `files`. The worker lists each on its own line as
// `Attach: <path>`; the plugin reads it from the worker's workspace and posts
// it with the message through Buzz's `send` tool, which uploads it as the
// agent. Only media is read, and only from inside the workspace: a worker's
// mail decides what is uploaded, so a stray path can't post a key or a
// config file.
import type { Host } from "./buzz";

/** Files one message may carry. */
export const ATTACH_LIMIT = 10;

/** The host's file access, from the manifest's `host.files`. */
export type Files = Readonly<{
  readFile: NonNullable<Host["readFile"]>;
  resolveDirectory: NonNullable<Host["resolveDirectory"]>;
}>;

export type Attachment = Readonly<{ path: string; name: string; data: Uint8Array }>;
export type Refused = Readonly<{ path: string; reason: string }>;

const FENCE = /^\s*(```|~~~)/;
const ATTACH = /^\s*attach:\s*(.+?)\s*$/i;

/** A message's text without its `Attach: <path>` lines, and their paths.
 * Lines inside fenced code are text. */
export function splitAttachments(body: string): { text: string; paths: string[] } {
  const kept: string[] = [];
  const paths: string[] = [];
  let fenced = false;
  for (const line of body.split("\n")) {
    if (FENCE.test(line)) fenced = !fenced;
    const found = !fenced && line.match(ATTACH);
    if (found) {
      const path = found[1]!.replace(/^(`|"|')(.*)\1$/, "$2").trim();
      if (path && !paths.includes(path)) paths.push(path);
    } else kept.push(line);
  }
  return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(), paths };
}

/** The folder a worker works in: the path in Orca's worktree id
 * (`<repo>::<path>`), else the repository's checkout. */
export function workspaceDir(workspace: string | undefined, repo: string) {
  const at = workspace?.indexOf("::") ?? -1;
  return workspace && at >= 0 && workspace.startsWith("/", at + 2) ? workspace.slice(at + 2) : repo;
}

/** `path` made absolute against `dir`, with `.` and `..` resolved. */
export function absolute(dir: string, path: string) {
  const parts: string[] = [];
  for (const part of (path.startsWith("/") ? path : `${dir}/${path}`).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

const within = (dir: string, path: string) =>
  path === dir || path.startsWith(dir.endsWith("/") ? dir : `${dir}/`);

/** The media types a worker may attach, by their bytes: images, ISO media
 * (MP4, MOV) and PDF. Anything else, such as text, is refused. */
export function mediaType(data: Uint8Array): string | undefined {
  const at = (offset: number, text: string) =>
    [...text].every((char, index) => data[offset + index] === char.charCodeAt(0));
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (at(0, "\x89PNG")) return "image/png";
  if (at(0, "GIF8")) return "image/gif";
  if (at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  if (at(4, "ftyp")) return "video/mp4";
  if (at(0, "%PDF-")) return "application/pdf";
  return undefined;
}

/** A file's name as the message shows it: no `@`, which Buzz's `send` would
 * read as a mention. */
export function attachmentName(path: string) {
  const name = path.split("/").pop() ?? "";
  return name.replace(/@/g, "-") || "file";
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Reads each of `paths` that is media inside the workspace `dir`. */
export async function readAttachments(
  files: Files,
  dir: string,
  paths: readonly string[],
): Promise<{ attached: Attachment[]; refused: Refused[] }> {
  const attached: Attachment[] = [];
  const refused: Refused[] = [];
  let root: string | undefined;
  try {
    root = await files.resolveDirectory(dir, { create: false });
  } catch (error) {
    return { attached, refused: paths.map((path) => ({ path, reason: `its workspace can't be read (${errorText(error)})` })) };
  }
  for (const [index, path] of paths.entries()) {
    if (index >= ATTACH_LIMIT) {
      refused.push({ path, reason: `a message takes at most ${ATTACH_LIMIT} files` });
      continue;
    }
    const full = absolute(dir, path);
    if (!within(dir, full) && !within(root, full)) {
      refused.push({ path, reason: "it is outside the worker's workspace" });
      continue;
    }
    try {
      // Its folder without symbolic links must still be in the workspace.
      const slash = full.lastIndexOf("/");
      const folder = await files.resolveDirectory(full.slice(0, slash) || "/", { create: false });
      if (!within(root, folder)) {
        refused.push({ path, reason: "it is outside the worker's workspace" });
        continue;
      }
      const data = await files.readFile(`${folder}/${full.slice(slash + 1)}`);
      if (!mediaType(data)) {
        refused.push({ path, reason: "only images, videos and PDFs are attached" });
        continue;
      }
      attached.push({ path, name: attachmentName(full), data });
    } catch (error) {
      refused.push({ path, reason: /no such file|not a directory/i.test(errorText(error)) ? "there is no such file" : errorText(error) });
    }
  }
  return { attached, refused };
}

/** A note for files that weren't attached. */
export function refusedText(refused: readonly Refused[]) {
  if (!refused.length) return "";
  return [
    refused.length === 1 ? "_A file couldn't be attached:_" : "_Some files couldn't be attached:_",
    ...refused.map((item) => `- \`${item.path.replace(/`/g, "'")}\`: ${item.reason}`),
  ].join("\n");
}

/** `text` with each `@` that starts a word escaped outside code, so Buzz's
 * `send` posts it as text, as the harness's own replies do, rather than
 * resolving it as a mention. Markdown shows `\@` as `@`. */
export function escapeMentions(text: string) {
  return text
    .split(/(^```[\s\S]*?^```|`[^`\n]*`)/m)
    .map((part, index) => (index % 2 ? part : part.replace(/(^|\s)@/gm, "$1\\@")))
    .join("");
}
