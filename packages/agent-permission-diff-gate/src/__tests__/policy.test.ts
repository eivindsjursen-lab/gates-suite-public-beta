import { describe, it, expect } from "vitest";
import { evaluatePermissionPolicy } from "../policy/evaluate.js";
import type { DiffSummary, PermissionDiff } from "../diff/types.js";
import type { PermissionPolicyConfig } from "../policy/types.js";

function makeDiff(overrides: Partial<DiffSummary> = {}): DiffSummary {
  return {
    added: [],
    removed: [],
    upgraded: [],
    unchanged: [],
    hasExpansion: false,
    hasEscalation: false,
    highestRiskAdded: undefined,
    heuristicCount: 0,
    totalChanges: 0,
    ...overrides,
  };
}

function addedDiff(
  capability: string,
  tool: string,
  riskLevel: string,
  sourceType: "explicit" | "heuristic" = "explicit",
): PermissionDiff {
  return {
    capability: capability as PermissionDiff["capability"],
    tool,
    changeType: "added",
    riskLevel: riskLevel as PermissionDiff["riskLevel"],
    sourceType,
    source: "test.yml",
  };
}

const defaultConfig: PermissionPolicyConfig = {
  mode: "fail",
  policyLevel: "standard",
  approvalLabel: "agent-scope-approved",
  hasApprovalLabel: false,
};

