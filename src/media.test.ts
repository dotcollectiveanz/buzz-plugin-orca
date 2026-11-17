import { describe, expect, it } from "vitest";
import { contextText, readConversation } from "./context";
import { AGENT, attached, chat, fakeMedia, mention, relay, THREAD } from "./fake";
import { attachedText, MEDIA_LIMIT, type MediaFile, mediaLines, mediaRefs, saveMedia, withoutMediaLinks } from "./media";

describe("media from Buzz", () => {
  it("reads a message's files from its imeta tags", () => {
    const shot = attached("cart shot.png");
    expect(mediaRefs({ tags: [shot.tag, shot.tag, ["imeta", "url http://insecure/x.png"], ["e", "x"]] })).toEqual([
      { url: shot.url, name: "cart shot.png", type: "image/png", size: 2048 },
    ]);
    expect(mediaRefs({ tags: [["imeta", "url https://m.example/abc.pdf"]] })).toEqual([
      { url: "https://m.example/abc.pdf", name: "abc.pdf" },
    ]);
  });

  it("drops the links the worker can't open", () => {
    const shot = attached("a.png");
    expect(withoutMediaLinks(`Look at this\n${shot.markdown}\n[keep](https://example.com)`, mediaRefs({ tags: [shot.tag] }))).toBe(
      "Look at this\n\n[keep](https://example.com)",
    );
  });

  it("saves files as the agent, the first group first, within the limits", async () => {
    const big = { url: "https://m.example/big", name: "big.mov", size: 200 * 1024 * 1024 };
    const broken = { url: "https://m.example/broken", name: "broken.png" };
    const many = Array.from({ length: MEDIA_LIMIT }, (_, i) => ({ url: `https://m.example/${i}`, name: `${i}.png` }));
    const { media, asked } = fakeMedia({ [broken.url]: "The community refused the media: 404" });
    const files = await saveMedia({ ...AGENT, media }, [[big, broken], many]);
    expect(asked).toEqual([broken.url, ...many.slice(0, MEDIA_LIMIT - 1).map((ref) => ref.url)]);
    expect(files.get(big.url)?.error).toBe("it is over 100 MB");
    expect(files.get(broken.url)?.error).toBe("The community refused the media: 404");
    expect(files.get(many[0]!.url)?.path).toBe("/tmp/buzz-agent-media/0");
    expect(files.get(many[MEDIA_LIMIT - 1]!.url)?.error).toBe(`only ${MEDIA_LIMIT} files are fetched a turn`);
  });

  it("names files it couldn't fetch in time, or without Buzz's media", async () => {
    const ref = { url: "https://m.example/slow", name: "slow.png" };
    const slow = await saveMedia({ ...AGENT, media: () => new Promise(() => undefined) }, [[ref]], 10);
    expect(slow.get(ref.url)?.error).toBe("it took too long to fetch");
    const old = await saveMedia(AGENT, [[ref]]);
    expect(old.get(ref.url)?.error).toBe("this version of Buzz can't fetch files for the worker");
  });

  it("tells the worker where each file is", () => {
    const ok = { url: "u1", name: "home.png", type: "image/png", size: 2048, path: "/tmp/m/u1.png" };
    const bad = { url: "u2", name: "spec.pdf", error: "it is over 100 MB" };
    const files = new Map<string, MediaFile>([[ok.url, ok], [bad.url, bad]]);
    expect(mediaLines([ok, bad], files)).toEqual([
      "`home.png` (image/png, 2 KB), saved at /tmp/m/u1.png",
      "`spec.pdf`, not available: it is over 100 MB",
    ]);
    expect(attachedText([], files)).toBe("");
    expect(attachedText([ok], files)).toContain("Files attached to this message");
  });

  it("carries files in the conversation, also on messages with no text", async () => {
    const shot = attached("mockup.png");
    relay.events = [
      { ...chat("m1", "annpub", 900, `Here's the mockup\n${shot.markdown}`), tags: [shot.tag] },
      { ...chat("m2", "annpub", 950, shot.markdown), tags: [shot.tag] },
    ];
    relay.queries = [];
    const event = mention("make it so", {}).delivery.trigger.event!;
    const said = await readConversation(AGENT, THREAD, event, 0);
    expect(said.messages.map((item) => [item.text, item.files.length])).toEqual([
      ["Here's the mockup", 1],
      ["", 1],
    ]);
    const files = new Map([[shot.url, { ...mediaRefs({ tags: [shot.tag] })[0]!, path: "/tmp/m.png" }]]);
    const text = contextText(said.messages, files);
    expect(text).toContain("Here's the mockup\n  Attached: `mockup.png` (image/png, 2 KB), saved at /tmp/m.png");
    expect(text).toContain("(no text)\n  Attached:");
  });
});
