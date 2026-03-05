import { describe, it, expect } from "vitest";
import { renderJobSummary } from "../report/markdown.js";
import type { GateResult } from "../schema/result.js";

const reportOptions = {
  title: "Cache Health Gate",
  gateName: "gates-suite/cache-health-gate",
};

describe("renderJobSummary", () => {
  it("renders a PASS result", () => {
    const result: GateResult = {
      result: "pass",
      confidence: "high",
      reason_codes: ["PASS_ALL_CLEAR"],
      baseline_samples: 10,
      baseline: {
        mode: "api",
        branch: "main",
        workflow_id: 123,
        runs: 10,
        samples_used: 10,
      },
      fix_suggestions: [],
    };

    const md = renderJobSummary(result, reportOptions);
    expect(md).toMatchSnapshot();
  });

  it("renders a WARN result with regressions", () => {
    const result: GateResult = {
      result: "warn",
      confidence: "med",
      reason_codes: ["WARN_RESTORE_REGRESSION", "WARN_LOW_CONFIDENCE"],
      baseline_samples: 8,
      baseline: {
        mode: "api",
        branch: "main",
        workflow_id: 456,
        runs: 10,
        samples_used: 8,
      },
      top_regressions: [
        {
          scope: "job",
          name: "test",
          delta_pct: 35.2,
          baseline_ms: 120000,
          current_ms: 162000,
        },
        {
          scope: "step",
          name: "npm install",
          delta_pct: 80.0,
          baseline_ms: 30000,
          current_ms: 54000,
        },
      ],
      fix_suggestions: [
        "Add restore-keys to the cache configuration",
        "Check for new dependencies inflating install time",
      ],
    };

    const md = renderJobSummary(result, reportOptions);
    expect(md).toMatchSnapshot();
  });

  it("renders a FAIL result", () => {
    const result: GateResult = {
      result: "fail",
      confidence: "high",
      reason_codes: ["FAIL_HIT_RATE_DROP", "FAIL_RESTORE_REGRESSION"],
      baseline_samples: 10,
      baseline: {
        mode: "api",
        branch: "main",
        workflow_id: 789,
        runs: 10,
        samples_used: 10,
      },
      top_regressions: [
        {
          scope: "group",
          name: "deps",
          delta_pct: 150.0,
          baseline_ms: 2000,
          current_ms: 5000,
        },
      ],
      fix_suggestions: [
        "Cache key contains dynamic SHA — remove commit-specific components",
        "Add restore-keys fallback for partial cache matches",
      ],
    };

    const md = renderJobSummary(result, reportOptions);
    expect(md).toMatchSnapshot();
  });

  it("renders a SKIPPED result", () => {
    const result: GateResult = {
      result: "skipped",
      confidence: "low",
      reason_codes: ["SKIP_NO_BASELINE"],
      baseline_samples: 0,
      fix_suggestions: [],
    };

    const md = renderJobSummary(result, reportOptions);
    expect(md).toMatchSnapshot();
  });

  it("renders findings for permission diff gate", () => {
    const result: GateResult = {
      result: "fail",
      confidence: "high",
      reason_codes: ["FAIL_CAPABILITY_ESCALATION"],
      baseline_samples: 0,
      top_findings: [
        {
          scope: "network.egress",
          name: "api.openai.com",
          risk_level: "high",
          detail: "New egress domain added",
        },
        {
          scope: "secrets.read",
          name: "OPENAI_KEY",
          risk_level: "high",
          detail: "New secret access",
        },
      ],
      fix_suggestions: ["Add agent-scope-approved label if this expansion is intentional"],
    };

    const md = renderJobSummary(result, {
      title: "Agent Permission Diff Gate",
      gateName: "gates-suite/agent-permission-diff-gate",
    });
    expect(md).toMatchSnapshot();
  });

  it("renders short durations in ms, medium in seconds, long in minutes", () => {
    const result: GateResult = {
      result: "warn",
      confidence: "high",
      reason_codes: ["WARN_DURATION_INCREASE"],
      baseline_samples: 10,
      top_regressions: [
        { scope: "step", name: "quick", delta_pct: 50, baseline_ms: 500, current_ms: 750 },
        { scope: "job", name: "medium", delta_pct: 20, baseline_ms: 15000, current_ms: 18000 },
        { scope: "workflow", name: "ci", delta_pct: 10, baseline_ms: 300000, current_ms: 330000 },
      ],
      fix_suggestions: [],
    };

    const md = renderJobSummary(result, {
      title: "CI Minutes Gate",
      gateName: "gates-suite/ci-minutes-gate",
    });

    expect(md).toContain("500ms");
    expect(md).toContain("750ms");
    expect(md).toContain("15.0s");
    expect(md).toContain("5.0m");
  });

  it("dedupes identical visible regression rows", () => {
    const result: GateResult = {
      result: "warn",
      confidence: "high",
      reason_codes: ["WARN_HIT_RATE_DROP", "WARN_RESTORE_REGRESSION"],
      baseline_samples: 5,
      top_regressions: [
        {
          scope: "job",
          name: "build/deps",
          delta_pct: 100,
          baseline_ms: 500,
          current_ms: 1000,
        },
        {
          scope: "job",
          name: "build/deps",
          delta_pct: 100,
          baseline_ms: 500,
          current_ms: 1000,
        },
      ],
      fix_suggestions: ['Check cache key composition for group "deps".'],
    };

    const md = renderJobSummary(result, reportOptions);
    const row = "| job | build/deps | +100.0% | 500ms | 1.0s |";
    expect(md).toContain(row);
    expect(md.split(row)).toHaveLength(2);
  });
});

describe("serializeResultJson", () => {
  it("produces valid JSON matching the schema", async () => {
    const { serializeResultJson } = await import("../report/output.js");
    const { GateResult } = await import("../schema/result.js");

    const result: GateResult = {
      result: "pass",
      confidence: "high",
      reason_codes: ["PASS_ALL_CLEAR"],
      baseline_samples: 10,
      fix_suggestions: [],
    };

    const json = serializeResultJson(result);
    const parsed = JSON.parse(json) as unknown;
    expect(() => GateResult.parse(parsed)).not.toThrow();
  });
});