describe("evaluatePermissionPolicy", () => {
  describe("no changes", () => {
    it("returns PASS_NO_SCOPE_CHANGE", () => {
      const result = evaluatePermissionPolicy(makeDiff(), defaultConfig);
      expect(result.verdict).toBe("pass");
      expect(result.reasonCodes).toContain("PASS_NO_SCOPE_CHANGE");
    });
  });

  describe("approval label override", () => {
    it("passes even with escalation when label present", () => {
      const diff = makeDiff({
        hasExpansion: true,
        hasEscalation: true,
        highestRiskAdded: "critical",
        added: [addedDiff("exec.shell", "ssh-action", "critical")],
        totalChanges: 1,
      });

      const config = { ...defaultConfig, hasApprovalLabel: true };
      const result = evaluatePermissionPolicy(diff, config);
      expect(result.verdict).toBe("pass");
    });
  });

  describe("standard policy", () => {
    it("fails on high-risk escalation", () => {
      const diff = makeDiff({
        hasExpansion: true,
        hasEscalation: true,
        highestRiskAdded: "high",
        added: [addedDiff("write.repo", "release-tool", "high")],
        totalChanges: 1,
      });

      const result = evaluatePermissionPolicy(diff, defaultConfig);
      expect(result.verdict).toBe("fail");
      expect(result.reasonCodes).toContain("FAIL_CAPABILITY_ESCALATION");
    });

    it("warns on medium-risk expansion", () => {
      const diff = makeDiff({
        hasExpansion: true,
        hasEscalation: false,
        highestRiskAdded: "medium",
        added: [addedDiff("write.issues", "comment-bot", "medium")],
        totalChanges: 1,
      });

      const result = evaluatePermissionPolicy(diff, defaultConfig);
      expect(result.verdict).toBe("warn");
      expect(result.reasonCodes).toContain("WARN_CAPABILITY_EXPANSION");
    });

    it("warns on low-risk expansion", () => {
      const diff = makeDiff({
        hasExpansion: true,
        hasEscalation: false,
        highestRiskAdded: "low",
        added: [addedDiff("read.repo", "checkout", "low")],
        totalChanges: 1,
      });

      const result = evaluatePermissionPolicy(diff, defaultConfig);
      expect(result.verdict).toBe("warn");
      expect(result.reasonCodes).toContain("WARN_CAPABILITY_EXPANSION");
    });
  });

  describe("strict policy", () => {
    it("fails on any expansion", () => {
      const diff = makeDiff({
        hasExpansion: true,
        hasEscalation: false,
        highestRiskAdded: "low",
        added: [addedDiff("read.repo", "checkout", "low")],
        totalChanges: 1,
      });

      const config = { ...defaultConfig, policyLevel: "strict" as const };
      const result = evaluatePermissionPolicy(diff, config);
      expect(result.verdict).toBe("fail");
    });
  });

  describe("lenient policy", () => {
    it("only fails on critical escalation", () => {
      const diff = makeDiff({
        hasExpansion: true,
        hasEscalation: true,
        highestRiskAdded: "high",
        added: [addedDiff("write.repo", "release-tool", "high")],
        totalChanges: 1,
      });

      const config = { ...defaultConfig, policyLevel: "lenient" as const };
      const result = evaluatePermissionPolicy(diff, config);
      expect(result.verdict).toBe("warn");
    });

    it("fails on critical", () => {
      const diff = makeDiff({
        hasExpansion: true,
        hasEscalation: true,
        highestRiskAdded: "critical",
        added: [addedDiff("exec.shell", "ssh-action", "critical")],
        totalChanges: 1,
      });

      const config = { ...defaultConfig, policyLevel: "lenient" as const };
      const result = evaluatePermissionPolicy(diff, config);
      expect(result.verdict).toBe("fail");
    });
  });

  describe("degrade ladder", () => {
    it("degrades to WARN when mode=warn", () => {
      const diff = makeDiff({
        hasExpansion: true,
        hasEscalation: true,
        highestRiskAdded: "critical",
        added: [addedDiff("exec.shell", "ssh", "critical")],
        totalChanges: 1,
      });

      const config = { ...defaultConfig, mode: "warn" as const };
      const result = evaluatePermissionPolicy(diff, config);
      expect(result.verdict).toBe("warn");
      expect(result.reasonCodes).not.toContain("FAIL_CAPABILITY_ESCALATION");
    });

    it("degrades to WARN when confidence is low (all heuristic)", () => {
      const diff = makeDiff({
        hasExpansion: true,
        hasEscalation: true,
        highestRiskAdded: "critical",
        added: [addedDiff("exec.shell", "ssh", "critical", "heuristic")],
        heuristicCount: 1,
        totalChanges: 1,
      });

      const result = evaluatePermissionPolicy(diff, defaultConfig);
      expect(result.verdict).toBe("warn");
      expect(result.confidence).toBe("low");
    });
  });

  describe("heuristic warning", () => {
    it("adds WARN_HEURISTIC_MAPPING when heuristics present", () => {
      const diff = makeDiff({
        hasExpansion: true,
        hasEscalation: false,
        highestRiskAdded: "low",
        added: [addedDiff("read.repo", "checkout", "low", "heuristic")],
        heuristicCount: 1,
        totalChanges: 1,
      });

      const result = evaluatePermissionPolicy(diff, defaultConfig);
      expect(result.reasonCodes).toContain("WARN_HEURISTIC_MAPPING");
    });
  });

  describe("findings", () => {
    it("sorts findings by risk level (critical first)", () => {
      const diff = makeDiff({
        hasExpansion: true,
        hasEscalation: true,
        highestRiskAdded: "critical",
        added: [
          addedDiff("read.repo", "t1", "low"),
          addedDiff("exec.shell", "t2", "critical"),
          addedDiff("write.issues", "t3", "medium"),
        ],
        totalChanges: 3,
      });

      const result = evaluatePermissionPolicy(diff, defaultConfig);
      expect(result.findings[0]?.riskLevel).toBe("critical");
      expect(result.findings[1]?.riskLevel).toBe("medium");
      expect(result.findings[2]?.riskLevel).toBe("low");
    });

    it("includes removed capabilities in findings", () => {
      const diff = makeDiff({
        removed: [
          {
            capability: "write.repo" as PermissionDiff["capability"],
            tool: "old-tool",
            changeType: "removed",
            riskLevel: "high",
            sourceType: "explicit",
            source: "test.yml",
          },
        ],
        totalChanges: 1,
      });

      const result = evaluatePermissionPolicy(diff, defaultConfig);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.changeType).toBe("removed");
    });
  });
});
