/**
 * Reason-code registry for the gates suite.
 *
 * Every WARN/FAIL/SKIPPED path must emit at least one stable reason code.
 * Codes use UPPER_SNAKE_CASE with prefixes: PASS_, WARN_, FAIL_, SKIP_.
 * Human text can improve over time; reason codes are the long-term contract.
 */

export interface ReasonCodeEntry {
  code: string;
  severity: "pass" | "warn" | "fail" | "skip";
  message: string;
}

function defineCode(code: string, severity: ReasonCodeEntry["severity"], message: string) {
  return { code, severity, message } as const;
}

// ── Shared / Core codes ──────────────────────────────────────────────

export const PASS_ALL_CLEAR = defineCode(
  "PASS_ALL_CLEAR",
  "pass",
  "All checks passed. No regressions detected.",
);

export const SKIP_NO_BASELINE = defineCode(
  "SKIP_NO_BASELINE",
  "skip",
  "No baseline runs found. Ensure the workflow runs on the default branch with push events, or lower baseline.window_days.",
);

export const SKIP_PERMISSION_DENIED = defineCode(
  "SKIP_PERMISSION_DENIED",
  "skip",
  "Insufficient permissions to access required GitHub API endpoints. Check the token permissions in your workflow.",
);

export const SKIP_GITHUB_ABUSE_LIMIT = defineCode(
  "SKIP_GITHUB_ABUSE_LIMIT",
  "skip",
  "GitHub returned an abuse detection error. Reduce baseline_runs or baseline_window_days and retry later.",
);

export const SKIP_WORKFLOW_MISMATCH = defineCode(
  "SKIP_WORKFLOW_MISMATCH",
  "skip",
  "Current workflow_id does not match any baseline runs. Ensure the baseline and PR use the same workflow file.",
);

export const SKIP_UNSUPPORTED_FORMAT = defineCode(
  "SKIP_UNSUPPORTED_FORMAT",
  "skip",
  "The config file format is not supported in V1. See docs for supported formats.",
);

export const SKIP_API_BUDGET_EXHAUSTED = defineCode(
  "SKIP_API_BUDGET_EXHAUSTED",
  "skip",
  "API call budget exhausted before completing analysis. Increase api_budget_calls or reduce baseline_runs.",
);

export const SKIP_RATE_LIMITED = defineCode(
  "SKIP_RATE_LIMITED",
  "skip",
  "GitHub API rate limit hit. Reduce baseline_runs and api_budget_calls, or wait for the rate limit window to reset.",
);

export const WARN_LOW_CONFIDENCE = defineCode(
  "WARN_LOW_CONFIDENCE",
  "warn",
  "Analysis completed but confidence is low due to limited data or high variance. Results may not be representative.",
);

export const WARN_NO_BASELINE = defineCode(
  "WARN_NO_BASELINE",
  "warn",
  "No baseline found. This is expected for first runs. Future PRs will compare against this run.",
);

export const WARN_INSUFFICIENT_SAMPLES = defineCode(
  "WARN_INSUFFICIENT_SAMPLES",
  "warn",
  "Fewer baseline samples than min_samples threshold. Results may be noisy. Wait for more default-branch runs.",
);

export const WARN_RATE_LIMITED = defineCode(
  "WARN_RATE_LIMITED",
  "warn",
  "GitHub API rate limit approached. Analysis used reduced baseline data. Results may be less accurate.",
);

// ── Cache Health Gate codes ──────────────────────────────────────────

export const FAIL_HIT_RATE_DROP = defineCode(
  "FAIL_HIT_RATE_DROP",
  "fail",
  "Cache hit rate dropped significantly compared to baseline. Check cache key stability and restore-keys configuration.",
);

export const FAIL_RESTORE_REGRESSION = defineCode(
  "FAIL_RESTORE_REGRESSION",
  "fail",
  "Cache restore time regressed beyond threshold. Check for cache size growth, key entropy, or missing restore-keys.",
);

export const WARN_HIT_RATE_DROP = defineCode(
  "WARN_HIT_RATE_DROP",
  "warn",
  "Cache hit rate decreased compared to baseline. Monitor this trend across PRs.",
);

export const WARN_RESTORE_REGRESSION = defineCode(
  "WARN_RESTORE_REGRESSION",
  "warn",
  "Cache restore time increased compared to baseline. Monitor for sustained regression.",
);

export const WARN_KEY_CHURN = defineCode(
  "WARN_KEY_CHURN",
  "warn",
  "High cache key churn detected. Distinct key fingerprints per group are above normal. Check for dynamic key components like commit SHA or timestamps.",
);

