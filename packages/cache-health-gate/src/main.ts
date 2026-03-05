import * as actionsCore from "@actions/core";
import {
  GatesApiClient,
  GatesApiError,
  BaselineEngine,
  dispatchOutput,
  createSkippedResult,
  type GateResult,
  type BaselineConfig,
  type ConfidenceLevel,
} from "@gates-suite/core";
import { extractCacheData } from "./parser/token-parser.js";
import { associateTimings, computeGroupMetrics } from "./metrics/timing.js";
import { evaluatePolicy } from "./policy/evaluate.js";
import type { CachePolicyConfig, CacheBaselineMetrics } from "./policy/types.js";

export async function run(): Promise<void> {
  try {
    const config = readInputs();
    const client = createClient(config);
    const result = await execute(client, config);
    logVerdictToStdout(result);
    await dispatchOutput(result, {
      title: "Cache Health Gate",
      gateName: "cache-health-gate",
      writeComment: config.prNumber !== undefined,
      commentToken: config.token,
      owner: config.owner,
      repo: config.repo,
      prNumber: config.prNumber,
    });
  } catch (error) {
    const result = handleGracefulDegrade(error);
    if (result) {
      logVerdictToStdout(result);
      await dispatchOutput(result, {
        title: "Cache Health Gate",
        gateName: "cache-health-gate",
        writeComment: false,
      });
    } else {
      actionsCore.setFailed(error instanceof Error ? error.message : String(error));
    }
  }
}

function logVerdictToStdout(result: GateResult): void {
  actionsCore.info(
    `[cache-health-gate] RESULT=${result.result} CONFIDENCE=${result.confidence} BASELINE_SAMPLES=${result.baseline_samples ?? "n/a"} REASON_CODES=${JSON.stringify(result.reason_codes)}`,
  );
}

interface ActionConfig {
  token: string;
  mode: "warn" | "fail";
  baselineRuns: number;
  baselineWindowDays: number;
  baselineEventFilter: string;
  noBaselineBehavior: "warn" | "skip";
  thresholds: {
    hitRateDropPct: number;
    restoreRegressionPct: number;
    restoreHardMs: number;
  };
  apiBudgetCalls: number;
  debug: boolean;
  owner: string;
  repo: string;
  prNumber: number | undefined;
}

interface BaselineAggregate {
  hitRateSum: number;
  restoreMsSum: number;
  restoreMsCount: number;
  samples: number;
}

interface CacheBaselineAnalysis {
  byGroup: Map<string, CacheBaselineMetrics>;
  workflowBaselineRunsFetched: number;
  cacheRunsInspected: number;
  cacheRunsWithAnyMetrics: number;
  cacheRunsMatchingCurrentGroups: number;
  currentGroupCount: number;
  matchedCurrentGroupCount: number;
  missingCurrentGroups: string[];
  minMatchedGroupSamples: number;
}

function readInputs(): ActionConfig {
  const [owner = "", repo = ""] = (process.env["GITHUB_REPOSITORY"] ?? "").split("/");

  const prNumberStr =
    process.env["GITHUB_EVENT_NAME"] === "pull_request"
      ? (process.env["PR_NUMBER"] ?? actionsCore.getInput("pr_number"))
      : undefined;
  const prNumber = prNumberStr ? parseInt(prNumberStr, 10) || undefined : undefined;

  return {
    token: actionsCore.getInput("token") || (process.env["GITHUB_TOKEN"] ?? ""),
    mode: actionsCore.getInput("mode") === "fail" ? "fail" : "warn",
    baselineRuns: parseInt(actionsCore.getInput("baseline_runs") || "10", 10),
    baselineWindowDays: parseInt(actionsCore.getInput("baseline_window_days") || "14", 10),
    baselineEventFilter: actionsCore.getInput("baseline_event_filter") || "push",
    noBaselineBehavior: actionsCore.getInput("no_baseline_behavior") === "skip" ? "skip" : "warn",
    thresholds: {
      hitRateDropPct: parseFloat(actionsCore.getInput("thresholds_hit_rate_drop_pct") || "5"),
      restoreRegressionPct: parseFloat(
        actionsCore.getInput("thresholds_restore_regression_pct") || "20",
      ),
      restoreHardMs: parseFloat(actionsCore.getInput("thresholds_restore_hard_ms") || "30000"),
    },
    apiBudgetCalls: parseInt(actionsCore.getInput("api_budget_calls") || "30", 10),
    debug: parseBooleanInput(actionsCore.getInput("debug"), false),
    owner,
    repo,
    prNumber,
  };
}

