import { WorkflowJob, GateVerdict, ConfidenceLevel } from '@gates-suite/core';

declare function run(): Promise<void>;

/**
 * Parsed cache token from a step named `[cache] group=... hit=... key_fp=...`.
 */
interface CacheToken {
    group: string;
    hit: boolean;
    keyFp: string;
    keyHint?: string | undefined;
    raw: string;
}
/**
 * Parsed cache-step marker from a step named `[cache-step] group=...`.
 */
interface CacheStepMarker {
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
interface CacheTokenWithContext extends CacheToken {
    jobName: string;
    stepIndex: number;
}

/**
 * Parse URL-encoded key=value pairs from a step name suffix.
 * Tolerant of extra spaces. Keys must match [a-zA-Z0-9_]+.
 */
declare function parseTokenFields(raw: string): Map<string, string>;
/**
 * Parse a `[cache]` token from a step name.
 * Returns undefined if the step name doesn't start with `[cache]`
 * or is missing required fields.
 */
declare function parseCacheToken(stepName: string): CacheToken | undefined;
/**
 * Parse a `[cache-step]` marker from a step name.
 * Returns undefined if the step name doesn't start with `[cache-step]`
 * or is missing the group field.
 */
declare function parseCacheStepMarker(stepName: string, jobName: string, stepIndex: number, startedAt: string | null, completedAt: string | null): CacheStepMarker | undefined;
/**
 * Extract all cache tokens and cache-step markers from workflow jobs.
 */
declare function extractCacheData(jobs: WorkflowJob[]): {
    tokens: CacheTokenWithContext[];
    markers: CacheStepMarker[];
};

/**
 * Cache metrics for a single (job, group) key.
 */
interface CacheGroupMetrics {
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
interface TimingAssociation {
    jobName: string;
    group: string;
    tokenStepIndex: number;
    markerStepIndex: number | undefined;
    restoreMs: number | undefined;
    saveMs: number | undefined;
    duplicate: boolean;
}

/**
 * Associate each cache token with its nearest preceding cache-step marker
 * in the same job with the same group. Per blueprint Section 6.5.
 */
declare function associateTimings(tokens: CacheTokenWithContext[], markers: CacheStepMarker[]): {
    associations: TimingAssociation[];
    warnings: string[];
};
/**
 * Compute per-(job, group) cache metrics from tokens and timing associations.
 */
declare function computeGroupMetrics(tokens: CacheTokenWithContext[], associations: TimingAssociation[]): CacheGroupMetrics[];

interface CacheThresholds {
    hitRateDropPct: number;
    restoreRegressionPct: number;
    restoreHardMs: number;
}
interface CachePolicyConfig {
    mode: "warn" | "fail";
    thresholds: CacheThresholds;
    noBaselineBehavior: "warn" | "skip";
}
interface CacheBaselineMetrics {
    hitRate: number;
    restoreMs: number | undefined;
}
interface PolicyViolation {
    group: string;
    jobName: string;
    reasonCode: string;
    message: string;
}
interface CachePolicyResult {
    verdict: GateVerdict;
    confidence: ConfidenceLevel;
    reasonCodes: string[];
    violations: PolicyViolation[];
    warnings: string[];
    metrics: CacheGroupMetrics[];
}

/**
 * Evaluate cache metrics against policy thresholds and baseline.
 *
 * Degrade ladder (Section 6.6):
 * 1. If no cache tokens detected → SKIP (SKIP_NO_CACHE_DETECTED)
 * 2. If no baseline → noBaselineBehavior: warn → WARN, skip → SKIP
 * 3. Confidence-gated FAIL: only fail when confidence >= "med"
 * 4. When mode=warn, all FAILs degrade to WARN
 */
declare function evaluatePolicy(metrics: CacheGroupMetrics[], baselineByGroup: Map<string, CacheBaselineMetrics>, confidence: ConfidenceLevel, config: CachePolicyConfig, timingWarnings: string[]): CachePolicyResult;

export { type CacheBaselineMetrics, type CacheGroupMetrics, type CachePolicyConfig, type CachePolicyResult, type CacheStepMarker, type CacheThresholds, type CacheToken, type CacheTokenWithContext, type PolicyViolation, type TimingAssociation, associateTimings, computeGroupMetrics, evaluatePolicy, extractCacheData, parseCacheStepMarker, parseCacheToken, parseTokenFields, run };
