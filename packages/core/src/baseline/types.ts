import type { ConfidenceLevel, BaselineMode } from "../schema/result.js";
import type { WorkflowRun, WorkflowJob } from "../github/types.js";

export interface BaselineConfig {
  mode: BaselineMode;
  branch: string;
  workflowId: number | string;
  runs: number;
  windowDays: number;
  eventFilter: string;
  minSamples: number;
  requireSuccess: boolean;
  excludeRunIds?: number[];
}

export interface BaselineRunData {
  run: WorkflowRun;
  jobs: WorkflowJob[];
  durationMs: number;
}

export interface BaselineResult {
  config: BaselineConfig;
  runs: BaselineRunData[];
  samplesUsed: number;
  confidence: ConfidenceLevel;
  confidenceReasons: string[];
}

export interface JobDurationBaseline {
  name: string;
  medianMs: number;
  p90Ms: number | undefined;
  samples: number;
}

export interface WorkflowDurationBaseline {
  medianMs: number;
  p90Ms: number | undefined;
  samples: number;
  jobs: JobDurationBaseline[];
}
