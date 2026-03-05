import { describe, it, expect } from "vitest";
import { computeRunDuration, analyzeDuration } from "../analyzer/duration.js";
import type { WorkflowRun, WorkflowJob, BaselineRunData } from "@gates-suite/core";
import type { DurationAnalyzerConfig } from "../analyzer/types.js";

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 1001,
    workflow_id: 100,
    status: "completed",
    conclusion: "success",
    event: "push",
    head_branch: "main",
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-02-01T00:10:00Z",
    run_started_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

function makeJob(
  name: string,
  durationMs: number,
  steps: { name: string; number: number; durationMs: number }[] = [],
): WorkflowJob {
  const startedAt = "2026-02-01T00:00:00Z";
  const completedAt = new Date(new Date(startedAt).getTime() + durationMs).toISOString();
  return {
    id: Math.floor(Math.random() * 100000),
    run_id: 1001,
    name,
    status: "completed",
    conclusion: "success",
    started_at: startedAt,
    completed_at: completedAt,
    steps: steps.map((s) => ({
      name: s.name,
      number: s.number,
      status: "completed",
      conclusion: "success",
      started_at: startedAt,
      completed_at: new Date(new Date(startedAt).getTime() + s.durationMs).toISOString(),
    })),
  };
}

function makeBaselineRunData(totalMs: number, jobDurations: [string, number][]): BaselineRunData {
  const run = makeRun({
    updated_at: new Date(new Date("2026-02-01T00:00:00Z").getTime() + totalMs).toISOString(),
  });
  const jobs = jobDurations.map(([name, ms]) => makeJob(name, ms));
  return { run, jobs, durationMs: totalMs };
}

const defaultConfig: DurationAnalyzerConfig = {
  regressionThresholdPct: 15,
  budgetTotalMs: undefined,
  budgetPerJobMs: undefined,
};

describe("computeRunDuration", () => {
  it("computes total and per-job durations", () => {
    const run = makeRun();
    const jobs = [
      makeJob("build", 120000, [
        { name: "Checkout", number: 1, durationMs: 5000 },
        { name: "Install deps", number: 2, durationMs: 30000 },
        { name: "Build", number: 3, durationMs: 85000 },
      ]),
      makeJob("test", 60000),
    ];

    const result = computeRunDuration(run, jobs);
    expect(result.totalMs).toBe(600000);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]?.name).toBe("build");
    expect(result.jobs[0]?.durationMs).toBe(120000);
    expect(result.jobs[0]?.steps).toHaveLength(3);
    expect(result.jobs[0]?.steps[0]?.name).toBe("Build");
  });

  it("sorts steps by duration descending", () => {
    const run = makeRun();
    const jobs = [
      makeJob("build", 100000, [
        { name: "Fast step", number: 1, durationMs: 1000 },
        { name: "Slow step", number: 2, durationMs: 90000 },
        { name: "Medium step", number: 3, durationMs: 9000 },
      ]),
    ];

    const result = computeRunDuration(run, jobs);
    const stepNames = result.jobs[0]?.steps.map((s) => s.name);
    expect(stepNames).toEqual(["Slow step", "Medium step", "Fast step"]);
  });

  it("handles jobs without timing data", () => {
    const run = makeRun();
    const jobs: WorkflowJob[] = [
      {
        id: 1,
        run_id: 1001,
        name: "pending",
        status: "queued",
        conclusion: null,
        started_at: null,
        completed_at: null,
      },
    ];

    const result = computeRunDuration(run, jobs);
    expect(result.jobs).toHaveLength(0);
  });
});

