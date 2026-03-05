import type { CacheToken, CacheStepMarker, CacheTokenWithContext } from "./types.js";
import type { WorkflowJob } from "@gates-suite/core";

const CACHE_TOKEN_PREFIX = "[cache]";
const CACHE_STEP_PREFIX = "[cache-step]";

const KEY_PATTERN = /^[a-zA-Z0-9_]+$/;

/**
 * Parse URL-encoded key=value pairs from a step name suffix.
 * Tolerant of extra spaces. Keys must match [a-zA-Z0-9_]+.
 */
export function parseTokenFields(raw: string): Map<string, string> {
  const fields = new Map<string, string>();
  const parts = raw.trim().split(/\s+/);

  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx <= 0) continue;

    const key = part.slice(0, eqIdx);
    const value = part.slice(eqIdx + 1);

    if (!KEY_PATTERN.test(key)) continue;

    try {
      fields.set(key, decodeURIComponent(value));
    } catch {
      fields.set(key, value);
    }
  }

  return fields;
}

/**
 * Parse a `[cache]` token from a step name.
 * Returns undefined if the step name doesn't start with `[cache]`
 * or is missing required fields.
 */
export function parseCacheToken(stepName: string): CacheToken | undefined {
  const trimmed = stepName.trim();
  if (!trimmed.startsWith(CACHE_TOKEN_PREFIX)) return undefined;

  const suffix = trimmed.slice(CACHE_TOKEN_PREFIX.length);
  const fields = parseTokenFields(suffix);

  const group = fields.get("group");
  const hitStr = fields.get("hit");
  const keyFp = fields.get("key_fp");

  if (!group || !keyFp) return undefined;

  return {
    group,
    hit: hitStr === "true",
    keyFp,
    keyHint: fields.get("key_hint"),
    raw: trimmed,
  };
}

/**
 * Parse a `[cache-step]` marker from a step name.
 * Returns undefined if the step name doesn't start with `[cache-step]`
 * or is missing the group field.
 */
export function parseCacheStepMarker(
  stepName: string,
  jobName: string,
  stepIndex: number,
  startedAt: string | null,
  completedAt: string | null,
): CacheStepMarker | undefined {
  const trimmed = stepName.trim();
  if (!trimmed.startsWith(CACHE_STEP_PREFIX)) return undefined;

  const suffix = trimmed.slice(CACHE_STEP_PREFIX.length);
  const fields = parseTokenFields(suffix);

  const group = fields.get("group");
  if (!group) return undefined;

  return {
    group,
    jobName,
    stepIndex,
    startedAt,
    completedAt,
    raw: trimmed,
  };
}

/**
 * Extract all cache tokens and cache-step markers from workflow jobs.
 */
export function extractCacheData(jobs: WorkflowJob[]): {
  tokens: CacheTokenWithContext[];
  markers: CacheStepMarker[];
} {
  const tokens: CacheTokenWithContext[] = [];
  const markers: CacheStepMarker[] = [];

  for (const job of jobs) {
    if (!job.steps) continue;

    for (const step of job.steps) {
      const marker = parseCacheStepMarker(
        step.name,
        job.name,
        step.number,
        step.started_at,
        step.completed_at,
      );
      if (marker) {
        markers.push(marker);
        continue;
      }

      const token = parseCacheToken(step.name);
      if (token) {
        tokens.push({
          ...token,
          jobName: job.name,
          stepIndex: step.number,
        });
      }
    }
  }

  return { tokens, markers };
}
