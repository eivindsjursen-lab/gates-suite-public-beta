import { z } from "zod";

export const GateVerdict = z.enum(["pass", "warn", "fail", "skipped"]);
export type GateVerdict = z.infer<typeof GateVerdict>;

export const ConfidenceLevel = z.enum(["low", "med", "high"]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevel>;

// V1 supports only API-based baseline. Artifact/repo modes planned for v2.
export const BaselineMode = z.enum(["api"]);
export type BaselineMode = z.infer<typeof BaselineMode>;

export const BaselineInfo = z.object({
  mode: BaselineMode,
  branch: z.string(),
  workflow_id: z.number().int(),
  runs: z.number().int().nonnegative(),
  samples_used: z.number().int().nonnegative(),
});
export type BaselineInfo = z.infer<typeof BaselineInfo>;

export const RegressionScope = z.enum(["workflow", "job", "step", "group"]);
export type RegressionScope = z.infer<typeof RegressionScope>;

export const Regression = z.object({
  scope: RegressionScope,
  name: z.string(),
  delta_pct: z.number(),
  baseline_ms: z.number().nonnegative(),
  current_ms: z.number().nonnegative(),
});
export type Regression = z.infer<typeof Regression>;

export const Finding = z.object({
  scope: z.string(),
  name: z.string(),
  risk_level: z.string(),
  detail: z.string(),
});
export type Finding = z.infer<typeof Finding>;

/**
 * Standard result JSON shape (Appendix B of the blueprint).
 * All gates produce this shape. Products may extend top_regressions
 * or top_findings but the envelope is fixed.
 */
export const GateResult = z.object({
  result: GateVerdict,
  confidence: ConfidenceLevel,
  reason_codes: z.array(z.string()).min(1),
  baseline: BaselineInfo.optional(),
  baseline_samples: z.number().int().nonnegative(),
  top_regressions: z.array(Regression).optional(),
  top_findings: z.array(Finding).optional(),
  fix_suggestions: z.array(z.string()),
});
export type GateResult = z.infer<typeof GateResult>;

export function createPassResult(overrides: Partial<GateResult> = {}): GateResult {
  return GateResult.parse({
    result: "pass",
    confidence: "high",
    reason_codes: ["PASS_ALL_CLEAR"],
    baseline_samples: 0,
    fix_suggestions: [],
    ...overrides,
  });
}

export function createSkippedResult(
  reasonCodes: string[],
  overrides: Partial<GateResult> = {},
): GateResult {
  return GateResult.parse({
    result: "skipped",
    confidence: "low",
    reason_codes: reasonCodes,
    baseline_samples: 0,
    fix_suggestions: [],
    ...overrides,
  });
}
