import type { CacheStepMarker, CacheTokenWithContext } from "../parser/types.js";
import type { TimingAssociation, CacheGroupMetrics } from "./types.js";

/**
 * Associate each cache token with its nearest preceding cache-step marker
 * in the same job with the same group. Per blueprint Section 6.5.
 */
export function associateTimings(
  tokens: CacheTokenWithContext[],
  markers: CacheStepMarker[],
): { associations: TimingAssociation[]; warnings: string[] } {
  const warnings: string[] = [];
  const associations: TimingAssociation[] = [];

  for (const token of tokens) {
    const matchingMarkers = markers.filter(
      (m) =>
        m.jobName === token.jobName && m.group === token.group && m.stepIndex < token.stepIndex,
    );

    if (matchingMarkers.length > 1) {
      warnings.push(`WARN_DUPLICATE_CACHE_STEP_GROUP`);
    }

    const nearest = matchingMarkers.reduce<CacheStepMarker | undefined>(
      (best, m) => (!best || m.stepIndex > best.stepIndex ? m : best),
      undefined,
    );

    const restoreMs = computeStepDuration(nearest?.startedAt, nearest?.completedAt);

    associations.push({
      jobName: token.jobName,
      group: token.group,
      tokenStepIndex: token.stepIndex,
      markerStepIndex: nearest?.stepIndex,
      restoreMs,
      saveMs: undefined,
      duplicate: matchingMarkers.length > 1,
    });
  }

  return { associations, warnings };
}

/**
 * Compute per-(job, group) cache metrics from tokens and timing associations.
 */
export function computeGroupMetrics(
  tokens: CacheTokenWithContext[],
  associations: TimingAssociation[],
): CacheGroupMetrics[] {
  const groups = new Map<
    string,
    { tokens: CacheTokenWithContext[]; assocs: TimingAssociation[] }
  >();

  for (const token of tokens) {
    const key = `${token.jobName}::${token.group}`;
    const entry = groups.get(key) ?? { tokens: [], assocs: [] };
    entry.tokens.push(token);
    groups.set(key, entry);
  }

  for (const assoc of associations) {
    const key = `${assoc.jobName}::${assoc.group}`;
    const entry = groups.get(key);
    if (entry) {
      entry.assocs.push(assoc);
    }
  }

  const metrics: CacheGroupMetrics[] = [];

  for (const [, entry] of groups) {
    const { tokens: groupTokens, assocs } = entry;
    if (groupTokens.length === 0) continue;

    const firstToken = groupTokens[0];
    if (!firstToken) continue;

    const hits = groupTokens.filter((t) => t.hit).length;
    const restoreAttempts = groupTokens.length;
    const hitRate = restoreAttempts > 0 ? hits / restoreAttempts : 0;

    const distinctFps = new Set(groupTokens.map((t) => t.keyFp));
    const keyChurn = restoreAttempts > 0 ? distinctFps.size / restoreAttempts : 0;

    const restoreTimes = assocs
      .map((a) => a.restoreMs)
      .filter((ms): ms is number => ms !== undefined);
    const restoreMs = restoreTimes.length > 0 ? median(restoreTimes) : undefined;

    metrics.push({
      jobName: firstToken.jobName,
      group: firstToken.group,
      hitRate,
      hits,
      restoreAttempts,
      restoreMs,
      saveMs: undefined,
      keyChurn,
      distinctKeyFps: distinctFps.size,
      keyHint: firstToken.keyHint,
    });
  }

  return metrics;
}

function computeStepDuration(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
): number | undefined {
  if (!startedAt || !completedAt) return undefined;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  return ms >= 0 ? ms : undefined;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid];
}
