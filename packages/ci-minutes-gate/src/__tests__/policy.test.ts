import { describe, it, expect } from "vitest";
import { evaluateMinutesPolicy } from "../policy/evaluate.js";
import type { DurationAnalysis } from "../analyzer/types.js";
import type { MinutesPolicyConfig } from "../policy/types.js";

function makeAnalysis(overrides: Partial<DurationAnalysis> = {}): DurationAnalysis {
  return {
    currentRun: {
      runId: 1001,
      totalMs: 500000,
      jobs: [
        { name: "build", durationMs: 300000, steps: [] },
        { name: "test", durationMs: 200000, steps: [] },
      ],
    },
    baselineMedianMs: 480000,
    baselineJobMedians: new Map([
      ["build", 280000],
      ["test", 190000],
    ]),
    regressions: [],
    budgetViolations: [],
    confidence: "high",
    baselineSamples: 10,
    ...overrides,
  };
}

const defaultConfig: MinutesPolicyConfig = {
  mode: "fail",
  regressionThresholdPct: 15,
  noBaselineBehavior: "warn",
};

describe("evaluateMinutesPolicy", () => {
  describe("no-baseline handling", () => {
    it("returns WARN when noBaselineBehavior=warn", () => {
      const analysis = makeAnalysis({ baselineSamples: 0 });
      const result = evaluateMinutesPolicy(analysis, {
        ...defaultConfig,
        noBaselineBehavior: "warn",
      });
      expect(result.verdict).toBe("warn");
      expect(result.reasonCodes).toContain("WARN_NO_BASELINE");
    });

    it("returns SKIP when noBaselineBehavior=skip", () => {
      const analysis = makeAnalysis({ baselineSamples: 0 });
      const result = evaluateMinutesPolicy(analysis, {
        ...defaultConfig,
        noBaselineBehavior: "skip",
      });
      expect(result.verdict).toBe("skipped");
      expect(result.reasonCodes).toContain("SKIP_NO_BASELINE");
    });

    it("includes top jobs even without baseline", () => {
      const analysis = makeAnalysis({ baselineSamples: 0 });
      const result = evaluateMinutesPolicy(analysis, defaultConfig);
      expect(result.topJobs.length).toBeGreaterThan(0);
    });
  });

  describe("pass scenarios", () => {
    it("returns PASS_ALL_CLEAR when no regressions", () => {
      const analysis = makeAnalysis();
      const result = evaluateMinutesPolicy(analysis, defaultConfig);
      expect(result.verdict).toBe("pass");
      expect(result.reasonCodes).toContain("PASS_ALL_CLEAR");
    });
  });

  describe("regression detection", () => {
    it("fails when regressions present and confidence high", () => {
      const analysis = makeAnalysis({
        regressions: [
          {
            scope: "workflow",
            name: "total",
            baselineMs: 480000,
            currentMs: 700000,
            deltaPct: 45.8,
          },
        ],
      });

      const result = evaluateMinutesPolicy(analysis, defaultConfig);
      expect(result.verdict).toBe("fail");
      expect(result.reasonCodes).toContain("FAIL_DURATION_REGRESSION");
    });

    it("degrades to WARN when confidence is low", () => {
      const analysis = makeAnalysis({
        confidence: "low",
        regressions: [
          {
            scope: "workflow",
            name: "total",
            baselineMs: 480000,
            currentMs: 700000,
            deltaPct: 45.8,
          },
        ],
      });

      const result = evaluateMinutesPolicy(analysis, defaultConfig);
      expect(result.verdict).toBe("warn");
      expect(result.reasonCodes).toContain("WARN_DURATION_INCREASE");
      expect(result.reasonCodes).not.toContain("FAIL_DURATION_REGRESSION");
    });

    it("degrades to WARN when mode=warn", () => {
      const analysis = makeAnalysis({
        regressions: [
          {
            scope: "workflow",
            name: "total",
            baselineMs: 480000,
            currentMs: 700000,
            deltaPct: 45.8,
          },
        ],
      });

      const result = evaluateMinutesPolicy(analysis, { ...defaultConfig, mode: "warn" });
      expect(result.verdict).toBe("warn");
      expect(result.reasonCodes).toContain("WARN_DURATION_INCREASE");
    });

    it("allows FAIL when confidence=med and mode=fail", () => {
      const analysis = makeAnalysis({
        confidence: "med",
        regressions: [
          {
            scope: "job",
            name: "build",
            baselineMs: 280000,
            currentMs: 500000,
            deltaPct: 78.6,
          },
        ],
      });

      const result = evaluateMinutesPolicy(analysis, defaultConfig);
      expect(result.verdict).toBe("fail");
    });
  });

  describe("budget violations", () => {
    it("warns on budget violation without regression", () => {
      const analysis = makeAnalysis({
        budgetViolations: [
          {
            scope: "workflow",
            name: "total",
            budgetMs: 400000,
            actualMs: 500000,
            overageMs: 100000,
          },
        ],
      });

      const result = evaluateMinutesPolicy(analysis, defaultConfig);
      expect(result.verdict).toBe("warn");
      expect(result.reasonCodes).toContain("WARN_BUDGET_EXCEEDED");
    });

    it("includes budget + regression codes together", () => {
      const analysis = makeAnalysis({
        regressions: [
          {
            scope: "workflow",
            name: "total",
            baselineMs: 480000,
            currentMs: 700000,
            deltaPct: 45.8,
          },
        ],
        budgetViolations: [
          {
            scope: "workflow",
            name: "total",
            budgetMs: 600000,
            actualMs: 700000,
            overageMs: 100000,
          },
        ],
      });

      const result = evaluateMinutesPolicy(analysis, defaultConfig);
      expect(result.verdict).toBe("fail");
      expect(result.reasonCodes).toContain("FAIL_DURATION_REGRESSION");
      expect(result.reasonCodes).toContain("WARN_BUDGET_EXCEEDED");
    });
  });

  describe("top jobs ranking", () => {
    it("returns top 5 jobs sorted by duration", () => {
      const analysis = makeAnalysis({
        currentRun: {
          runId: 1001,
          totalMs: 1000000,
          jobs: Array.from({ length: 8 }, (_, i) => ({
            name: `job-${i}`,
            durationMs: (8 - i) * 100000,
            steps: [],
          })),
        },
      });

      const result = evaluateMinutesPolicy(analysis, defaultConfig);
      expect(result.topJobs).toHaveLength(5);
      expect(result.topJobs[0]?.name).toBe("job-0");
    });

    it("includes delta percentage for jobs with baseline", () => {
      const analysis = makeAnalysis();
      const result = evaluateMinutesPolicy(analysis, defaultConfig);
      const buildJob = result.topJobs.find((j) => j.name === "build");
      expect(buildJob?.deltaPct).toBeDefined();
    });
  });
});
