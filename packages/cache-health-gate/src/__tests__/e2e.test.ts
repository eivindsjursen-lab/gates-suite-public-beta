import { describe, it, expect } from "vitest";
import type { WorkflowJob, WorkflowStep } from "@gates-suite/core";

import { extractCacheData } from "../parser/token-parser.js";
import { associateTimings, computeGroupMetrics } from "../metrics/timing.js";
import { evaluatePolicy } from "../policy/evaluate.js";
import type { CachePolicyConfig, CacheBaselineMetrics } from "../policy/types.js";

function makeStep(name: string, number: number, durationMs = 60000): WorkflowStep {
  const startedAt = "2026-02-01T00:00:00Z";
  const completedAt = new Date(new Date(startedAt).getTime() + durationMs).toISOString();
  return {
    name,
    number,
    status: "completed",
    conclusion: "success",
    started_at: startedAt,
    completed_at: completedAt,
  };
}

function makeJob(name: string, steps: WorkflowStep[]): WorkflowJob {
  return {
    id: Math.floor(Math.random() * 100000),
    run_id: 1001,
    name,
    status: "completed",
    conclusion: "success",
    started_at: "2026-02-01T00:00:00Z",
    completed_at: "2026-02-01T00:10:00Z",
    steps,
  };
}

describe("end-to-end: full pipeline without API mocking", () => {
  it("produces PASS result for healthy cache", () => {
    const currentJobs = [
      makeJob("build", [
        makeStep("[cache-step] group=deps", 1, 500),
        makeStep("[cache] group=deps hit=true key_fp=abc123 key_hint=pnpm", 2),
        makeStep("Run tests", 3),
      ]),
    ];

    const baselineJobs = [
      makeJob("build", [
        makeStep("[cache-step] group=deps", 1, 480),
        makeStep("[cache] group=deps hit=true key_fp=abc123 key_hint=pnpm", 2),
      ]),
    ];

    const { tokens: currentTokens, markers: currentMarkers } = extractCacheData(currentJobs);
    const { associations, warnings } = associateTimings(currentTokens, currentMarkers);
    const currentMetrics = computeGroupMetrics(currentTokens, associations);

    const { tokens: baseTokens, markers: baseMarkers } = extractCacheData(baselineJobs);
    const { associations: baseAssocs } = associateTimings(baseTokens, baseMarkers);
    const baseMetrics = computeGroupMetrics(baseTokens, baseAssocs);

    const baselineByGroup = new Map<string, CacheBaselineMetrics>();
    for (const m of baseMetrics) {
      baselineByGroup.set(`${m.jobName}::${m.group}`, {
        hitRate: m.hitRate,
        restoreMs: m.restoreMs,
      });
    }

    const config: CachePolicyConfig = {
      mode: "fail",
      thresholds: { hitRateDropPct: 5, restoreRegressionPct: 20, restoreHardMs: 30000 },
      noBaselineBehavior: "warn",
    };

    const result = evaluatePolicy(currentMetrics, baselineByGroup, "high", config, warnings);
    expect(result.verdict).toBe("pass");
    expect(result.reasonCodes).toContain("PASS_ALL_CLEAR");
  });

  it("produces FAIL result for cache regression", () => {
    const currentJobs = [
      makeJob("build", [
        makeStep("[cache-step] group=deps", 1, 500),
        makeStep("[cache] group=deps hit=false key_fp=new_key_fp", 2),
      ]),
    ];

    const { tokens, markers } = extractCacheData(currentJobs);
    const { associations, warnings } = associateTimings(tokens, markers);
    const currentMetrics = computeGroupMetrics(tokens, associations);

    const baselineByGroup = new Map<string, CacheBaselineMetrics>([
      ["build::deps", { hitRate: 0.95, restoreMs: 500 }],
    ]);

    const config: CachePolicyConfig = {
      mode: "fail",
      thresholds: { hitRateDropPct: 5, restoreRegressionPct: 20, restoreHardMs: 30000 },
      noBaselineBehavior: "warn",
    };

    const result = evaluatePolicy(currentMetrics, baselineByGroup, "high", config, warnings);
    expect(result.verdict).toBe("fail");
    expect(result.reasonCodes).toContain("FAIL_HIT_RATE_DROP");
  });

  it("produces SKIP result when no cache tokens found", () => {
    const jobs = [makeJob("build", [makeStep("Checkout", 1), makeStep("Run tests", 2)])];

    const { tokens, markers } = extractCacheData(jobs);
    const { associations, warnings } = associateTimings(tokens, markers);
    const currentMetrics = computeGroupMetrics(tokens, associations);

    const config: CachePolicyConfig = {
      mode: "fail",
      thresholds: { hitRateDropPct: 5, restoreRegressionPct: 20, restoreHardMs: 30000 },
      noBaselineBehavior: "warn",
    };

    const result = evaluatePolicy(currentMetrics, new Map(), "high", config, warnings);
    expect(result.verdict).toBe("skipped");
    expect(result.reasonCodes).toContain("SKIP_NO_CACHE_DETECTED");
  });

  it("degrades to WARN in warn mode", () => {
    const currentJobs = [
      makeJob("build", [
        makeStep("[cache-step] group=deps", 1, 500),
        makeStep("[cache] group=deps hit=false key_fp=new_key_fp", 2),
      ]),
    ];

    const { tokens, markers } = extractCacheData(currentJobs);
    const { associations, warnings } = associateTimings(tokens, markers);
    const currentMetrics = computeGroupMetrics(tokens, associations);

    const baselineByGroup = new Map<string, CacheBaselineMetrics>([
      ["build::deps", { hitRate: 0.95, restoreMs: 500 }],
    ]);

    const config: CachePolicyConfig = {
      mode: "warn",
      thresholds: { hitRateDropPct: 5, restoreRegressionPct: 20, restoreHardMs: 30000 },
      noBaselineBehavior: "warn",
    };

    const result = evaluatePolicy(currentMetrics, baselineByGroup, "high", config, warnings);
    expect(result.verdict).toBe("warn");
    expect(result.reasonCodes).toContain("WARN_HIT_RATE_DROP");
    expect(result.reasonCodes).not.toContain("FAIL_HIT_RATE_DROP");
  });
});

