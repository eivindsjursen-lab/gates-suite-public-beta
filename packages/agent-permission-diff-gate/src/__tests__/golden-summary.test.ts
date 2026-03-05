import { describe, it, expect } from "vitest";
import { renderJobSummary, type GateResult } from "@gates-suite/core";

const OPTS = { gateName: "Agent Permission Diff Gate", title: "Agent Permission Diff Gate" };

describe("golden snapshot: Permission Diff Gate job summaries", () => {
  it("PASS — no scope change", () => {
    const result: GateResult = {
      result: "pass",
      confidence: "high",
      reason_codes: ["PASS_NO_SCOPE_CHANGE"],
      baseline_samples: 0,
      fix_suggestions: [],
    };

    expect(renderJobSummary(result, OPTS)).toMatchSnapshot();
  });

  it("FAIL — critical escalation", () => {
    const result: GateResult = {
      result: "fail",
      confidence: "high",
      reason_codes: ["FAIL_CAPABILITY_ESCALATION", "WARN_HEURISTIC_MAPPING"],
      baseline_samples: 0,
      top_findings: [
        {
          scope: "job",
          name: "terminal/exec.shell",
          risk_level: "critical",
          detail: "added: terminal gains exec.shell (critical risk, heuristic)",
        },
        {
          scope: "job",
          name: "terminal/egress.http",
          risk_level: "high",
          detail: "added: terminal gains egress.http (high risk, heuristic)",
        },
      ],
      fix_suggestions: [
        'High-risk capability change detected. Add the "agent-scope-approved" label to approve.',
        "Some permissions were inferred by heuristic. Add explicit capability declarations.",
        "Critical: terminal uses exec.shell. Ensure this is intentional and documented.",
      ],
    };

    expect(renderJobSummary(result, OPTS)).toMatchSnapshot();
  });

  it("WARN — medium-risk expansion", () => {
    const result: GateResult = {
      result: "warn",
      confidence: "med",
      reason_codes: ["WARN_CAPABILITY_EXPANSION"],
      baseline_samples: 0,
      top_findings: [
        {
          scope: "job",
          name: "comment-bot/write.issues",
          risk_level: "medium",
          detail: "added: comment-bot gains write.issues (medium risk, explicit)",
        },
      ],
      fix_suggestions: [],
    };

    expect(renderJobSummary(result, OPTS)).toMatchSnapshot();
  });

  it("WARN — heuristic-only detection", () => {
    const result: GateResult = {
      result: "warn",
      confidence: "low",
      reason_codes: ["WARN_CAPABILITY_EXPANSION", "WARN_HEURISTIC_MAPPING"],
      baseline_samples: 0,
      top_findings: [
        {
          scope: "job",
          name: "docker-build/exec.docker",
          risk_level: "critical",
          detail: "added: docker-build gains exec.docker (critical risk, heuristic)",
        },
      ],
      fix_suggestions: [
        "Some permissions were inferred by heuristic. Add explicit capability declarations to your config.",
      ],
    };

    expect(renderJobSummary(result, OPTS)).toMatchSnapshot();
  });

  it("PASS — approved via label", () => {
    const result: GateResult = {
      result: "pass",
      confidence: "high",
      reason_codes: ["PASS_NO_SCOPE_CHANGE"],
      baseline_samples: 0,
      top_findings: [
        {
          scope: "job",
          name: "terminal/exec.shell",
          risk_level: "critical",
          detail: "added: terminal gains exec.shell (approved via label)",
        },
      ],
      fix_suggestions: [],
    };

    expect(renderJobSummary(result, OPTS)).toMatchSnapshot();
  });
});
