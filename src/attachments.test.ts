import { describe, expect, it } from "vitest";
import {
  absolute,
  ATTACH_LIMIT,
  attachmentName,
  escapeMentions,
  mediaType,
  readAttachments,
  refusedText,
  splitAttachments,
  workspaceDir,
} from "./attachments";
import { fakeFiles, PNG, TEXT } from "./fake";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("attachments", () => {
  it("takes Attach lines out of a message, outside code", () => {
    const body = "Here it is.\nAttach: shots/home.png\n  attach: `shots/cart.png`\n\n```\nAttach: not/this.png\n```\nATTACH: \"shots/home.png\"";
    expect(splitAttachments(body)).toEqual({
      text: "Here it is.\n\n```\nAttach: not/this.png\n```",
      paths: ["shots/home.png", "shots/cart.png"],
    });
    expect(splitAttachments("No files.")).toEqual({ text: "No files.", paths: [] });
  });

  it("finds the worker's folder from Orca's worktree id", () => {
    expect(workspaceDir("repo-1::/code/shop-wt", "/code/shop")).toBe("/code/shop-wt");
    expect(workspaceDir(undefined, "/code/shop")).toBe("/code/shop");
    expect(workspaceDir("odd-id", "/code/shop")).toBe("/code/shop");
  });

  it("makes paths absolute in the workspace", () => {
    expect(absolute("/w", "a/./b/../c.png")).toBe("/w/a/c.png");
    expect(absolute("/w", "../../etc/passwd")).toBe("/etc/passwd");
    expect(absolute("/w", "/tmp/x.png")).toBe("/tmp/x.png");
  });

  it("knows media by its bytes, not its name", () => {
    expect(mediaType(PNG)).toBe("image/png");
    expect(mediaType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(mediaType(bytes("GIF89a"))).toBe("image/gif");
    expect(mediaType(bytes("RIFF0000WEBPVP8 "))).toBe("image/webp");
    expect(mediaType(bytes("0000ftypisom"))).toBe("video/mp4");
    expect(mediaType(bytes("%PDF-1.7"))).toBe("application/pdf");
    expect(mediaType(TEXT)).toBeUndefined();
    expect(mediaType(bytes("<svg/>"))).toBeUndefined();
  });

  it("names a file without @, which send would read as a mention", () => {
    expect(attachmentName("/w/shots/me @home.png")).toBe("me -home.png");
    expect(attachmentName("/w/")).toBe("file");
  });

  it("escapes @ outside code only", () => {
    expect(escapeMentions("ask @ann about `@types/node`\n```\n@decorator\n```\nmail a@b.com")).toBe(
      "ask \\@ann about `@types/node`\n```\n@decorator\n```\nmail a@b.com",
    );
  });

  it("reads media inside the workspace and refuses the rest", async () => {
    const files = fakeFiles(
      {
        "/w/shots/a.png": PNG,
        "/w/notes.txt": TEXT,
        "/real/w2/b.png": PNG,
        "/home/me/.ssh/id.png": PNG,
      },
      { "/w/escape": "/home/me/.ssh", "/w2": "/real/w2" },
    );
    const { attached, refused } = await readAttachments(files, "/w", [
      "shots/a.png",
      "notes.txt",
      "../home/me/.ssh/id.png",
      "escape/id.png",
      "/w/missing.png",
    ]);
    expect(attached).toEqual([{ path: "shots/a.png", name: "a.png", data: PNG }]);
    expect(refused).toEqual([
      { path: "notes.txt", reason: "only images, videos and PDFs are attached" },
      { path: "../home/me/.ssh/id.png", reason: "it is outside the worker's workspace" },
      { path: "escape/id.png", reason: "it is outside the worker's workspace" },
      { path: "/w/missing.png", reason: "there is no such file" },
    ]);
    // A workspace reached through a link is the folder it points to.
    const linked = await readAttachments(files, "/w2", ["b.png", "/real/w2/b.png"]);
    expect(linked.attached.map((file) => file.path)).toEqual(["b.png", "/real/w2/b.png"]);
  });

  it("takes at most the limit of files, and says when the workspace is gone", async () => {
    const many = Object.fromEntries(Array.from({ length: ATTACH_LIMIT + 1 }, (_, i) => [`/w/${i}.png`, PNG]));
    const { attached, refused } = await readAttachments(fakeFiles(many), "/w", Object.keys(many));
    expect(attached).toHaveLength(ATTACH_LIMIT);
    expect(refused[0]?.reason).toContain(`at most ${ATTACH_LIMIT}`);
    const gone = await readAttachments(fakeFiles({}), "/gone", ["a.png"]);
    expect(gone.refused[0]?.reason).toContain("its workspace can't be read");
  });

  it("notes the files it couldn't attach", () => {
    expect(refusedText([])).toBe("");
    expect(refusedText([{ path: "a`b.txt", reason: "nope" }])).toBe("_A file couldn't be attached:_\n- `a'b.txt`: nope");
  });
});
