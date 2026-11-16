// Loads the built plugin.js as Buzz does and renders its views.
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentType } from "./buzz";
import { fakeKit, THREAD } from "./fake";

const source = readFileSync(new URL("../plugin/plugin.js", import.meta.url), "utf8");

async function load() {
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  return (await import(/* @vite-ignore */ url)) as {
    inject: string[];
    apply(ctx: unknown): void;
  };
}

describe("plugin.js", () => {
  it("registers the Orca agent type and renders its views", async () => {
    const plugin = await load();
    expect(plugin.inject).toEqual(["react", "agents", "host"]);
    let type: AgentType<unknown> | undefined;
    const effects: unknown[] = [];
    plugin.apply({
      react: React,
      agents: { harness: fakeKit(THREAD).kit, register: (value: AgentType<unknown>) => { type = value; } },
      host: { spawn: async () => { throw new Error("no orca in tests"); } },
      effect: (start: () => unknown) => effects.push(start()),
    });
    expect(type?.id).toBe("orca");
    expect(type?.title).toBe("Orca");
    expect(typeof type?.run).toBe("function");
    expect(type?.tabs?.map((tab) => tab.id)).toEqual(["settings", "activity"]);
    const agent = { key: "k", pubkey: "p", name: "Orca", type: "orca/orca", owner: "o", relay: "r", config: type!.defaults().config };
    const create = renderToStaticMarkup(
      React.createElement(type!.Create!, { config: agent.config, onChange: () => undefined, disabled: false }),
    );
    expect(create).toContain("Repository");
    for (const tab of type!.tabs!) {
      const html = renderToStaticMarkup(React.createElement(tab.component, { agent, save: async () => undefined }));
      expect(html.length).toBeGreaterThan(0);
    }
  });

  it("registers without runtime where processes are unavailable", async () => {
    const plugin = await load();
    let type: AgentType<unknown> | undefined;
    plugin.apply({
      react: React,
      agents: { harness: fakeKit(THREAD).kit, register: (value: AgentType<unknown>) => { type = value; } },
      host: {},
      effect: () => undefined,
    });
    expect(type?.run).toBeUndefined();
  });
});
