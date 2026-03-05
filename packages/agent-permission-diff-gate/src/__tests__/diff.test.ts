import { describe, it, expect } from "vitest";
import { computeDiff } from "../diff/engine.js";
import type { PermissionSnapshot, AllowlistEntry, Capability } from "../parser/types.js";

function snapshot(
  entries: { capability: string; tool: string; sourceType?: "explicit" | "heuristic" }[],
): PermissionSnapshot {
  return {
    filePath: "test.yml",
    entries: entries.map((e) => ({
      capability: e.capability as Capability,
      tool: e.tool,
      sourceType: e.sourceType ?? "explicit",
      source: "test.yml",
      raw: `${e.tool} -> ${e.capability}`,
    })),
    tools: [],
  };
}

describe("computeDiff", () => {
  it("detects added permissions", () => {
    const base = [snapshot([{ capability: "read.repo", tool: "checkout" }])];
    const head = [
      snapshot([
        { capability: "read.repo", tool: "checkout" },
        { capability: "write.repo", tool: "release" },
      ]),
    ];

    const diff = computeDiff(base, head);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]?.capability).toBe("write.repo");
    expect(diff.hasExpansion).toBe(true);
  });

  it("detects removed permissions", () => {
    const base = [
      snapshot([
        { capability: "read.repo", tool: "checkout" },
        { capability: "write.repo", tool: "release" },
      ]),
    ];
    const head = [snapshot([{ capability: "read.repo", tool: "checkout" }])];

    const diff = computeDiff(base, head);
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0]?.capability).toBe("write.repo");
  });

  it("marks unchanged permissions", () => {
    const s = [snapshot([{ capability: "read.repo", tool: "checkout" }])];
    const diff = computeDiff(s, s);
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.totalChanges).toBe(0);
  });

  it("returns empty diff for empty snapshots", () => {
    const diff = computeDiff([], []);
    expect(diff.totalChanges).toBe(0);
    expect(diff.hasExpansion).toBe(false);
  });

  it("detects escalation for high-risk additions", () => {
    const base = [snapshot([{ capability: "read.repo", tool: "checkout" }])];
    const head = [
      snapshot([
        { capability: "read.repo", tool: "checkout" },
        { capability: "exec.shell", tool: "ssh-action" },
      ]),
    ];

    const diff = computeDiff(base, head);
    expect(diff.hasEscalation).toBe(true);
    expect(diff.highestRiskAdded).toBe("critical");
  });

  it("classifies risk levels correctly", () => {
    const base = [snapshot([])];
    const head = [
      snapshot([
        { capability: "read.repo", tool: "t1" },
        { capability: "write.issues", tool: "t2" },
        { capability: "write.repo", tool: "t3" },
        { capability: "exec.docker", tool: "t4" },
      ]),
    ];

    const diff = computeDiff(base, head);
    expect(diff.added.find((d) => d.tool === "t1")?.riskLevel).toBe("low");
    expect(diff.added.find((d) => d.tool === "t2")?.riskLevel).toBe("medium");
    expect(diff.added.find((d) => d.tool === "t3")?.riskLevel).toBe("high");
    expect(diff.added.find((d) => d.tool === "t4")?.riskLevel).toBe("critical");
  });

  it("counts heuristic entries", () => {
    const base = [snapshot([])];
    const head = [
      snapshot([
        { capability: "read.repo", tool: "checkout", sourceType: "heuristic" },
        { capability: "write.repo", tool: "release", sourceType: "explicit" },
      ]),
    ];

    const diff = computeDiff(base, head);
    expect(diff.heuristicCount).toBe(1);
  });

  it("detects upgrades when tool gains higher-risk capabilities", () => {
    const base = [snapshot([{ capability: "read.repo", tool: "my-tool" }])];
    const head = [
      snapshot([
        { capability: "read.repo", tool: "my-tool" },
        { capability: "write.repo", tool: "my-tool" },
      ]),
    ];

    const diff = computeDiff(base, head);
    expect(diff.upgraded.length + diff.added.length).toBeGreaterThanOrEqual(1);
    expect(diff.hasExpansion).toBe(true);
  });
});

describe("computeDiff — allowlist", () => {
  it("excludes allowlisted capabilities from diff", () => {
    const base = [snapshot([])];
    const head = [
      snapshot([
        { capability: "read.repo", tool: "actions/checkout@v4" },
        { capability: "exec.docker", tool: "docker/build-push-action@v5" },
      ]),
    ];

    const allowlist: AllowlistEntry[] = [
      { tool: "actions/checkout@v4", capabilities: ["read.repo"] },
    ];

    const diff = computeDiff(base, head, allowlist);
    expect(diff.added.find((d) => d.tool === "actions/checkout@v4")).toBeUndefined();
    expect(diff.added.find((d) => d.tool === "docker/build-push-action@v5")).toBeDefined();
  });

  it("partially allowlists: only specified capabilities", () => {
    const base = [snapshot([])];
    const head = [
      snapshot([
        { capability: "read.repo", tool: "my-tool" },
        { capability: "write.repo", tool: "my-tool" },
      ]),
    ];

    const allowlist: AllowlistEntry[] = [{ tool: "my-tool", capabilities: ["read.repo"] }];

    const diff = computeDiff(base, head, allowlist);
    expect(diff.added.find((d) => d.capability === "read.repo")).toBeUndefined();
    expect(diff.added.find((d) => d.capability === "write.repo")).toBeDefined();
  });
});

describe("computeDiff — multi-file scenarios", () => {
  it("aggregates permissions across multiple config files", () => {
    const base = [snapshot([{ capability: "read.repo", tool: "checkout" }])];
    const head = [
      snapshot([{ capability: "read.repo", tool: "checkout" }]),
      snapshot([{ capability: "egress.http", tool: "api-client" }]),
    ];

    const diff = computeDiff(base, head);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]?.capability).toBe("egress.http");
  });

  it("handles configs being removed entirely", () => {
    const base = [
      snapshot([
        { capability: "read.repo", tool: "checkout" },
        { capability: "write.repo", tool: "release" },
      ]),
    ];
    const head: PermissionSnapshot[] = [];

    const diff = computeDiff(base, head);
    expect(diff.removed).toHaveLength(2);
    expect(diff.hasExpansion).toBe(false);
  });
});
