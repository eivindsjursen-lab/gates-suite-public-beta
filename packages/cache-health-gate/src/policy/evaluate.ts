import type { GateVerdict, ConfidenceLevel } from "@gates-suite/core";
import type { CacheGroupMetrics } from "../metrics/types.js";
import type {
  CachePolicyConfig,
  CacheBaselineMetrics,
  PolicyViolation,
  CachePolicyResult,
} from "./types.js";

// Percentage-only restore warnings are too sensitive for small/medium caches when
// absolute timing jitter is small. Require a minimum absolute delta as well.
const MIN_RESTORE_REGRESSION_DELTA_MS = 250;

/**
 * Evaluate cache metrics against policy thresholds and baseline.
 *
 * Degrade ladder (Section 6.6):
 * 1. If no cache tokens detected → SKIP (SKIP_NO_CACHE_DETECTED)
 * 2. If no baseline → noBaselineBehavior: warn → WARN, skip → SKIP
 * 3. Confidence-gated FAIL: only fail when confidence >= "med"
 * 4. When mode=warn, all FAILs degrade to WARN
 */
export function evaluatePolicy(
  metrics: CacheGroupMetrics[],
  baselineByGroup: Map<string, CacheBaselineMetrics>,
  confidence: ConfidenceLevel,
  config: CachePolicyConfig,
  timingWarnings: string[],
): CachePolicyResult {
  if (metrics.length === 0) {
    return {
      verdict: "skipped",
      confidence: "low",
      reasonCodes: ["SKIP_NO_CACHE_DETECTED"],
      violations: [],
      warnings: [],
      metrics: [],
    };
  }

  const hasBaseline = baselineByGroup.size > 0;
  if (!hasBaseline) {
    const verdict: GateVerdict = config.noBaselineBehavior === "skip" ? "skipped" : "warn";
    const code = config.noBaselineBehavior === "skip" ? "SKIP_NO_BASELINE" : "WARN_NO_BASELINE";
    return {
      verdict,
      confidence: "low",
      reasonCodes: [code],
      violations: [],
      warnings: [...timingWarnings],
      metrics,
    };
  }

  const violations: PolicyViolation[] = [];
  const warnings = [...timingWarnings];
  const reasonCodes = new Set<string>();

  for (const m of metrics) {
    const key = `${m.jobName}::${m.group}`;
    const baseline = baselineByGroup.get(key);
    if (!baseline) continue;

    checkHitRateDrop(m, baseline, config, violations, reasonCodes);
    checkRestoreRegression(m, baseline, config, violations, reasonCodes);
    checkRestoreHardLimit(m, config, violations, reasonCodes);
    checkKeyChurn(m, violations, reasonCodes, warnings);
  }

  for (const w of timingWarnings) {
    reasonCodes.add(w);
  }

  const verdict: GateVerdict = determineVerdict(violations, reasonCodes, confidence, config);

  if (verdict === "pass" && reasonCodes.size === 0) {
    reasonCodes.add("PASS_ALL_CLEAR");
  }

  return {
    verdict,
    confidence,
    reasonCodes: [...reasonCodes],
    violations,
    warnings,
    metrics,
  };
}

function checkHitRateDrop(
  m: CacheGroupMetrics,
  baseline: CacheBaselineMetrics,
  config: CachePolicyConfig,
  violations: PolicyViolation[],
  reasonCodes: Set<string>,
): void {
  const dropPct = (baseline.hitRate - m.hitRate) * 100;
  if (dropPct > config.thresholds.hitRateDropPct) {
    const code = "FAIL_HIT_RATE_DROP";
    reasonCodes.add(code);
    violations.push({
      group: m.group,
      jobName: m.jobName,
      reasonCode: code,
      message: `Hit rate dropped ${dropPct.toFixed(1)}pp (${(baseline.hitRate * 100).toFixed(0)}% → ${(m.hitRate * 100).toFixed(0)}%), threshold: ${config.thresholds.hitRateDropPct}pp`,
    });
  }
}

