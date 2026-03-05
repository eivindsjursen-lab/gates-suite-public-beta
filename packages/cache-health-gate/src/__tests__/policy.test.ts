import { describe, it, expect } from "vitest";
import { evaluatePolicy } from "../policy/evaluate.js";
import type { CachePolicyConfig, CacheBaselineMetrics } from "../policy/types.js";
import type { CacheGroupMetrics } from "../metrics/types.js";

function makeMetrics(overrides: Partial<CacheGroupMetrics> = {}): CacheGroupMetrics {
  return {
    jobName: "build",
    group: "deps",
    hitRate: 1.0,
    hits: 10,
    restoreAttempts: 10,
    restoreMs: 500,
    saveMs: undefined,
    keyChurn: 0.1,
    distinctKeyFps: 1,
    keyHint: "pnpm",
    ...overrides,
  };
}

function makeConfig(overrides: Partial<CachePolicyConfig> = {}): CachePolicyConfig {
  return {
    mode: "fail",
    thresholds: {
      hitRateDropPct: 5,
      restoreRegressionPct: 20,
      restoreHardMs: 30000,
    },
    noBaselineBehavior: "warn",
    ...overrides,
  };
}

function baselineMap(entries: [string, CacheBaselineMetrics][]): Map<string, CacheBaselineMetrics> {
  return new Map(entries);
}

