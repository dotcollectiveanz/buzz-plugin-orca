// Share and type changes, as Buzz runs them: `exportShared` and `carry` make a
// share (`src/features/agents/agent-share.ts`), and a type change takes the old
// type's `carry` into the new one's `adopt` (`retypePlan` in
// `src/features/agents/service.ts`).
import { describe, expect, it } from "vitest";
import type { Carry } from "./buzz";
import { config, DEFAULT_CONFIG } from "./settings";
import { adopt, carry, exportShared } from "./share";

/** What Buzz lists for a share of `value`, as `shareable` builds it. */
function listed(value: unknown) {
  const shared = exportShared(value);
  return { ...shared, instructions: carry(value).instructions ?? "" };
}

/** Whether a type change keeps each of `brought`, as Buzz's preview says. */
function moved(brought: Carry, into: (carry: Carry) => Carry) {
  const kept = into(brought);
  return Object.fromEntries(
    (Object.keys(brought) as (keyof Carry)[]).map((key) => [key, kept[key] === brought[key]]),
  );
}

describe("share", () => {
  it("lists a Claude worker's agent as a Claude agent with its model and instructions", () => {
    const value = config({ agent: "claude", model: "opus", effort: "max", repo: "dot-mcp", instructions: "Be brief." });
    expect(listed(value)).toEqual({ runtime: "claude", model: "opus", instructions: "Be brief." });
  });

  it("lists Codex with its model, and agents Orca gives no model with none", () => {
    expect(exportShared(config({ agent: "codex", model: "gpt-5.5" }))).toEqual({ runtime: "codex", model: "gpt-5.5" });
    expect(exportShared(config({ agent: "goose", model: "anything" }))).toEqual({ runtime: "goose", model: "" });
    expect(exportShared(config({ agent: "pi" }))).toEqual({ runtime: "pi", model: "" });
    // The agent's own default model is listed as none, as Buzz's Claude does.
    expect(exportShared(DEFAULT_CONFIG)).toEqual({ runtime: "claude", model: "" });
  });

  it("refuses, with why, an agent the Marketplace has no runtime for", () => {
    expect(() => exportShared(config({ agent: "gemini" }))).toThrow(
      /Its workers run Gemini CLI, and the Marketplace lists only Claude Code, Codex, Goose and Pi agents/,
    );
  });

  it("shares nothing of Orca's: the repository, placement and branch stay behind", () => {
    const value = config({ repo: "/Users/me/secret", baseBranch: "release", placement: "main", instructions: "x" });
    expect(JSON.stringify(listed(value))).not.toMatch(/secret|release|main/);
  });

  it("carries only instructions that say something", () => {
    expect(carry(config({ instructions: "  \n" }))).toEqual({});
    expect(carry(config({ instructions: "Use AU English." }))).toEqual({ instructions: "Use AU English." });
  });
});

describe("changing type", () => {
  it("brings a Claude agent's instructions in, and leaves its working folder", () => {
    const from = { instructions: "Review PRs.", workspace: "~/Sites/app" };
    const into = (brought: Carry) => carry(adopt(brought, DEFAULT_CONFIG));
    expect(moved(from, into)).toEqual({ instructions: true, workspace: false });
    expect(adopt(from, config({ repo: "dot-mcp" }))).toMatchObject({ repo: "dot-mcp", instructions: "Review PRs." });
  });

  it("keeps its own instructions when nothing is brought", () => {
    expect(adopt({}, config({ instructions: "Mine." })).instructions).toBe("Mine.");
  });

  it("takes its instructions out to another harness", () => {
    expect(carry(config({ agent: "codex", instructions: "Ship it." }))).toEqual({ instructions: "Ship it." });
  });
});
