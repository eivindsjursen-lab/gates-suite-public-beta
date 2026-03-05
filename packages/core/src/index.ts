// Schema and types
export {
  GateVerdict,
  ConfidenceLevel,
  BaselineMode,
  BaselineInfo,
  RegressionScope,
  Regression,
  Finding,
  GateResult,
  createPassResult,
  createSkippedResult,
} from "./schema/result.js";

// GitHub API client
export { GatesApiClient, GatesApiError } from "./github/client.js";
export type {
  GatesApiClientOptions,
  ApiBudgetState,
  WorkflowRun,
  WorkflowJob,
  WorkflowStep,
} from "./github/types.js";

// Baseline engine
export { BaselineEngine } from "./baseline/engine.js";
export type {
  BaselineConfig,
  BaselineRunData,
  BaselineResult,
  JobDurationBaseline,
  WorkflowDurationBaseline,
} from "./baseline/types.js";

// Statistics
export { median, percentile, coefficientOfVariation, deltaPct } from "./stats/median.js";

// Report rendering and output
export { renderJobSummary, type MarkdownReportOptions } from "./report/markdown.js";
export {
  dispatchOutput,
  serializeResultJson,
  type OutputDispatcherOptions,
} from "./report/output.js";

// Reason codes
export {
  type ReasonCodeEntry,
  PASS_ALL_CLEAR,
  PASS_NO_SCOPE_CHANGE,
  SKIP_NO_BASELINE,
  SKIP_PERMISSION_DENIED,
  SKIP_GITHUB_ABUSE_LIMIT,
  SKIP_WORKFLOW_MISMATCH,
  SKIP_UNSUPPORTED_FORMAT,
  SKIP_API_BUDGET_EXHAUSTED,
  SKIP_RATE_LIMITED,
  SKIP_NO_CACHE_DETECTED,
  WARN_LOW_CONFIDENCE,
  WARN_NO_BASELINE,
  WARN_INSUFFICIENT_SAMPLES,
  WARN_RATE_LIMITED,
  WARN_HIT_RATE_DROP,
  WARN_RESTORE_REGRESSION,
  WARN_KEY_CHURN,
  WARN_DUPLICATE_CACHE_STEP_GROUP,
  WARN_BUDGET_EXCEEDED,
  WARN_DURATION_INCREASE,
  WARN_CAPABILITY_EXPANSION,
  WARN_HEURISTIC_MAPPING,
  FAIL_HIT_RATE_DROP,
  FAIL_RESTORE_REGRESSION,
  FAIL_DURATION_REGRESSION,
  FAIL_CAPABILITY_ESCALATION,
  lookupReasonCode,
  getReasonMessage,
  isValidReasonCode,
  allReasonCodes,
  validateReasonCodePrefix,
} from "./reason-codes/registry.js";
