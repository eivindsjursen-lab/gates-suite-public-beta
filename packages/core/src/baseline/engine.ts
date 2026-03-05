import type { GatesApiClient } from "../github/client.js";
import type { WorkflowRun } from "../github/types.js";
import type { ConfidenceLevel } from "../schema/result.js";
import type {
  BaselineConfig,
  BaselineResult,
  BaselineRunData,
  WorkflowDurationBaseline,
  JobDurationBaseline,
} from "./types.js";
import { median, percentile, coefficientOfVariation } from "../stats/median.js";

export class BaselineEngine {
  private readonly client: GatesApiClient;

  constructor(client: GatesApiClient) {
    this.client = client;
  }

  async fetchBaseline(config: BaselineConfig): Promise<BaselineResult> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.windowDays);

    const allRuns = await this.client.listWorkflowRuns({
      workflowId: config.workflowId,
      branch: config.branch,
      event: config.eventFilter,
      status: "completed",
      perPage: Math.min(config.runs * 2, 100),
      maxPages: 3,
    });

    const filtered = allRuns
      .filter((run) => this.isEligible(run, config, cutoff))
      .slice(0, config.runs);

    const runData: BaselineRunData[] = [];
    for (const run of filtered) {
      const jobs = await this.client.listJobsForRun(run.id);
      const durationMs = this.computeRunDuration(run);
      runData.push({ run, jobs, durationMs });
    }

    const { confidence, reasons } = this.assessConfidence(runData, config);

    return {
      config,
      runs: runData,
      samplesUsed: runData.length,
      confidence,
      confidenceReasons: reasons,
    };
  }

  computeDurationBaseline(result: BaselineResult): WorkflowDurationBaseline | undefined {
    if (result.runs.length === 0) return undefined;

    const durations = result.runs.map((r) => r.durationMs);
    const medianMs = median(durations);
    if (medianMs === undefined) return undefined;

    const jobMap = new Map<string, number[]>();
    for (const runData of result.runs) {
      for (const job of runData.jobs) {
        if (job.started_at && job.completed_at) {
          const ms = new Date(job.completed_at).getTime() - new Date(job.started_at).getTime();
          const existing = jobMap.get(job.name);
          if (existing) {
            existing.push(ms);
          } else {
            jobMap.set(job.name, [ms]);
          }
        }
      }
    }

    const jobs: JobDurationBaseline[] = [];
    for (const [name, values] of jobMap) {
      const med = median(values);
      if (med !== undefined) {
        jobs.push({
          name,
          medianMs: med,
          p90Ms: percentile(values, 90),
          samples: values.length,
        });
      }
    }

    jobs.sort((a, b) => b.medianMs - a.medianMs);

    return {
      medianMs,
      p90Ms: percentile(durations, 90),
      samples: durations.length,
      jobs,
    };
  }

  private isEligible(run: WorkflowRun, config: BaselineConfig, cutoff: Date): boolean {
    if (config.requireSuccess && run.conclusion !== "success") return false;
    if (config.excludeRunIds?.includes(run.id)) return false;

    // When workflowId is numeric, verify the run matches (safety net).
    // When it's a string filename, the API already filtered by workflow.
    if (typeof config.workflowId === "number" && run.workflow_id !== config.workflowId) {
      return false;
    }

    const runDate = new Date(run.created_at);
    if (runDate < cutoff) return false;

    return true;
  }

  private computeRunDuration(run: WorkflowRun): number {
    const start = run.run_started_at ?? run.created_at;
    return new Date(run.updated_at).getTime() - new Date(start).getTime();
  }

  private assessConfidence(
    runs: BaselineRunData[],
    config: BaselineConfig,
  ): { confidence: ConfidenceLevel; reasons: string[] } {
    const reasons: string[] = [];

    if (runs.length === 0) {
      return { confidence: "low", reasons: ["No baseline samples available"] };
    }

    if (runs.length < config.minSamples) {
      reasons.push(`Only ${runs.length} samples (minimum ${config.minSamples} recommended)`);
    }

    const durations = runs.map((r) => r.durationMs);
    const cv = coefficientOfVariation(durations);
    if (cv !== undefined && cv > 0.5) {
      reasons.push(`High duration variance (CV=${cv.toFixed(2)})`);
    }

    const hasCompleteTiming = runs.every((r) => r.run.run_started_at !== undefined);
    if (!hasCompleteTiming) {
      reasons.push("Some runs lack precise start timestamps");
    }

    if (reasons.length === 0) {
      return { confidence: "high", reasons: ["Sufficient samples with stable variance"] };
    }

    const isMedium = runs.length >= config.minSamples && (cv === undefined || cv <= 0.5);

    return {
      confidence: isMedium ? "med" : "low",
      reasons,
    };
  }
}
