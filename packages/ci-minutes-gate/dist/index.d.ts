import { ConfidenceLevel, BaselineRunData, WorkflowRun, WorkflowJob, GateVerdict } from '@gates-suite/core';

declare function run(): Promise<void>;

/**
 * Duration snapshot for a single workflow run.
 */
interface RunDuration {
    runId: number;
    totalMs: number;
    jobs: JobDuration[];
}
/**
 * Duration snapshot for a single job within a run.
 */
interface JobDuration {
    name: string;
    durationMs: number;
    steps: StepDuration[];
}
/**
 * Duration snapshot for a single step within a job.
 */
interface StepDuration {
    name: string;
    number: number;
    durationMs: number;
}
/**
 * Comparison of current run against the baseline for a single scope (job/workflow).
 */
interface DurationComparison {
    scope: "workflow" | "job";
    name: string;
    baselineMs: number;
    currentMs: number;
    deltaPct: number;
}
/**
 * Budget violation details.
 */
interface BudgetViolation {
    scope: "workflow" | "job";
    name: string;
    budgetMs: number;
    actualMs: number;
    overageMs: number;
}
/**
 * Full analysis result from the duration analyzer.
 */
interface DurationAnalysis {
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
interface DurationAnalyzerConfig {
    regressionThresholdPct: number;
    budgetTotalMs: number | undefined;
    budgetPerJobMs: number | undefined;
}

/**
 * Compute a RunDuration from a workflow run and its jobs.
 */
declare function computeRunDuration(run: WorkflowRun, jobs: WorkflowJob[]): RunDuration;
/**
 * Analyze the current run against baseline data.
 */
declare function analyzeDuration(currentRun: RunDuration, baselineRuns: BaselineRunData[], confidence: ConfidenceLevel, config: DurationAnalyzerConfig): DurationAnalysis;

interface MinutesPolicyConfig {
    mode: "warn" | "fail";
    regressionThresholdPct: number;
    noBaselineBehavior: "warn" | "skip";
}
interface MinutesPolicyResult {
    verdict: GateVerdict;
    confidence: ConfidenceLevel;
    reasonCodes: string[];
    regressions: DurationComparison[];
    budgetViolations: BudgetViolation[];
    topJobs: {
        name: string;
        durationMs: number;
        deltaPct: number | undefined;
    }[];
}

/**
 * Evaluate duration analysis against policy.
 *
 * Degrade ladder:
 * 1. No baseline → noBaselineBehavior (warn/skip)
 * 2. Confidence < med → FAIL degrades to WARN
 * 3. mode=warn → FAIL degrades to WARN
 * 4. mode=fail + confidence >= med → FAIL allowed
 */
declare function evaluateMinutesPolicy(analysis: DurationAnalysis, config: MinutesPolicyConfig): MinutesPolicyResult;

export { type BudgetViolation, type DurationAnalysis, type DurationAnalyzerConfig, type DurationComparison, type JobDuration, type MinutesPolicyConfig, type MinutesPolicyResult, type RunDuration, type StepDuration, analyzeDuration, computeRunDuration, evaluateMinutesPolicy, run };
