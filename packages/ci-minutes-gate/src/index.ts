export { run } from "./main.js";

export { computeRunDuration, analyzeDuration } from "./analyzer/duration.js";

export type {
  RunDuration,
  JobDuration,
  StepDuration,
  DurationComparison,
  BudgetViolation,
  DurationAnalysis,
  DurationAnalyzerConfig,
} from "./analyzer/types.js";

export { evaluateMinutesPolicy } from "./policy/evaluate.js";

export type { MinutesPolicyConfig, MinutesPolicyResult } from "./policy/types.js";
