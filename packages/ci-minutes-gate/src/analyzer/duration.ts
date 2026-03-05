import type { WorkflowJob, WorkflowRun } from "@gates-suite/core";
import { median, deltaPct } from "@gates-suite/core";
import type {
  RunDuration,
  JobDuration,
  StepDuration,
  DurationComparison,
  BudgetViolation,
  DurationAnalysis,
  DurationAnalyzerConfig,
} from "./types.js";
import type { BaselineRunData, ConfidenceLevel } from "@gates-suite/core";

/**
 * Compute a RunDuration from a workflow run and its jobs.
 */
export function computeRunDuration(run: WorkflowRun, jobs: WorkflowJob[]): RunDuration {
  const jobDurations: JobDuration[] = [];

  for (const job of jobs) {
    const jobMs = computeJobDurationMs(job);
    const steps: StepDuration[] = [];

    if (job.steps) {
      for (const step of job.steps) {
        const stepMs = computeStepDurationMs(step.started_at, step.completed_at);
        if (stepMs !== undefined) {
          steps.push({ name: step.name, number: step.number, durationMs: stepMs });
        }
      }
    }

    steps.sort((a, b) => b.durationMs - a.durationMs);

    if (jobMs !== undefined) {
      jobDurations.push({ name: job.name, durationMs: jobMs, steps });
    }
  }

  const totalMs = computeWorkflowDurationMs(run);

  return { runId: run.id, totalMs, jobs: jobDurations };
}

/**
 * Analyze the current run against baseline data.
 */
export function analyzeDuration(
  currentRun: RunDuration,
  baselineRuns: BaselineRunData[],
  confidence: ConfidenceLevel,
  config: DurationAnalyzerConfig,
): DurationAnalysis {
  const baselineTotals = baselineRuns.map((r) => r.durationMs);
  const baselineMedianMs = median(baselineTotals);

  const baselineJobMedians = computeBaselineJobMedians(baselineRuns);

  const regressions = detectRegressions(
    currentRun,
    baselineMedianMs,
    baselineJobMedians,
    config.regressionThresholdPct,
  );

  const budgetViolations = checkBudgets(currentRun, config);

  return {
    currentRun,
    baselineMedianMs,
    baselineJobMedians,
    regressions,
    budgetViolations,
    confidence,
    baselineSamples: baselineRuns.length,
  };
}

function computeBaselineJobMedians(baselineRuns: BaselineRunData[]): Map<string, number> {
  const jobDurations = new Map<string, number[]>();

  for (const runData of baselineRuns) {
    for (const job of runData.jobs) {
      const ms = computeJobDurationMs(job);
      if (ms === undefined) continue;

      const existing = jobDurations.get(job.name);
      if (existing) {
        existing.push(ms);
      } else {
        jobDurations.set(job.name, [ms]);
      }
    }
  }

  const medians = new Map<string, number>();
  for (const [name, durations] of jobDurations) {
    const med = median(durations);
    if (med !== undefined) {
      medians.set(name, med);
    }
  }

  return medians;
}

function detectRegressions(
  currentRun: RunDuration,
  baselineMedianMs: number | undefined,
  baselineJobMedians: Map<string, number>,
  thresholdPct: number,
): DurationComparison[] {
  const regressions: DurationComparison[] = [];

  if (baselineMedianMs !== undefined && baselineMedianMs > 0) {
    const delta = deltaPct(baselineMedianMs, currentRun.totalMs);
    if (delta !== undefined && delta > thresholdPct) {
      regressions.push({
        scope: "workflow",
        name: "total",
        baselineMs: baselineMedianMs,
        currentMs: currentRun.totalMs,
        deltaPct: delta,
      });
    }
  }

  for (const job of currentRun.jobs) {
    const baselineMs = baselineJobMedians.get(job.name);
    if (baselineMs === undefined || baselineMs === 0) continue;

    const delta = deltaPct(baselineMs, job.durationMs);
    if (delta !== undefined && delta > thresholdPct) {
      regressions.push({
        scope: "job",
        name: job.name,
        baselineMs,
        currentMs: job.durationMs,
        deltaPct: delta,
      });
    }
  }

  regressions.sort((a, b) => b.deltaPct - a.deltaPct);

  return regressions;
}

function checkBudgets(currentRun: RunDuration, config: DurationAnalyzerConfig): BudgetViolation[] {
  const violations: BudgetViolation[] = [];

  if (config.budgetTotalMs !== undefined && currentRun.totalMs > config.budgetTotalMs) {
    violations.push({
      scope: "workflow",
      name: "total",
      budgetMs: config.budgetTotalMs,
      actualMs: currentRun.totalMs,
      overageMs: currentRun.totalMs - config.budgetTotalMs,
    });
  }

  if (config.budgetPerJobMs !== undefined) {
    for (const job of currentRun.jobs) {
      if (job.durationMs > config.budgetPerJobMs) {
        violations.push({
          scope: "job",
          name: job.name,
          budgetMs: config.budgetPerJobMs,
          actualMs: job.durationMs,
          overageMs: job.durationMs - config.budgetPerJobMs,
        });
      }
    }
  }

  return violations;
}

function computeJobDurationMs(job: WorkflowJob): number | undefined {
  return computeStepDurationMs(job.started_at, job.completed_at);
}

function computeStepDurationMs(
  startedAt: string | null,
  completedAt: string | null,
): number | undefined {
  if (!startedAt || !completedAt) return undefined;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  return ms >= 0 ? ms : undefined;
}

function computeWorkflowDurationMs(run: WorkflowRun): number {
  const start = run.run_started_at ?? run.created_at;
  return new Date(run.updated_at).getTime() - new Date(start).getTime();
}