export const WARN_DUPLICATE_CACHE_STEP_GROUP = defineCode(
  "WARN_DUPLICATE_CACHE_STEP_GROUP",
  "warn",
  "Multiple cache-step markers found for the same (job, group). Using nearest preceding step. Confidence downgraded.",
);

export const SKIP_NO_CACHE_DETECTED = defineCode(
  "SKIP_NO_CACHE_DETECTED",
  "skip",
  "No cache tokens or cache-step markers found in the workflow run. Add [cache] and [cache-step] markers to enable analysis.",
);

// ── CI Minutes Gate codes ────────────────────────────────────────────

export const FAIL_DURATION_REGRESSION = defineCode(
  "FAIL_DURATION_REGRESSION",
  "fail",
  "CI duration regressed beyond the hard threshold. Top contributing jobs are listed in the report.",
);

export const WARN_DURATION_INCREASE = defineCode(
  "WARN_DURATION_INCREASE",
  "warn",
  "CI duration increased compared to baseline. Review top regressed jobs and step-level timing.",
);

export const WARN_BUDGET_EXCEEDED = defineCode(
  "WARN_BUDGET_EXCEEDED",
  "warn",
  "Workflow duration exceeds the configured time budget. Consider optimizing the top regressed jobs.",
);

// ── Permission Diff Gate codes ───────────────────────────────────────

export const FAIL_CAPABILITY_ESCALATION = defineCode(
  "FAIL_CAPABILITY_ESCALATION",
  "fail",
  "High-risk capability escalation detected (egress, write, secrets, or repo.write). Requires explicit approval via label or CODEOWNERS.",
);

export const WARN_CAPABILITY_EXPANSION = defineCode(
  "WARN_CAPABILITY_EXPANSION",
  "warn",
  "Low/medium-risk capability expansion detected. Review the changes and consider adding explicit approval if appropriate.",
);

export const WARN_HEURISTIC_MAPPING = defineCode(
  "WARN_HEURISTIC_MAPPING",
  "warn",
  "Some permissions were detected by heuristic rather than explicit config declaration. Verify accuracy manually.",
);

export const PASS_NO_SCOPE_CHANGE = defineCode(
  "PASS_NO_SCOPE_CHANGE",
  "pass",
  "No capability scope changes detected between base and head.",
);

// ── Registry lookup ──────────────────────────────────────────────────

const ALL_CODES: ReadonlyMap<string, ReasonCodeEntry> = new Map(
  [
    PASS_ALL_CLEAR,
    PASS_NO_SCOPE_CHANGE,
    SKIP_NO_BASELINE,
    SKIP_PERMISSION_DENIED,
    SKIP_GITHUB_ABUSE_LIMIT,
    SKIP_WORKFLOW_MISMATCH,
    SKIP_UNSUPPORTED_FORMAT,
    SKIP_API_BUDGET_EXHAUSTED,
    SKIP_RATE_LIMITED,
    WARN_LOW_CONFIDENCE,
    WARN_NO_BASELINE,
    WARN_INSUFFICIENT_SAMPLES,
    WARN_RATE_LIMITED,
    WARN_HIT_RATE_DROP,
    WARN_RESTORE_REGRESSION,
    WARN_KEY_CHURN,
    WARN_DUPLICATE_CACHE_STEP_GROUP,
    WARN_BUDGET_EXCEEDED,
    WARN_CAPABILITY_EXPANSION,
    WARN_HEURISTIC_MAPPING,
    FAIL_HIT_RATE_DROP,
    FAIL_RESTORE_REGRESSION,
    FAIL_DURATION_REGRESSION,
    FAIL_CAPABILITY_ESCALATION,
    SKIP_NO_CACHE_DETECTED,
    WARN_DURATION_INCREASE,
  ].map((entry) => [entry.code, entry]),
);

export function lookupReasonCode(code: string): ReasonCodeEntry | undefined {
  return ALL_CODES.get(code);
}

export function getReasonMessage(code: string): string {
  const entry = ALL_CODES.get(code);
  return entry?.message ?? `Unknown reason code: ${code}`;
}

export function isValidReasonCode(code: string): boolean {
  return ALL_CODES.has(code);
}

export function allReasonCodes(): ReadonlyMap<string, ReasonCodeEntry> {
  return ALL_CODES;
}

export function validateReasonCodePrefix(code: string): boolean {
  return /^(PASS|WARN|FAIL|SKIP)_[A-Z0-9_]+$/.test(code);
}
