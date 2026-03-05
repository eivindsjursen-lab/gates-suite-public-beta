import type { GateVerdict } from "@gates-suite/core";
import type { DurationAnalysis } from "../analyzer/types.js";
import type { MinutesPolicyConfig, MinutesPolicyResult } from "./types.js";

/**
 * Evaluate duration analysis against policy.
 *
 * Degrade ladder:
 * 1. No baseline → noBaselineBehavior (warn/skip)
 * 2. Confidence < med → FAIL degrades to WARN
 * 3. mode=warn → FAIL degrades to WARN
 * 4. mode=fail + confidence >= med → FAIL allowed
 */
export function evaluateMinutesPolicy(
  analysis: DurationAnalysis,
  config: MinutesPolicyConfig,
): MinutesPolicyResult {
  const reasonCodes = new Set<string>();

  if (analysis.baselineSamples === 0) {
    const verdict: GateVerdict = config.noBaselineBehavior === "skip" ? "skipped" : "warn";
    const code = config.noBaselineBehavior === "skip" ? "SKIP_NO_BASELINE" : "WARN_NO_BASELINE";

    const topJobs = analysis.currentRun.jobs
      .slice(0, 5)
      .map((j) => ({ name: j.name, durationMs: j.durationMs, deltaPct: undefined }));

    return {
      verdict,
      confidence: "low",
      reasonCodes: [code],
      regressions: [],
      budgetViolations: analysis.budgetViolations,
      topJobs,
    };
  }

  const hasRegressions = analysis.regressions.length > 0;
  const hasBudgetViolations = analysis.budgetViolations.length > 0;

  if (hasRegressions) {
    reasonCodes.add("FAIL_DURATION_REGRESSION");
  }
  if (hasBudgetViolations) {
    reasonCodes.add("WARN_BUDGET_EXCEEDED");
  }

  const topJobs = buildTopJobs(analysis);

  if (!hasRegressions && !hasBudgetViolations) {
    return {
      verdict: "pass",
      confidence: analysis.confidence,
      reasonCodes: ["PASS_ALL_CLEAR"],
      regressions: [],
      budgetViolations: [],
      topJobs,
    };
  }

  let verdict: GateVerdict;

  if (hasRegressions) {
    const confidenceAllowsFail = analysis.confidence === "med" || analysis.confidence === "high";

    if (!confidenceAllowsFail || config.mode === "warn") {
      degradeReasonCodes(reasonCodes);
      verdict = "warn";
    } else {
      verdict = "fail";
    }
  } else {
    verdict = "warn";
  }

  return {
    verdict,
    confidence: analysis.confidence,
    reasonCodes: [...reasonCodes],
    regressions: analysis.regressions,
    budgetViolations: analysis.budgetViolations,
    topJobs,
  };
}

function buildTopJobs(
  analysis: DurationAnalysis,
): { name: string; durationMs: number; deltaPct: number | undefined }[] {
  return analysis.currentRun.jobs
    .map((j) => {
      const baselineMs = analysis.baselineJobMedians.get(j.name);
      const delta =
        baselineMs !== undefined && baselineMs > 0
          ? ((j.durationMs - baselineMs) / baselineMs) * 100
          : undefined;
      return { name: j.name, durationMs: j.durationMs, deltaPct: delta };
    })
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 5);
}

function degradeReasonCodes(codes: Set<string>): void {
  if (codes.has("FAIL_DURATION_REGRESSION")) {
    codes.delete("FAIL_DURATION_REGRESSION");
    codes.add("WARN_DURATION_INCREASE");
  }
}
