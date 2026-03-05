/**
 * Cache metrics for a single (job, group) key.
 */
export interface CacheGroupMetrics {
  jobName: string;
  group: string;
  hitRate: number;
  hits: number;
  restoreAttempts: number;
  restoreMs: number | undefined;
  saveMs: number | undefined;
  keyChurn: number;
  distinctKeyFps: number;
  keyHint: string | undefined;
}

/**
 * Association result linking a token to its timing source.
 */
export interface TimingAssociation {
  jobName: string;
  group: string;
  tokenStepIndex: number;
  markerStepIndex: number | undefined;
  restoreMs: number | undefined;
  saveMs: number | undefined;
  duplicate: boolean;
}
