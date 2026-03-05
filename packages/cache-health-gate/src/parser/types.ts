/**
 * Parsed cache token from a step named `[cache] group=... hit=... key_fp=...`.
 */
export interface CacheToken {
  group: string;
  hit: boolean;
  keyFp: string;
  keyHint?: string | undefined;
  raw: string;
}

/**
 * Parsed cache-step marker from a step named `[cache-step] group=...`.
 */
export interface CacheStepMarker {
  group: string;
  jobName: string;
  stepIndex: number;
  startedAt: string | null;
  completedAt: string | null;
  raw: string;
}

/**
 * A parsed token with its job context for association.
 */
export interface CacheTokenWithContext extends CacheToken {
  jobName: string;
  stepIndex: number;
}
