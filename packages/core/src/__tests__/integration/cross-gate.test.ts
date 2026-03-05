/**
 * Cross-gate integration tests verifying that all gates produce
 * valid GateResult shapes and that the shared output pipeline works
 * consistently across all products.
 */
import { describe, it, expect } from "vitest";
import {
  GateResult,
  renderJobSummary,
  serializeResultJson,
  isValidReasonCode,
  getReasonMessage,
  createPassResult,
  createSkippedResult,
} from "../../index.js";

describe("cross-gate: GateResult schema validation", () => {
  const validResults: [string, unknown][] = [
    [
      "cache pass",
      {
        result: "pass",
        confidence: "high",
        reason_codes: ["PASS_ALL_CLEAR"],
        baseline_samples: 10,
        fix_suggestions: [],
      },
    ],
    [
      "cache fail",
      {
        result: "fail",
        confidence: "high",
        reason_codes: ["FAIL_HIT_RATE_DROP", "FAIL_RESTORE_REGRESSION"],
        baseline_samples: 10,
        top_regressions: [
          { scope: "job", name: "build/deps", baseline_ms: 500, current_ms: 1200, delta_pct: 140 },
        ],
        fix_suggestions: ["Check cache key composition."],
      },
    ],
    [
      "minutes warn",
      {
        result: "warn",
        confidence: "low",
        reason_codes: ["WARN_DURATION_INCREASE"],
        baseline_samples: 3,
        fix_suggestions: [],
      },
    ],
    [
      "permissions fail",
      {
        result: "fail",
        confidence: "high",
        reason_codes: ["FAIL_CAPABILITY_ESCALATION"],
        baseline_samples: 0,
        top_findings: [
          { scope: "job", name: "terminal/exec.shell", risk_level: "critical", detail: "added" },
        ],
        fix_suggestions: ["Add approval label."],
      },
    ],
    [
      "skipped",
      {
        result: "skipped",
        confidence: "low",
        reason_codes: ["SKIP_NO_BASELINE"],
        baseline_samples: 0,
        fix_suggestions: [],
      },
    ],
  ];

  it.each(validResults)("validates %s result shape", (_, data) => {
    const parsed = GateResult.safeParse(data);
    expect(parsed.success).toBe(true);
  });

  it("rejects result missing reason_codes", () => {
    const parsed = GateResult.safeParse({
      result: "pass",
      confidence: "high",
      reason_codes: [],
      baseline_samples: 0,
      fix_suggestions: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects invalid verdict", () => {
    const parsed = GateResult.safeParse({
      result: "error",
      confidence: "high",
      reason_codes: ["PASS_ALL_CLEAR"],
      baseline_samples: 0,
      fix_suggestions: [],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("cross-gate: reason code consistency", () => {
  const codesUsedByGates = [
    "PASS_ALL_CLEAR",
    "PASS_NO_SCOPE_CHANGE",
    "SKIP_NO_BASELINE",
    "SKIP_NO_CACHE_DETECTED",
    "SKIP_PERMISSION_DENIED",
    "SKIP_RATE_LIMITED",
    "SKIP_API_BUDGET_EXHAUSTED",
    "SKIP_GITHUB_ABUSE_LIMIT",
    "SKIP_UNSUPPORTED_FORMAT",
    "WARN_NO_BASELINE",
    "WARN_LOW_CONFIDENCE",
    "WARN_HIT_RATE_DROP",
    "WARN_RESTORE_REGRESSION",
    "WARN_KEY_CHURN",
    "WARN_DUPLICATE_CACHE_STEP_GROUP",
    "WARN_DURATION_INCREASE",
    "WARN_BUDGET_EXCEEDED",
    "WARN_CAPABILITY_EXPANSION",
    "WARN_HEURISTIC_MAPPING",
    "FAIL_HIT_RATE_DROP",
    "FAIL_RESTORE_REGRESSION",
    "FAIL_DURATION_REGRESSION",
    "FAIL_CAPABILITY_ESCALATION",
  ];

  it.each(codesUsedByGates)("code %s is registered", (code) => {
    expect(isValidReasonCode(code)).toBe(true);
  });

  it.each(codesUsedByGates)("code %s has a message", (code) => {
    const msg = getReasonMessage(code);
    expect(msg).toBeTruthy();
    expect(msg.length).toBeGreaterThan(10);
  });

  it("all codes follow naming convention", () => {
    for (const code of codesUsedByGates) {
      expect(code).toMatch(/^(PASS|WARN|FAIL|SKIP)_[A-Z_]+$/);
    }
  });
});

describe("cross-gate: report renderer consistency", () => {
  const gateName = "test-gate";
  const opts = { gateName, title: "Test Gate" };

  it("renders valid markdown for all verdict types", () => {
    const verdicts = ["pass", "warn", "fail", "skipped"] as const;

    for (const verdict of verdicts) {
      const result =
        verdict === "skipped"
          ? createSkippedResult(["SKIP_NO_BASELINE"])
          : createPassResult({ result: verdict, reason_codes: ["PASS_ALL_CLEAR"] });

      const md = renderJobSummary(result, opts);
      expect(md).toBeTruthy();
      expect(md.length).toBeGreaterThan(50);
      expect(md).toContain(gateName);
    }
  });

  it("includes regressions table when present", () => {
    const result = createPassResult({
      result: "fail",
      reason_codes: ["FAIL_DURATION_REGRESSION"],
      top_regressions: [
        { scope: "job", name: "build", baseline_ms: 500, current_ms: 1200, delta_pct: 140 },
      ],
    });

    const md = renderJobSummary(result, opts);
    expect(md).toContain("build");
    expect(md).toContain("140");
  });

  it("includes findings when present", () => {
    const result = createPassResult({
      result: "warn",
      reason_codes: ["WARN_CAPABILITY_EXPANSION"],
      top_findings: [{ scope: "job", name: "tool/cap", risk_level: "high", detail: "expanded" }],
    });

    const md = renderJobSummary(result, opts);
    expect(md).toContain("tool/cap");
  });
});

describe("cross-gate: serialization roundtrip", () => {
  it("serializes and re-parses GateResult", () => {
    const original = createPassResult({
      top_regressions: [
        { scope: "workflow", name: "total", baseline_ms: 300, current_ms: 500, delta_pct: 66.7 },
      ],
      fix_suggestions: ["Optimize build step."],
    });

    const json = serializeResultJson(original);
    const roundtripped = GateResult.parse(JSON.parse(json));

    expect(roundtripped.result).toBe(original.result);
    expect(roundtripped.confidence).toBe(original.confidence);
    expect(roundtripped.reason_codes).toEqual(original.reason_codes);
    expect(roundtripped.top_regressions).toEqual(original.top_regressions);
    expect(roundtripped.fix_suggestions).toEqual(original.fix_suggestions);
  });
});
