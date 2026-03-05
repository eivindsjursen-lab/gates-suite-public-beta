import { describe, it, expect } from "vitest";
import { renderJobSummary, type GateResult } from "@gates-suite/core";

const OPTS = { gateName: "Cache Health Gate", title: "Cache Health Gate" };

describe("golden snapshot: Cache Health Gate job summaries", () => {
  it("PASS — all caches healthy", () => {
    const result: GateResult = {
      result: "pass",
      confidence: "high",
      reason_codes: ["PASS_ALL_CLEAR"],
      baseline_samples: 10,
      fix_suggestions: [],
    };

    const md = renderJobSummary(result, OPTS);
    expect(md).toMatchSnapshot();
  });

  it("WARN — hit rate drop, low confidence degrade", () => {
    const result: GateResult = {
      result: "warn",
      confidence: "low",
      reason_codes: ["WARN_HIT_RATE_DROP", "WARN_LOW_CONFIDENCE"],
      baseline_samples: 3,
      top_regressions: [
        {
          scope: "job",
          name: "build/deps",
          baseline_ms: 950,
          current_ms: 800,
          delta_pct: -15.8,
        },
      ],
      fix_suggestions: [
        'Check cache key composition for group "deps". Ensure key includes only deterministic inputs.',
      ],
    };

    const md = renderJobSummary(result, OPTS);
    expect(md).toMatchSnapshot();
  });

  it("FAIL — multiple violations", () => {
    const result: GateResult = {
      result: "fail",
      confidence: "high",
      reason_codes: ["FAIL_HIT_RATE_DROP", "FAIL_RESTORE_REGRESSION"],
      baseline_samples: 10,
      top_regressions: [
        {
          scope: "job",
          name: "build/deps",
          baseline_ms: 950,
          current_ms: 400,
          delta_pct: -57.9,
        },
        {
          scope: "job",
          name: "build/deps",
          baseline_ms: 500,
          current_ms: 1200,
          delta_pct: 140,
        },
      ],
      fix_suggestions: [
        'Check cache key composition for group "deps".',
        'Investigate cache size growth for group "deps".',
      ],
    };

    const md = renderJobSummary(result, OPTS);
    expect(md).toMatchSnapshot();
  });

  it("SKIP — no cache tokens detected", () => {
    const result: GateResult = {
      result: "skipped",
      confidence: "low",
      reason_codes: ["SKIP_NO_CACHE_DETECTED"],
      baseline_samples: 0,
      fix_suggestions: [],
    };

    const md = renderJobSummary(result, OPTS);
    expect(md).toMatchSnapshot();
  });

  it("WARN — key churn + duplicate cache step", () => {
    const result: GateResult = {
      result: "warn",
      confidence: "med",
      reason_codes: ["WARN_KEY_CHURN", "WARN_DUPLICATE_CACHE_STEP_GROUP"],
      baseline_samples: 8,
      top_findings: [
        {
          scope: "job",
          name: "build/node_modules",
          risk_level: "medium",
          detail: "80% distinct keys (4/5 attempts)",
        },
      ],
      fix_suggestions: [
        'Group "node_modules" has high key churn. Review if volatile inputs are included in the cache key.',
      ],
    };

    const md = renderJobSummary(result, OPTS);
    expect(md).toMatchSnapshot();
  });
});
