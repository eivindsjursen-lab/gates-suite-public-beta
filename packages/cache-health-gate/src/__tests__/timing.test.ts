import { describe, it, expect } from "vitest";
import { associateTimings, computeGroupMetrics } from "../metrics/timing.js";
import type { CacheTokenWithContext, CacheStepMarker } from "../parser/types.js";

function token(
  jobName: string,
  group: string,
  stepIndex: number,
  hit = true,
  keyFp = "abc",
): CacheTokenWithContext {
  return { jobName, group, stepIndex, hit, keyFp, raw: `[cache] group=${group}` };
}

function marker(
  jobName: string,
  group: string,
  stepIndex: number,
  durationMs?: number,
): CacheStepMarker {
  const startedAt = "2026-02-01T00:00:00Z";
  const completedAt =
    durationMs !== undefined
      ? new Date(new Date(startedAt).getTime() + durationMs).toISOString()
      : null;
  return {
    jobName,
    group,
    stepIndex,
    startedAt,
    completedAt: completedAt ?? null,
    raw: `[cache-step] group=${group}`,
  };
}

describe("associateTimings", () => {
  it("associates token with nearest preceding marker in same job+group", () => {
    const tokens = [token("build", "deps", 5)];
    const markers = [marker("build", "deps", 2, 500), marker("build", "deps", 4, 300)];

    const { associations, warnings } = associateTimings(tokens, markers);
    expect(associations).toHaveLength(1);
    expect(associations[0]?.markerStepIndex).toBe(4);
    expect(associations[0]?.restoreMs).toBe(300);
    expect(warnings).toContain("WARN_DUPLICATE_CACHE_STEP_GROUP");
  });

  it("does not associate marker from different job", () => {
    const tokens = [token("test", "deps", 3)];
    const markers = [marker("build", "deps", 1, 500)];

    const { associations } = associateTimings(tokens, markers);
    expect(associations[0]?.markerStepIndex).toBeUndefined();
    expect(associations[0]?.restoreMs).toBeUndefined();
  });

  it("does not associate marker from different group", () => {
    const tokens = [token("build", "deps", 3)];
    const markers = [marker("build", "build_cache", 1, 500)];

    const { associations } = associateTimings(tokens, markers);
    expect(associations[0]?.markerStepIndex).toBeUndefined();
  });

  it("does not associate marker that comes after the token", () => {
    const tokens = [token("build", "deps", 2)];
    const markers = [marker("build", "deps", 5, 500)];

    const { associations } = associateTimings(tokens, markers);
    expect(associations[0]?.markerStepIndex).toBeUndefined();
  });

  it("handles missing timing gracefully", () => {
    const tokens = [token("build", "deps", 3)];
    const markers = [marker("build", "deps", 1)];

    const { associations } = associateTimings(tokens, markers);
    expect(associations[0]?.restoreMs).toBeUndefined();
  });

  it("flags duplicate markers", () => {
    const tokens = [token("build", "deps", 5)];
    const markers = [marker("build", "deps", 1, 500), marker("build", "deps", 3, 300)];

    const { associations, warnings } = associateTimings(tokens, markers);
    expect(associations[0]?.duplicate).toBe(true);
    expect(warnings).toContain("WARN_DUPLICATE_CACHE_STEP_GROUP");
  });

  it("no warning for single marker", () => {
    const tokens = [token("build", "deps", 3)];
    const markers = [marker("build", "deps", 1, 500)];

    const { warnings } = associateTimings(tokens, markers);
    expect(warnings).toHaveLength(0);
  });
});

describe("computeGroupMetrics", () => {
  it("computes hit rate and key churn for a single group", () => {
    const tokens = [
      token("build", "deps", 2, true, "aaa"),
      token("build", "deps", 4, true, "aaa"),
      token("build", "deps", 6, false, "bbb"),
    ];
    const assocs = tokens.map((t) => ({
      jobName: t.jobName,
      group: t.group,
      tokenStepIndex: t.stepIndex,
      markerStepIndex: t.stepIndex - 1,
      restoreMs: 500,
      saveMs: undefined,
      duplicate: false,
    }));

    const metrics = computeGroupMetrics(tokens, assocs);
    expect(metrics).toHaveLength(1);

    const m = metrics[0];
    expect(m?.hitRate).toBeCloseTo(2 / 3);
    expect(m?.hits).toBe(2);
    expect(m?.restoreAttempts).toBe(3);
    expect(m?.keyChurn).toBeCloseTo(2 / 3);
    expect(m?.distinctKeyFps).toBe(2);
    expect(m?.restoreMs).toBe(500);
  });

  it("separates metrics by (job, group)", () => {
    const tokens = [
      token("build", "deps", 2, true, "aaa"),
      token("build", "build_cache", 4, false, "bbb"),
      token("test", "deps", 2, true, "ccc"),
    ];
    const assocs = tokens.map((t) => ({
      jobName: t.jobName,
      group: t.group,
      tokenStepIndex: t.stepIndex,
      markerStepIndex: undefined,
      restoreMs: undefined,
      saveMs: undefined,
      duplicate: false,
    }));

    const metrics = computeGroupMetrics(tokens, assocs);
    expect(metrics).toHaveLength(3);
  });

  it("handles empty token list", () => {
    expect(computeGroupMetrics([], [])).toEqual([]);
  });
});

describe("matrix stress: repeated groups across many jobs", () => {
  it("keeps (job, group) keying separate across matrix entries", () => {
    const matrixJobs = Array.from({ length: 20 }, (_, i) => `test (node-${i})`);
    const tokens: CacheTokenWithContext[] = [];
    const markers: CacheStepMarker[] = [];

    for (const jobName of matrixJobs) {
      markers.push(marker(jobName, "deps", 1, 450));
      tokens.push(token(jobName, "deps", 2, true, `fp_${jobName}`));
    }

    const { associations } = associateTimings(tokens, markers);
    expect(associations).toHaveLength(20);

    for (const assoc of associations) {
      expect(assoc.markerStepIndex).toBe(1);
    }

    const metrics = computeGroupMetrics(tokens, associations);
    expect(metrics).toHaveLength(20);

    for (const m of metrics) {
      expect(m.restoreAttempts).toBe(1);
      expect(m.distinctKeyFps).toBe(1);
      expect(m.keyChurn).toBe(1);
    }
  });

  it("handles 100 groups in a single job without collisions", () => {
    const tokens: CacheTokenWithContext[] = [];
    const markers: CacheStepMarker[] = [];

    for (let i = 0; i < 100; i++) {
      const group = `group_${i}`;
      markers.push(marker("mega-job", group, i * 2 + 1, 100));
      tokens.push(token("mega-job", group, i * 2 + 2, true, `fp_${i}`));
    }

    const { associations, warnings } = associateTimings(tokens, markers);
    expect(associations).toHaveLength(100);
    expect(warnings).toHaveLength(0);

    const metrics = computeGroupMetrics(tokens, associations);
    expect(metrics).toHaveLength(100);

    for (const m of metrics) {
      expect(m.hitRate).toBe(1);
      expect(m.restoreMs).toBe(100);
    }
  });
});