function parseBooleanInput(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return defaultValue;
}

function createClient(config: ActionConfig): GatesApiClient {
  return new GatesApiClient({
    token: config.token,
    owner: config.owner,
    repo: config.repo,
    apibudgetCalls: config.apiBudgetCalls,
  });
}

async function execute(client: GatesApiClient, config: ActionConfig): Promise<GateResult> {
  const workflowId = resolveWorkflowId();
  const eventName = process.env["GITHUB_EVENT_NAME"] ?? "";
  const currentRunId = parseInt(process.env["GITHUB_RUN_ID"] ?? "0", 10);
  const defaultBranch =
    (eventName === "pull_request" ? process.env["GITHUB_BASE_REF"] : undefined) ||
    process.env["GITHUB_REF_NAME"] ||
    "main";

  const baselineEngine = new BaselineEngine(client);

  const baselineConfig: BaselineConfig = {
    mode: "api",
    branch: defaultBranch,
    workflowId,
    runs: config.baselineRuns,
    windowDays: config.baselineWindowDays,
    eventFilter: config.baselineEventFilter,
    minSamples: 5,
    requireSuccess: true,
    ...(currentRunId ? { excludeRunIds: [currentRunId] } : {}),
  };

  const baselineResult = await baselineEngine.fetchBaseline(baselineConfig);

  if (config.debug) {
    actionsCore.info(
      `[cache-health-gate][debug] workflow=${workflowId} event=${eventName || "unknown"} branch=${defaultBranch} current_run_id=${currentRunId || "n/a"} baseline_runs_fetched=${baselineResult.runs.length} baseline_confidence=${baselineResult.confidence}`,
    );
    actionsCore.info(
      `[cache-health-gate][debug] baseline_run_ids=${baselineResult.runs.map((r) => r.run.id).join(",") || "none"}`,
    );
  }

  if (baselineResult.runs.length === 0) {
    if (config.noBaselineBehavior === "skip") {
      return createSkippedResult(["SKIP_NO_BASELINE"]);
    }
  }

  if (!currentRunId) {
    return createSkippedResult(["SKIP_NO_CACHE_DETECTED"]);
  }

  const currentJobs = await client.listJobsForRun(currentRunId);
  const { tokens, markers } = extractCacheData(currentJobs);

  if (config.debug) {
    actionsCore.info(
      `[cache-health-gate][debug] current_jobs=${currentJobs.length} cache_tokens=${tokens.length} cache_step_markers=${markers.length}`,
    );
  }

  if (tokens.length === 0) {
    return createSkippedResult(["SKIP_NO_CACHE_DETECTED"]);
  }

  const { associations, warnings: timingWarnings } = associateTimings(tokens, markers);
  const currentMetrics = computeGroupMetrics(tokens, associations);

  const baselineAnalysis = await computeCacheBaselineAnalysis(
    baselineResult.runs,
    client,
    currentMetrics,
  );
  const scopedBaselineByGroup = filterBaselineToCurrentGroups(
    baselineAnalysis.byGroup,
    currentMetrics,
  );
  const effectiveConfidence = deriveCacheBaselineConfidence(
    baselineResult.confidence,
    baselineAnalysis,
  );

  if (config.debug) {
    actionsCore.info(
      `[cache-health-gate][debug] current_groups=${baselineAnalysis.currentGroupCount} matched_groups=${baselineAnalysis.matchedCurrentGroupCount} missing_groups=${baselineAnalysis.missingCurrentGroups.length} cache_runs_inspected=${baselineAnalysis.cacheRunsInspected} cache_runs_with_metrics=${baselineAnalysis.cacheRunsWithAnyMetrics} cache_runs_matching_current=${baselineAnalysis.cacheRunsMatchingCurrentGroups} min_group_samples=${baselineAnalysis.minMatchedGroupSamples} confidence=${baselineResult.confidence}->${effectiveConfidence}`,
    );
    if (baselineAnalysis.missingCurrentGroups.length > 0) {
      actionsCore.info(
        `[cache-health-gate][debug] missing_current_groups=${baselineAnalysis.missingCurrentGroups.join(",")}`,
      );
    }
  }

  const policyConfig: CachePolicyConfig = {
    mode: config.mode,
    thresholds: config.thresholds,
    noBaselineBehavior: config.noBaselineBehavior,
  };

  const policyResult = evaluatePolicy(
    currentMetrics,
    scopedBaselineByGroup,
    effectiveConfidence,
    policyConfig,
    timingWarnings,
  );

  const finalReasonCodes = [...policyResult.reasonCodes];
  let finalVerdict = policyResult.verdict;
  if (
    effectiveConfidence !== baselineResult.confidence &&
    !finalReasonCodes.includes("WARN_LOW_CONFIDENCE") &&
    !finalReasonCodes.includes("WARN_NO_BASELINE") &&
    !finalReasonCodes.includes("SKIP_NO_BASELINE")
  ) {
    finalReasonCodes.push("WARN_LOW_CONFIDENCE");
    if (finalVerdict === "pass") finalVerdict = "warn";
  }
  if (finalVerdict !== "pass") {
    const passIdx = finalReasonCodes.indexOf("PASS_ALL_CLEAR");
    if (passIdx >= 0) finalReasonCodes.splice(passIdx, 1);
  }

  const regressions = policyResult.violations.map((v) => {
    const key = `${v.jobName}::${v.group}`;
    const baseline = scopedBaselineByGroup.get(key);
    const current = currentMetrics.find((m) => m.jobName === v.jobName && m.group === v.group);
    const baselineMs = baseline?.restoreMs ?? 0;
    const currentMs = current?.restoreMs ?? 0;
    const deltaPct = baselineMs > 0 ? ((currentMs - baselineMs) / baselineMs) * 100 : 0;
    return {
      scope: "job" as const,
      name: `${v.jobName}/${v.group}`,
      baseline_ms: Math.round(baselineMs),
      current_ms: Math.round(currentMs),
      delta_pct: Math.round(deltaPct * 10) / 10,
    };
  });

  const findings = policyResult.metrics.map((m) => ({
    scope: "job" as const,
    name: `${m.jobName}/${m.group}`,
    risk_level: m.hitRate < 0.5 ? "high" : "low",
    detail: `hit=${(m.hitRate * 100).toFixed(0)}% restore=${m.restoreMs ?? "n/a"}ms churn=${(m.keyChurn * 100).toFixed(0)}%`,
  }));

  const baselineNotes = buildCacheBaselineNotes(baselineResult.runs.length, baselineAnalysis, {
    originalConfidence: baselineResult.confidence,
    effectiveConfidence,
  });

  return {
    result: finalVerdict,
    confidence: effectiveConfidence,
    reason_codes: finalReasonCodes,
    baseline_samples:
      finalReasonCodes.includes("WARN_NO_BASELINE") || finalReasonCodes.includes("SKIP_NO_BASELINE")
        ? 0
        : baselineResult.runs.length,
    top_regressions: regressions.length > 0 ? regressions : undefined,
    top_findings: findings.length > 0 ? findings : undefined,
    fix_suggestions: [...baselineNotes, ...generateFixSuggestions(policyResult.violations)],
  };
}

