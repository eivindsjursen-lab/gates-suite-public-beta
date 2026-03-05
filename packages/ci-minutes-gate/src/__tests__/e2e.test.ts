import { describe, it, expect } from "vitest";
import type { WorkflowRun, WorkflowJob, BaselineRunData } from "@gates-suite/core";
import { computeRunDuration, analyzeDuration } from "../analyzer/duration.js";
import { evaluateMinutesPolicy } from "../policy/evaluate.js";
import type { DurationAnalyzerConfig } from "../analyzer/types.js";
import type { MinutesPolicyConfig } from "../policy/types.js";

function makeRun(totalMs: number): WorkflowRun {
  return {
    id: 1001,
    workflow_id: 100,
    status: "completed",
    conclusion: "success",
    event: "push",
    head_branch: "main",
    created_at: "2026-02-01T00:00:00Z",
    updated_at: new Date(new Date("2026-02-01T00:00:00Z").getTime() + totalMs).toISOString(),
    run_started_at: "2026-02-01T00:00:00Z",
  };
}

function makeJob(name: string, durationMs: number): WorkflowJob {
  const start = "2026-02-01T00:00:00Z";
  return {
    id: Math.floor(Math.random() * 100000),
    run_id: 1001,
    name,
    status: "completed",
    conclusion: "success",
    started_at: start,
    completed_at: new Date(new Date(start).getTime() + durationMs).toISOString(),
    steps: [
      {
        name: "Run step",
        number: 1,
        status: "completed",
        conclusion: "success",
        started_at: start,
        completed_at: new Date(new Date(start).getTime() + durationMs).toISOString(),
      },
    ],
  };
}

function makeBaselineRunData(totalMs: number, jobDurations: [string, number][]): BaselineRunData {
  const run: WorkflowRun = {
    id: Math.floor(Math.random() * 100000),
    workflow_id: 100,
    status: "completed",
    conclusion: "success",
    event: "push",
    head_branch: "main",
    created_at: "2026-01-28T00:00:00Z",
    updated_at: new Date(new Date("2026-01-28T00:00:00Z").getTime() + totalMs).toISOString(),
    run_started_at: "2026-01-28T00:00:00Z",
  };
  const jobs = jobDurations.map(([name, ms]) => makeJob(name, ms));
  return { run, jobs, durationMs: totalMs };
}

const analyzerConfig: DurationAnalyzerConfig = {
  regressionThresholdPct: 15,
  budgetTotalMs: undefined,
  budgetPerJobMs: undefined,
};

const policyConfig: MinutesPolicyConfig = {
  mode: "fail",
  regressionThresholdPct: 15,
  noBaselineBehavior: "warn",
};

describe("end-to-end: full CI Minutes pipeline", () => {
  it("PASS — no regression", () => {
    const run = makeRun(300000);
    const jobs = [makeJob("build", 180000), makeJob("test", 120000)];
    const runDuration = computeRunDuration(run, jobs);

    const baseline = [
      makeBaselineRunData(290000, [
        ["build", 170000],
        ["test", 120000],
      ]),
      makeBaselineRunData(310000, [
        ["build", 190000],
        ["test", 120000],
      ]),
    ];

    const analysis = analyzeDuration(runDuration, baseline, "high", analyzerConfig);
    const result = evaluateMinutesPolicy(analysis, policyConfig);

    expect(result.verdict).toBe("pass");
    expect(result.reasonCodes).toContain("PASS_ALL_CLEAR");
  });

  it("FAIL — workflow-level regression", () => {
    const run = makeRun(700000);
    const jobs = [makeJob("build", 500000), makeJob("test", 200000)];
    const runDuration = computeRunDuration(run, jobs);

    const baseline = [
      makeBaselineRunData(400000, [
        ["build", 250000],
        ["test", 150000],
      ]),
      makeBaselineRunData(420000, [
        ["build", 260000],
        ["test", 160000],
      ]),
    ];

    const analysis = analyzeDuration(runDuration, baseline, "high", analyzerConfig);
    const result = evaluateMinutesPolicy(analysis, policyConfig);

    expect(result.verdict).toBe("fail");
    expect(result.reasonCodes).toContain("FAIL_DURATION_REGRESSION");
    expect(result.regressions.length).toBeGreaterThan(0);
  });

  it("WARN — regression but mode=warn", () => {
    const run = makeRun(700000);
    const jobs = [makeJob("build", 500000), makeJob("test", 200000)];
    const runDuration = computeRunDuration(run, jobs);

    const baseline = [
      makeBaselineRunData(400000, [
        ["build", 250000],
        ["test", 150000],
      ]),
    ];

    const analysis = analyzeDuration(runDuration, baseline, "high", analyzerConfig);
    const result = evaluateMinutesPolicy(analysis, { ...policyConfig, mode: "warn" });

    expect(result.verdict).toBe("warn");
    expect(result.reasonCodes).toContain("WARN_DURATION_INCREASE");
  });

  it("WARN — no baseline", () => {
    const run = makeRun(300000);
    const jobs = [makeJob("build", 300000)];
    const runDuration = computeRunDuration(run, jobs);

    const analysis = analyzeDuration(runDuration, [], "low", analyzerConfig);
    const result = evaluateMinutesPolicy(analysis, policyConfig);

    expect(result.verdict).toBe("warn");
    expect(result.reasonCodes).toContain("WARN_NO_BASELINE");
  });

  it("FAIL + WARN_BUDGET — regression with budget overage", () => {
    const run = makeRun(700000);
    const jobs = [makeJob("build", 500000), makeJob("test", 200000)];
    const runDuration = computeRunDuration(run, jobs);

    const budgetConfig: DurationAnalyzerConfig = {
      regressionThresholdPct: 15,
      budgetTotalMs: 500000,
      budgetPerJobMs: undefined,
    };

    const baseline = [
      makeBaselineRunData(400000, [
        ["build", 250000],
        ["test", 150000],
      ]),
    ];

    const analysis = analyzeDuration(runDuration, baseline, "high", budgetConfig);
    const result = evaluateMinutesPolicy(analysis, policyConfig);

    expect(result.verdict).toBe("fail");
    expect(result.reasonCodes).toContain("FAIL_DURATION_REGRESSION");
    expect(result.reasonCodes).toContain("WARN_BUDGET_EXCEEDED");
  });
});
