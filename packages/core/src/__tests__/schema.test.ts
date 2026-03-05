import { describe, it, expect } from "vitest";
import {
  GateResult,
  GateVerdict,
  ConfidenceLevel,
  BaselineMode,
  BaselineInfo,
  Regression,
  Finding,
  createPassResult,
  createSkippedResult,
} from "../index.js";

describe("GateVerdict", () => {
  it.each(["pass", "warn", "fail", "skipped"])("accepts '%s'", (v) => {
    expect(GateVerdict.parse(v)).toBe(v);
  });

  it("rejects invalid values", () => {
    expect(() => GateVerdict.parse("error")).toThrow();
    expect(() => GateVerdict.parse("")).toThrow();
    expect(() => GateVerdict.parse(42)).toThrow();
  });
});

describe("ConfidenceLevel", () => {
  it.each(["low", "med", "high"])("accepts '%s'", (v) => {
    expect(ConfidenceLevel.parse(v)).toBe(v);
  });

  it("rejects 'medium' (must be 'med')", () => {
    expect(() => ConfidenceLevel.parse("medium")).toThrow();
  });
});

describe("BaselineMode", () => {
  it("accepts 'api'", () => {
    expect(BaselineMode.parse("api")).toBe("api");
  });

  it("rejects unsupported modes", () => {
    expect(() => BaselineMode.parse("artifact")).toThrow();
    expect(() => BaselineMode.parse("repo")).toThrow();
  });
});

describe("BaselineInfo", () => {
  it("parses valid baseline", () => {
    const input = {
      mode: "api",
      branch: "main",
      workflow_id: 123456,
      runs: 10,
      samples_used: 8,
    };
    const result = BaselineInfo.parse(input);
    expect(result.mode).toBe("api");
    expect(result.samples_used).toBe(8);
  });

  it("rejects negative samples", () => {
    expect(() =>
      BaselineInfo.parse({
        mode: "api",
        branch: "main",
        workflow_id: 1,
        runs: -1,
        samples_used: 0,
      }),
    ).toThrow();
  });
});

describe("Regression", () => {
  it("parses valid regression", () => {
    const r = Regression.parse({
      scope: "job",
      name: "test",
      delta_pct: 35.2,
      baseline_ms: 120000,
      current_ms: 162000,
    });
    expect(r.delta_pct).toBe(35.2);
  });

  it("allows negative delta (improvement)", () => {
    const r = Regression.parse({
      scope: "step",
      name: "install",
      delta_pct: -10.5,
      baseline_ms: 50000,
      current_ms: 44750,
    });
    expect(r.delta_pct).toBe(-10.5);
  });
});

describe("Finding", () => {
  it("parses valid finding", () => {
    const f = Finding.parse({
      scope: "network.egress",
      name: "api.openai.com",
      risk_level: "high",
      detail: "New egress domain added",
    });
    expect(f.risk_level).toBe("high");
  });
});

describe("GateResult", () => {
  const validResult = {
    result: "warn",
    confidence: "med",
    reason_codes: ["WARN_LOW_CONFIDENCE"],
    baseline_samples: 8,
    baseline: {
      mode: "api",
      branch: "main",
      workflow_id: 123456,
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
    ],
    fix_suggestions: ["add restore-keys", "reduce artifact size"],
  };

  it("parses the Appendix B example", () => {
    const result = GateResult.parse(validResult);
    expect(result.result).toBe("warn");
    expect(result.reason_codes).toHaveLength(1);
    expect(result.top_regressions).toHaveLength(1);
    expect(result.fix_suggestions).toHaveLength(2);
  });

  it("requires at least one reason code", () => {
    expect(() =>
      GateResult.parse({
        ...validResult,
        reason_codes: [],
      }),
    ).toThrow();
  });

  it("allows omitting optional fields", () => {
    const minimal = GateResult.parse({
      result: "pass",
      confidence: "high",
      reason_codes: ["PASS_ALL_CLEAR"],
      baseline_samples: 0,
      fix_suggestions: [],
    });
    expect(minimal.baseline).toBeUndefined();
    expect(minimal.top_regressions).toBeUndefined();
    expect(minimal.top_findings).toBeUndefined();
  });

  it("supports top_findings for permission diff gate", () => {
    const result = GateResult.parse({
      result: "fail",
      confidence: "high",
      reason_codes: ["FAIL_CAPABILITY_ESCALATION"],
      baseline_samples: 0,
      fix_suggestions: ["Remove network.egress for api.openai.com"],
      top_findings: [
        {
          scope: "network.egress",
          name: "api.openai.com",
          risk_level: "high",
          detail: "New egress domain added",
        },
      ],
    });
    expect(result.top_findings).toHaveLength(1);
  });
});

describe("createPassResult", () => {
  it("creates a valid pass result with defaults", () => {
    const result = createPassResult();
    expect(result.result).toBe("pass");
    expect(result.confidence).toBe("high");
    expect(result.reason_codes).toEqual(["PASS_ALL_CLEAR"]);
    expect(result.fix_suggestions).toEqual([]);
  });

  it("accepts overrides", () => {
    const result = createPassResult({
      baseline_samples: 10,
      baseline: {
        mode: "api",
        branch: "main",
        workflow_id: 1,
        runs: 10,
        samples_used: 10,
      },
    });
    expect(result.baseline_samples).toBe(10);
    expect(result.baseline?.mode).toBe("api");
  });
});

describe("createSkippedResult", () => {
  it("creates a valid skipped result", () => {
    const result = createSkippedResult(["SKIP_NO_BASELINE"]);
    expect(result.result).toBe("skipped");
    expect(result.confidence).toBe("low");
    expect(result.reason_codes).toEqual(["SKIP_NO_BASELINE"]);
  });
});