function filterBaselineToCurrentGroups(
  baselineByGroup: Map<string, CacheBaselineMetrics>,
  currentMetrics: import("./metrics/types.js").CacheGroupMetrics[],
): Map<string, CacheBaselineMetrics> {
  const scoped = new Map<string, CacheBaselineMetrics>();
  for (const m of currentMetrics) {
    const key = `${m.jobName}::${m.group}`;
    const baseline = baselineByGroup.get(key);
    if (baseline) scoped.set(key, baseline);
  }
  return scoped;
}

async function computeCacheBaselineAnalysis(
  runs: { run: { id: number }; jobs: import("@gates-suite/core").WorkflowJob[] }[],
  client: GatesApiClient,
  currentMetrics: import("./metrics/types.js").CacheGroupMetrics[],
): Promise<CacheBaselineAnalysis> {
  const runsToInspect = runs.slice(0, 5);
  const aggregates = new Map<string, BaselineAggregate>();
  const currentKeys = new Set(currentMetrics.map((m) => `${m.jobName}::${m.group}`));
  let cacheRunsWithAnyMetrics = 0;
  let cacheRunsMatchingCurrentGroups = 0;

  for (const runData of runsToInspect) {
    const jobs =
      runData.jobs.length > 0 ? runData.jobs : await client.listJobsForRun(runData.run.id);
    const { tokens, markers } = extractCacheData(jobs);
    const { associations } = associateTimings(tokens, markers);
    const metrics = computeGroupMetrics(tokens, associations);
    if (metrics.length > 0) cacheRunsWithAnyMetrics++;

    let matchedCurrentGroupThisRun = false;

    for (const m of metrics) {
      const key = `${m.jobName}::${m.group}`;
      const existing = aggregates.get(key);
      if (currentKeys.has(key)) matchedCurrentGroupThisRun = true;
      if (!existing) {
        aggregates.set(key, {
          hitRateSum: m.hitRate,
          restoreMsSum: m.restoreMs ?? 0,
          restoreMsCount: m.restoreMs === undefined ? 0 : 1,
          samples: 1,
        });
      } else {
        existing.hitRateSum += m.hitRate;
        existing.samples += 1;
        if (m.restoreMs !== undefined) {
          existing.restoreMsSum += m.restoreMs;
          existing.restoreMsCount += 1;
        }
      }
    }

    if (matchedCurrentGroupThisRun) cacheRunsMatchingCurrentGroups++;
  }

  const byGroup = new Map<string, CacheBaselineMetrics>();
  for (const [key, agg] of aggregates) {
    byGroup.set(key, {
      hitRate: agg.hitRateSum / agg.samples,
      restoreMs: agg.restoreMsCount > 0 ? agg.restoreMsSum / agg.restoreMsCount : undefined,
    });
  }

  const missingCurrentGroups: string[] = [];
  let matchedCurrentGroupCount = 0;
  let minMatchedGroupSamples = Number.POSITIVE_INFINITY;

  for (const key of currentKeys) {
    const agg = aggregates.get(key);
    if (!agg) {
      missingCurrentGroups.push(key);
      continue;
    }
    matchedCurrentGroupCount++;
    minMatchedGroupSamples = Math.min(minMatchedGroupSamples, agg.samples);
  }

  return {
    byGroup,
    workflowBaselineRunsFetched: runs.length,
    cacheRunsInspected: runsToInspect.length,
    cacheRunsWithAnyMetrics,
    cacheRunsMatchingCurrentGroups,
    currentGroupCount: currentKeys.size,
    matchedCurrentGroupCount,
    missingCurrentGroups,
    minMatchedGroupSamples:
      minMatchedGroupSamples === Number.POSITIVE_INFINITY ? 0 : minMatchedGroupSamples,
  };
}

