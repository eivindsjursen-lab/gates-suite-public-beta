import { describe, it, expect } from "vitest";
import { renderJobSummary, type GateResult } from "@gates-suite/core";

const OPTS = { gateName: "CI Minutes Delta Gate", title: "CI Minutes Delta Gate" };

describe("golden snapshot: CI Minutes Gate job summaries", () => {
  it("PASS — duration within threshold", () => {
    const result: GateResult = {
      result: "pass",
      confidence: "high",
      reason_codes: ["PASS_ALL_CLEAR"],
      baseline_samples: 10,
      fix_suggestions: [],
    };

    expect(renderJobSummary(result, OPTS)).toMatchSnapshot();
  });

  it("FAIL — workflow regression with top jobs", () => {
    const result: GateResult = {
      result: "fail",
      confidence: "high",
      reason_codes: ["FAIL_DURATION_REGRESSION"],
      baseline_samples: 10,
      top_regressions: [
        {
          scope: "workflow",
          name: "total",
          baseline_ms: 410000,
          current_ms: 700000,
          delta_pct: 70.7,
        },
        {
          scope: "job",
          name: "build",
          baseline_ms: 255000,
          current_ms: 500000,
          delta_pct: 96.1,
        },
      ],
      top_findings: [
        { scope: "job", name: "build", risk_level: "high", detail: "8m 20s (+96.1%)" },
        { scope: "job", name: "test", risk_level: "low", detail: "3m 20s (+28.2%)" },
      ],
      fix_suggestions: [
        'Job "build" regressed 71%. Review its steps for new or slower operations.',
      ],
    };

    expect(renderJobSummary(result, OPTS)).toMatchSnapshot();
  });

  it("WARN — degraded from low confidence", () => {
    const result: GateResult = {
      result: "warn",
      confidence: "low",
      reason_codes: ["WARN_DURATION_INCREASE"],
      baseline_samples: 3,
      top_regressions: [
        {
          scope: "workflow",
          name: "total",
          baseline_ms: 300000,
          current_ms: 500000,
          delta_pct: 66.7,
        },
      ],
      fix_suggestions: [
        "Overall workflow duration regressed. Check the top jobs below for the biggest contributors.",
      ],
    };

    expect(renderJobSummary(result, OPTS)).toMatchSnapshot();
  });

  it("WARN — budget exceeded", () => {
    const result: GateResult = {
      result: "warn",
      confidence: "high",
      reason_codes: ["WARN_BUDGET_EXCEEDED"],
      baseline_samples: 10,
      fix_suggestions: [
        "Workflow exceeded budget by 1m 40s. Consider parallelizing steps or caching dependencies.",
      ],
    };

    expect(renderJobSummary(result, OPTS)).toMatchSnapshot();
  });

  it("SKIP — no baseline", () => {
    const result: GateResult = {
      result: "skipped",
      confidence: "low",
      reason_codes: ["SKIP_NO_BASELINE"],
      baseline_samples: 0,
      fix_suggestions: [],
    };

    expect(renderJobSummary(result, OPTS)).toMatchSnapshot();
  });
});
