import type { GateVerdict, ConfidenceLevel } from "@gates-suite/core";
import type { DurationComparison, BudgetViolation } from "../analyzer/types.js";

export interface MinutesPolicyConfig {
  mode: "warn" | "fail";
  regressionThresholdPct: number;
  noBaselineBehavior: "warn" | "skip";
}

export interface MinutesPolicyResult {
  verdict: GateVerdict;
  confidence: ConfidenceLevel;
  reasonCodes: string[];
  regressions: DurationComparison[];
  budgetViolations: BudgetViolation[];
  topJobs: { name: string; durationMs: number; deltaPct: number | undefined }[];
}