function deriveCacheBaselineConfidence(
  baselineConfidence: ConfidenceLevel,
  analysis: CacheBaselineAnalysis,
): ConfidenceLevel {
  if (analysis.currentGroupCount === 0) return "low";
  if (analysis.matchedCurrentGroupCount === 0) return "low";
  if (analysis.matchedCurrentGroupCount < analysis.currentGroupCount) return "low";
  if (analysis.minMatchedGroupSamples < 3) return "low";
  if (analysis.minMatchedGroupSamples < 5 && baselineConfidence === "high") return "med";
  return baselineConfidence;
}

function buildCacheBaselineNotes(
  workflowBaselineRunsFetched: number,
  analysis: CacheBaselineAnalysis,
  confidence: { originalConfidence: ConfidenceLevel; effectiveConfidence: ConfidenceLevel },
): string[] {
  const notes: string[] = [];
  if (
    confidence.effectiveConfidence !== confidence.originalConfidence &&
    analysis.currentGroupCount > 0 &&
    analysis.matchedCurrentGroupCount > 0
  ) {
    const missing =
      analysis.missingCurrentGroups.length > 0
        ? ` Missing baseline for: ${analysis.missingCurrentGroups.join(", ")}.`
        : "";
    notes.push(
      `Cache baseline coverage is thin: fetched ${workflowBaselineRunsFetched} workflow baseline runs, but only ${analysis.cacheRunsMatchingCurrentGroups}/${analysis.cacheRunsInspected} inspected runs matched current cache groups (${analysis.matchedCurrentGroupCount}/${analysis.currentGroupCount} groups, min ${analysis.minMatchedGroupSamples} sample(s) per matched group). Confidence was downgraded from ${confidence.originalConfidence} to ${confidence.effectiveConfidence}.${missing}`,
    );
  }
  return notes;
}