describe("evaluatePolicy", () => {
  describe("no-cache detection", () => {
    it("returns SKIP_NO_CACHE_DETECTED when no metrics", () => {
      const result = evaluatePolicy([], new Map(), "low", makeConfig(), []);
      expect(result.verdict).toBe("skipped");
      expect(result.reasonCodes).toContain("SKIP_NO_CACHE_DETECTED");
    });
  });

  describe("no-baseline handling", () => {
    it("returns WARN when noBaselineBehavior=warn", () => {
      const metrics = [makeMetrics()];
      const result = evaluatePolicy(
        metrics,
        new Map(),
        "low",
        makeConfig({ noBaselineBehavior: "warn" }),
        [],
      );
      expect(result.verdict).toBe("warn");
      expect(result.reasonCodes).toContain("WARN_NO_BASELINE");
    });

    it("returns SKIP when noBaselineBehavior=skip", () => {
      const metrics = [makeMetrics()];
      const result = evaluatePolicy(
        metrics,
        new Map(),
        "low",
        makeConfig({ noBaselineBehavior: "skip" }),
        [],
      );
      expect(result.verdict).toBe("skipped");
      expect(result.reasonCodes).toContain("SKIP_NO_BASELINE");
    });
  });

  describe("pass scenarios", () => {
    it("returns PASS_ALL_CLEAR when all metrics healthy", () => {
      const metrics = [makeMetrics({ hitRate: 0.95, restoreMs: 500 })];
      const baselines = baselineMap([["build::deps", { hitRate: 0.95, restoreMs: 480 }]]);
      const result = evaluatePolicy(metrics, baselines, "high", makeConfig(), []);
      expect(result.verdict).toBe("pass");
      expect(result.reasonCodes).toContain("PASS_ALL_CLEAR");
    });
  });

  describe("hit rate drop", () => {
    it("fails on hit rate drop above threshold", () => {
      const metrics = [makeMetrics({ hitRate: 0.85 })];
      const baselines = baselineMap([["build::deps", { hitRate: 0.95, restoreMs: 500 }]]);

      const result = evaluatePolicy(metrics, baselines, "high", makeConfig(), []);
      expect(result.verdict).toBe("fail");
      expect(result.reasonCodes).toContain("FAIL_HIT_RATE_DROP");
      expect(result.violations).toHaveLength(1);
    });

    it("does not trigger below threshold", () => {
      const metrics = [makeMetrics({ hitRate: 0.92 })];
      const baselines = baselineMap([["build::deps", { hitRate: 0.95, restoreMs: 500 }]]);

      const result = evaluatePolicy(metrics, baselines, "high", makeConfig(), []);
      expect(result.verdict).toBe("pass");
      expect(result.reasonCodes).not.toContain("FAIL_HIT_RATE_DROP");
    });
  });

  describe("restore regression", () => {
    it("fails on restore time regression above threshold", () => {
      const metrics = [makeMetrics({ restoreMs: 800 })];
      const baselines = baselineMap([["build::deps", { hitRate: 1.0, restoreMs: 500 }]]);

      const result = evaluatePolicy(metrics, baselines, "med", makeConfig(), []);
      expect(result.verdict).toBe("fail");
      expect(result.reasonCodes).toContain("FAIL_RESTORE_REGRESSION");
    });

    it("does not trigger on small absolute restore delta even when percent threshold is exceeded", () => {
      const metrics = [makeMetrics({ restoreMs: 1000 })];
      const baselines = baselineMap([["build::deps", { hitRate: 1.0, restoreMs: 820 }]]);

      const result = evaluatePolicy(metrics, baselines, "high", makeConfig(), []);
      expect(result.reasonCodes).not.toContain("FAIL_RESTORE_REGRESSION");
    });

    it("triggers when both percent and absolute restore delta thresholds are exceeded", () => {
      const metrics = [makeMetrics({ restoreMs: 1000 })];
      const baselines = baselineMap([["build::deps", { hitRate: 1.0, restoreMs: 700 }]]);

      const result = evaluatePolicy(metrics, baselines, "high", makeConfig(), []);
      expect(result.reasonCodes).toContain("FAIL_RESTORE_REGRESSION");
    });

    it("skips check when baseline restoreMs is undefined", () => {
      const metrics = [makeMetrics({ restoreMs: 5000 })];
      const baselines = baselineMap([["build::deps", { hitRate: 1.0, restoreMs: undefined }]]);

      const result = evaluatePolicy(metrics, baselines, "high", makeConfig(), []);
      expect(result.reasonCodes).not.toContain("FAIL_RESTORE_REGRESSION");
    });

    it("skips check when current restoreMs is undefined", () => {
      const metrics = [makeMetrics({ restoreMs: undefined })];
      const baselines = baselineMap([["build::deps", { hitRate: 1.0, restoreMs: 500 }]]);

      const result = evaluatePolicy(metrics, baselines, "high", makeConfig(), []);
      expect(result.reasonCodes).not.toContain("FAIL_RESTORE_REGRESSION");
    });
  });

  describe("restore hard limit", () => {
    it("fails when restore exceeds hard limit", () => {
      const metrics = [makeMetrics({ restoreMs: 35000 })];
      const baselines = baselineMap([["build::deps", { hitRate: 1.0, restoreMs: 35000 }]]);

      const result = evaluatePolicy(
        metrics,
        baselines,
        "high",
        makeConfig({
          thresholds: { hitRateDropPct: 5, restoreRegressionPct: 20, restoreHardMs: 30000 },
        }),
        [],
      );
      expect(result.verdict).toBe("fail");
      expect(result.violations.some((v) => v.message.includes("hard limit"))).toBe(true);
    });
  });

  describe("key churn warning", () => {
    it("warns on high key churn", () => {
      const metrics = [makeMetrics({ keyChurn: 0.8, distinctKeyFps: 4, restoreAttempts: 5 })];
      const baselines = baselineMap([["build::deps", { hitRate: 1.0, restoreMs: 500 }]]);

      const result = evaluatePolicy(metrics, baselines, "high", makeConfig(), []);
      expect(result.reasonCodes).toContain("WARN_KEY_CHURN");
    });

    it("ignores key churn with fewer than 3 attempts", () => {
      const metrics = [makeMetrics({ keyChurn: 0.8, distinctKeyFps: 2, restoreAttempts: 2 })];
      const baselines = baselineMap([["build::deps", { hitRate: 1.0, restoreMs: 500 }]]);

      const result = evaluatePolicy(metrics, baselines, "high", makeConfig(), []);
      expect(result.reasonCodes).not.toContain("WARN_KEY_CHURN");
    });
  });

  describe("degrade ladder", () => {
    it("degrades FAIL to WARN when confidence is low", () => {
      const metrics = [makeMetrics({ hitRate: 0.5 })];
      const baselines = baselineMap([["build::deps", { hitRate: 0.95, restoreMs: 500 }]]);

      const result = evaluatePolicy(metrics, baselines, "low", makeConfig({ mode: "fail" }), []);
      expect(result.verdict).toBe("warn");
      expect(result.reasonCodes).toContain("WARN_HIT_RATE_DROP");
      expect(result.reasonCodes).not.toContain("FAIL_HIT_RATE_DROP");
    });

    it("degrades FAIL to WARN when mode=warn", () => {
      const metrics = [makeMetrics({ hitRate: 0.5 })];
      const baselines = baselineMap([["build::deps", { hitRate: 0.95, restoreMs: 500 }]]);

      const result = evaluatePolicy(metrics, baselines, "high", makeConfig({ mode: "warn" }), []);
      expect(result.verdict).toBe("warn");
      expect(result.reasonCodes).toContain("WARN_HIT_RATE_DROP");
      expect(result.reasonCodes).not.toContain("FAIL_HIT_RATE_DROP");
    });

    it("allows FAIL when confidence is med and mode=fail", () => {
      const metrics = [makeMetrics({ hitRate: 0.5 })];
      const baselines = baselineMap([["build::deps", { hitRate: 0.95, restoreMs: 500 }]]);

      const result = evaluatePolicy(metrics, baselines, "med", makeConfig({ mode: "fail" }), []);
      expect(result.verdict).toBe("fail");
      expect(result.reasonCodes).toContain("FAIL_HIT_RATE_DROP");
    });

    it("allows FAIL when confidence is high and mode=fail", () => {
      const metrics = [makeMetrics({ hitRate: 0.5 })];
      const baselines = baselineMap([["build::deps", { hitRate: 0.95, restoreMs: 500 }]]);

      const result = evaluatePolicy(metrics, baselines, "high", makeConfig({ mode: "fail" }), []);
      expect(result.verdict).toBe("fail");
    });
  });

  describe("timing warnings propagation", () => {
    it("includes timing warnings in result", () => {
      const metrics = [makeMetrics()];
      const baselines = baselineMap([["build::deps", { hitRate: 1.0, restoreMs: 500 }]]);

      const result = evaluatePolicy(metrics, baselines, "high", makeConfig(), [
        "WARN_DUPLICATE_CACHE_STEP_GROUP",
      ]);
      expect(result.reasonCodes).toContain("WARN_DUPLICATE_CACHE_STEP_GROUP");
      expect(result.verdict).toBe("warn");
    });
  });

  describe("multiple groups", () => {
    it("evaluates each group independently", () => {
      const metrics = [
        makeMetrics({ jobName: "build", group: "deps", hitRate: 0.5 }),
        makeMetrics({ jobName: "build", group: "build_cache", hitRate: 0.95, restoreMs: 500 }),
      ];
      const baselines = baselineMap([
        ["build::deps", { hitRate: 0.95, restoreMs: 500 }],
        ["build::build_cache", { hitRate: 0.95, restoreMs: 500 }],
      ]);

      const result = evaluatePolicy(metrics, baselines, "high", makeConfig(), []);
      expect(result.verdict).toBe("fail");
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]?.group).toBe("deps");
    });
  });
});