describe("end-to-end: multi-group multi-job scenario", () => {
  it("evaluates complex matrix workflow correctly", () => {
    const jobs = [
      makeJob("build (ubuntu, node-20)", [
        makeStep("[cache-step] group=deps", 1, 300),
        makeStep("[cache] group=deps hit=true key_fp=lock_hash key_hint=pnpm", 2),
        makeStep("[cache-step] group=build_cache", 3, 1200),
        makeStep("[cache] group=build_cache hit=false key_fp=build_hash", 4),
      ]),
      makeJob("build (ubuntu, node-22)", [
        makeStep("[cache-step] group=deps", 1, 350),
        makeStep("[cache] group=deps hit=true key_fp=lock_hash key_hint=pnpm", 2),
        makeStep("[cache-step] group=build_cache", 3, 1100),
        makeStep("[cache] group=build_cache hit=true key_fp=build_hash", 4),
      ]),
    ];

    const { tokens, markers } = extractCacheData(jobs);
    expect(tokens).toHaveLength(4);
    expect(markers).toHaveLength(4);

    const { associations, warnings } = associateTimings(tokens, markers);
    const metrics = computeGroupMetrics(tokens, associations);

    expect(metrics).toHaveLength(4);

    const baselines = new Map<string, CacheBaselineMetrics>([
      ["build (ubuntu, node-20)::deps", { hitRate: 1.0, restoreMs: 280 }],
      ["build (ubuntu, node-20)::build_cache", { hitRate: 0.8, restoreMs: 1000 }],
      ["build (ubuntu, node-22)::deps", { hitRate: 1.0, restoreMs: 320 }],
      ["build (ubuntu, node-22)::build_cache", { hitRate: 0.8, restoreMs: 1000 }],
    ]);

    const config: CachePolicyConfig = {
      mode: "fail",
      thresholds: { hitRateDropPct: 5, restoreRegressionPct: 20, restoreHardMs: 30000 },
      noBaselineBehavior: "warn",
    };

    const result = evaluatePolicy(metrics, baselines, "high", config, warnings);

    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    const buildCacheViolation = result.violations.find(
      (v) =>
        v.jobName === "build (ubuntu, node-20)" &&
        v.group === "build_cache" &&
        v.reasonCode === "FAIL_HIT_RATE_DROP",
    );
    expect(buildCacheViolation).toBeDefined();
  });
});