function handleGracefulDegrade(error: unknown): GateResult | undefined {
  if (!(error instanceof GatesApiError)) return undefined;

  if (error.isAbuseDetection) {
    actionsCore.warning(`GitHub abuse detection triggered: ${error.message}`);
    return createSkippedResult(["SKIP_GITHUB_ABUSE_LIMIT"]);
  }

  if (error.statusCode === 403) {
    actionsCore.warning(`Insufficient permissions: ${error.message}`);
    return createSkippedResult(["SKIP_PERMISSION_DENIED"]);
  }

  if (error.statusCode === 429) {
    actionsCore.warning("GitHub API rate limit hit. Reduce API calls or wait for reset.");
    return createSkippedResult(["SKIP_RATE_LIMITED"]);
  }

  if (error.message.includes("API budget exhausted")) {
    actionsCore.warning(error.message);
    return createSkippedResult(["SKIP_API_BUDGET_EXHAUSTED"]);
  }

  return undefined;
}

/**
 * Extract workflow file name from GITHUB_WORKFLOW_REF (e.g.
 * "owner/repo/.github/workflows/ci.yml@refs/heads/main" → "ci.yml").
 * Falls back to GITHUB_WORKFLOW (display name) which may not resolve
 * via the API if it differs from the filename.
 */
function resolveWorkflowId(): string {
  const ref = process.env["GITHUB_WORKFLOW_REF"];
  if (ref) {
    const match = ref.match(/\.github\/workflows\/([^@]+)/);
    if (match?.[1]) return match[1];
  }
  return process.env["GITHUB_WORKFLOW"] ?? "";
}

function generateFixSuggestions(violations: { reasonCode: string; group: string }[]): string[] {
  const suggestions: string[] = [];
  const seen = new Set<string>();

  for (const v of violations) {
    if (seen.has(v.reasonCode)) continue;
    seen.add(v.reasonCode);

    switch (v.reasonCode) {
      case "FAIL_HIT_RATE_DROP":
      case "WARN_HIT_RATE_DROP":
        suggestions.push(
          `Check cache key composition for group "${v.group}". Ensure key includes only deterministic inputs (lockfile hash, OS, node version).`,
        );
        break;
      case "FAIL_RESTORE_REGRESSION":
      case "WARN_RESTORE_REGRESSION":
        suggestions.push(
          `Investigate cache size growth for group "${v.group}". Consider using more granular cache keys or cleanup steps.`,
        );
        break;
      case "WARN_KEY_CHURN":
        suggestions.push(
          `Group "${v.group}" has high key churn. Review if volatile inputs (timestamps, random values) are included in the cache key.`,
        );
        break;
    }
  }

  return suggestions;
}