describe("analyzeDuration", () => {
  it("detects workflow-level regression", () => {
    const currentRun = {
      runId: 2001,
      totalMs: 700000,
      jobs: [{ name: "build", durationMs: 700000, steps: [] }],
    };

    const baseline = [
      makeBaselineRunData(500000, [["build", 500000]]),
      makeBaselineRunData(520000, [["build", 520000]]),
      makeBaselineRunData(480000, [["build", 480000]]),
    ];

    const result = analyzeDuration(currentRun, baseline, "high", defaultConfig);
    expect(result.regressions.length).toBeGreaterThanOrEqual(1);
    const workflowRegression = result.regressions.find((r) => r.scope === "workflow");
    expect(workflowRegression).toBeDefined();
    expect(workflowRegression?.deltaPct).toBeGreaterThan(15);
  });

  it("detects job-level regression", () => {
    const currentRun = {
      runId: 2001,
      totalMs: 500000,
      jobs: [
        { name: "build", durationMs: 400000, steps: [] },
        { name: "test", durationMs: 100000, steps: [] },
      ],
    };

    const baseline = [
      makeBaselineRunData(400000, [
        ["build", 200000],
        ["test", 100000],
      ]),
    ];

    const result = analyzeDuration(currentRun, baseline, "high", defaultConfig);
    const buildRegression = result.regressions.find((r) => r.name === "build");
    expect(buildRegression).toBeDefined();
    expect(buildRegression?.deltaPct).toBeGreaterThan(15);
  });

  it("returns no regressions when within threshold", () => {
    const currentRun = {
      runId: 2001,
      totalMs: 510000,
      jobs: [{ name: "build", durationMs: 510000, steps: [] }],
    };

    const baseline = [makeBaselineRunData(500000, [["build", 500000]])];

    const result = analyzeDuration(currentRun, baseline, "high", defaultConfig);
    expect(result.regressions).toHaveLength(0);
  });

  it("returns empty when no baseline data", () => {
    const currentRun = {
      runId: 2001,
      totalMs: 500000,
      jobs: [{ name: "build", durationMs: 500000, steps: [] }],
    };

    const result = analyzeDuration(currentRun, [], "low", defaultConfig);
    expect(result.regressions).toHaveLength(0);
    expect(result.baselineMedianMs).toBeUndefined();
  });

  it("sorts regressions by delta descending", () => {
    const currentRun = {
      runId: 2001,
      totalMs: 900000,
      jobs: [
        { name: "build", durationMs: 600000, steps: [] },
        { name: "test", durationMs: 300000, steps: [] },
      ],
    };

    const baseline = [
      makeBaselineRunData(500000, [
        ["build", 300000],
        ["test", 200000],
      ]),
    ];

    const result = analyzeDuration(currentRun, baseline, "high", defaultConfig);
    for (let i = 1; i < result.regressions.length; i++) {
      const prev = result.regressions[i - 1];
      const curr = result.regressions[i];
      if (prev && curr) {
        expect(prev.deltaPct).toBeGreaterThanOrEqual(curr.deltaPct);
      }
    }
  });
});

describe("budget checking", () => {
  it("detects total budget violation", () => {
    const currentRun = {
      runId: 2001,
      totalMs: 700000,
      jobs: [{ name: "build", durationMs: 700000, steps: [] }],
    };

    const config: DurationAnalyzerConfig = {
      regressionThresholdPct: 15,
      budgetTotalMs: 600000,
      budgetPerJobMs: undefined,
    };

    const result = analyzeDuration(currentRun, [], "low", config);
    expect(result.budgetViolations).toHaveLength(1);
    expect(result.budgetViolations[0]?.scope).toBe("workflow");
    expect(result.budgetViolations[0]?.overageMs).toBe(100000);
  });

  it("detects per-job budget violations", () => {
    const currentRun = {
      runId: 2001,
      totalMs: 400000,
      jobs: [
        { name: "build", durationMs: 250000, steps: [] },
        { name: "test", durationMs: 150000, steps: [] },
      ],
    };

    const config: DurationAnalyzerConfig = {
      regressionThresholdPct: 15,
      budgetTotalMs: undefined,
      budgetPerJobMs: 200000,
    };

    const result = analyzeDuration(currentRun, [], "low", config);
    expect(result.budgetViolations).toHaveLength(1);
    expect(result.budgetViolations[0]?.name).toBe("build");
  });

  it("returns no violations when within budget", () => {
    const currentRun = {
      runId: 2001,
      totalMs: 400000,
      jobs: [{ name: "build", durationMs: 400000, steps: [] }],
    };

    const config: DurationAnalyzerConfig = {
      regressionThresholdPct: 15,
      budgetTotalMs: 500000,
      budgetPerJobMs: 500000,
    };

    const result = analyzeDuration(currentRun, [], "low", config);
    expect(result.budgetViolations).toHaveLength(0);
  });
});