function checkRestoreRegression(
  m: CacheGroupMetrics,
  baseline: CacheBaselineMetrics,
  config: CachePolicyConfig,
  violations: PolicyViolation[],
  reasonCodes: Set<string>,
): void {
  if (m.restoreMs === undefined || baseline.restoreMs === undefined || baseline.restoreMs === 0) {
    return;
  }

  const deltaMs = m.restoreMs - baseline.restoreMs;
  if (deltaMs <= 0) return;
  if (deltaMs < MIN_RESTORE_REGRESSION_DELTA_MS) return;

  const regressionPct = ((m.restoreMs - baseline.restoreMs) / baseline.restoreMs) * 100;
  if (regressionPct > config.thresholds.restoreRegressionPct) {
    const code = "FAIL_RESTORE_REGRESSION";
    reasonCodes.add(code);
    violations.push({
      group: m.group,
      jobName: m.jobName,
      reasonCode: code,
      message: `Restore time regressed ${regressionPct.toFixed(0)}% (${baseline.restoreMs}ms → ${m.restoreMs}ms), threshold: ${config.thresholds.restoreRegressionPct}%`,
    });
  }
}

function checkRestoreHardLimit(
  m: CacheGroupMetrics,
  config: CachePolicyConfig,
  violations: PolicyViolation[],
  reasonCodes: Set<string>,
): void {
  if (m.restoreMs === undefined) return;

  if (m.restoreMs > config.thresholds.restoreHardMs) {
    const code = "FAIL_RESTORE_REGRESSION";
    reasonCodes.add(code);
    violations.push({
      group: m.group,
      jobName: m.jobName,
      reasonCode: code,
      message: `Restore time ${m.restoreMs}ms exceeds hard limit ${config.thresholds.restoreHardMs}ms`,
    });
  }
}

function checkKeyChurn(
  m: CacheGroupMetrics,
  violations: PolicyViolation[],
  reasonCodes: Set<string>,
  warnings: string[],
): void {
  if (m.keyChurn > 0.5 && m.restoreAttempts >= 3) {
    const code = "WARN_KEY_CHURN";
    reasonCodes.add(code);
    warnings.push(
      `High key churn in ${m.jobName}/${m.group}: ${(m.keyChurn * 100).toFixed(0)}% distinct keys`,
    );
    violations.push({
      group: m.group,
      jobName: m.jobName,
      reasonCode: code,
      message: `Key churn ${(m.keyChurn * 100).toFixed(0)}% (${m.distinctKeyFps} distinct keys / ${m.restoreAttempts} attempts)`,
    });
  }
}

/**
 * Apply degrade ladder to determine final verdict:
 * - FAIL violations + confidence >= med → "fail" (or "warn" if mode=warn)
 * - FAIL violations + confidence < med → degrade to "warn"
 * - Only warnings → "warn"
 * - Nothing → "pass"
 */
function determineVerdict(
  violations: PolicyViolation[],
  reasonCodes: Set<string>,
  confidence: ConfidenceLevel,
  config: CachePolicyConfig,
): GateVerdict {
  const hasFailCodes = [...reasonCodes].some((c) => c.startsWith("FAIL_"));
  const hasWarnCodes = [...reasonCodes].some(
    (c) => c.startsWith("WARN_") || c === "WARN_DUPLICATE_CACHE_STEP_GROUP",
  );

  if (!hasFailCodes && !hasWarnCodes) return "pass";

  if (hasFailCodes) {
    const confidenceAllowsFail = confidence === "med" || confidence === "high";

    if (!confidenceAllowsFail) {
      degradeFailsToWarns(violations, reasonCodes);
      return "warn";
    }

    if (config.mode === "warn") {
      degradeFailsToWarns(violations, reasonCodes);
      return "warn";
    }

    return "fail";
  }

  return "warn";
}

/**
 * Downgrade FAIL_ codes to their WARN_ equivalents.
 */
function degradeFailsToWarns(violations: PolicyViolation[], reasonCodes: Set<string>): void {
  const failCodes = [...reasonCodes].filter((c) => c.startsWith("FAIL_"));
  for (const fc of failCodes) {
    reasonCodes.delete(fc);
    reasonCodes.add(fc.replace("FAIL_", "WARN_"));
  }
  for (const v of violations) {
    if (v.reasonCode.startsWith("FAIL_")) {
      v.reasonCode = v.reasonCode.replace("FAIL_", "WARN_");
    }
  }
}
