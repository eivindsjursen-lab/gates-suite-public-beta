import type { ConfidenceLevel } from "@gates-suite/core";

/**
 * Duration snapshot for a single workflow run.
 */
export interface RunDuration {
  runId: number;
  totalMs: number;
  jobs: JobDuration[];
}

/**
 * Duration snapshot for a single job within a run.
 */
export interface JobDuration {
  name: string;
  durationMs: number;
  steps: StepDuration[];
}

/**
 * Duration snapshot for a single step within a job.
 */
export interface StepDuration {
  name: string;
  number: number;
  durationMs: number;
}

/**
 * Comparison of current run against the baseline for a single scope (job/workflow).
 */
export interface DurationComparison {
  scope: "workflow" | "job";
  name: string;
  baselineMs: number;
  currentMs: number;
  deltaPct: number;
}

/**
 * Budget violation details.
 */
export interface BudgetViolation {
  scope: "workflow" | "job";
  name: string;
  budgetMs: number;
  actualMs: number;
  overageMs: number;
}

/**
 * Full analysis result from the duration analyzer.
 */
export interface DurationAnalysis {
  currentRun: RunDuration;
  baselineMedianMs: number | undefined;
  baselineJobMedians: Map<string, number>;
  regressions: DurationComparison[];
  budgetViolations: BudgetViolation[];
  confidence: ConfidenceLevel;
  baselineSamples: number;
}

/**
 * Configuration for the duration analyzer.
 */
export interface DurationAnalyzerConfig {
  regressionThresholdPct: number;
  budgetTotalMs: number | undefined;
  budgetPerJobMs: number | undefined;
}
