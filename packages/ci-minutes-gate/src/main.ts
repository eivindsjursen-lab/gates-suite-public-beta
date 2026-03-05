import * as actionsCore from "@actions/core";
import {
  GatesApiClient,
  GatesApiError,
  BaselineEngine,
  dispatchOutput,
  createSkippedResult,
  type GateResult,
  type BaselineConfig,
} from "@gates-suite/core";
import { computeRunDuration, analyzeDuration } from "./analyzer/duration.js";
import { evaluateMinutesPolicy } from "./policy/evaluate.js";
import type { DurationAnalyzerConfig } from "./analyzer/types.js";
import type { MinutesPolicyConfig } from "./policy/types.js";

export async function run(): Promise<void> {
  try {
    const config = readInputs();
    const client = createClient(config);
    const result = await execute(client, config);
    await dispatchOutput(result, {
      title: "CI Minutes Delta Gate",
      gateName: "ci-minutes-gate",
      writeComment: config.prNumber !== undefined,
      commentToken: config.token,
      owner: config.owner,
      repo: config.repo,
      prNumber: config.prNumber,
    });
  } catch (error) {
    const result = handleGracefulDegrade(error);
    if (result) {
      await dispatchOutput(result, {
        title: "CI Minutes Delta Gate",
        gateName: "ci-minutes-gate",
        writeComment: false,
      });
    } else {
      actionsCore.setFailed(error instanceof Error ? error.message : String(error));
    }
  }
}

interface ActionConfig {
  token: string;
  mode: "warn" | "fail";
  baselineRuns: number;
  baselineWindowDays: number;
  baselineEventFilter: string;
  noBaselineBehavior: "warn" | "skip";
  regressionThresholdPct: number;
  budgetTotalMs: number | undefined;
  budgetPerJobMs: number | undefined;
  apiBudgetCalls: number;
  owner: string;
  repo: string;
  prNumber: number | undefined;
}

function readInputs(): ActionConfig {
  const [owner = "", repo = ""] = (process.env["GITHUB_REPOSITORY"] ?? "").split("/");

  const prNumberStr =
    process.env["GITHUB_EVENT_NAME"] === "pull_request"
      ? (process.env["PR_NUMBER"] ?? actionsCore.getInput("pr_number"))
      : undefined;
  const prNumber = prNumberStr ? parseInt(prNumberStr, 10) || undefined : undefined;

  const budgetTotalStr = actionsCore.getInput("budget_total_seconds");
  const budgetPerJobStr = actionsCore.getInput("budget_per_job_seconds");

  return {
    token: actionsCore.getInput("token") || (process.env["GITHUB_TOKEN"] ?? ""),
    mode: actionsCore.getInput("mode") === "fail" ? "fail" : "warn",
    baselineRuns: parseInt(actionsCore.getInput("baseline_runs") || "10", 10),
    baselineWindowDays: parseInt(actionsCore.getInput("baseline_window_days") || "14", 10),
    baselineEventFilter: actionsCore.getInput("baseline_event_filter") || "push",
    noBaselineBehavior: actionsCore.getInput("no_baseline_behavior") === "skip" ? "skip" : "warn",
    regressionThresholdPct: parseFloat(
      actionsCore.getInput("thresholds_total_regression_pct") || "15",
    ),
    budgetTotalMs: budgetTotalStr ? parseFloat(budgetTotalStr) * 1000 : undefined,
    budgetPerJobMs: budgetPerJobStr ? parseFloat(budgetPerJobStr) * 1000 : undefined,
    apiBudgetCalls: parseInt(actionsCore.getInput("api_budget_calls") || "30", 10),
    owner,
    repo,
    prNumber,
  };
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
  const defaultBranch = process.env["GITHUB_BASE_REF"] || "main";

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
  };

  const baselineResult = await baselineEngine.fetchBaseline(baselineConfig);

  if (baselineResult.runs.length === 0 && config.noBaselineBehavior === "skip") {
    return createSkippedResult(["SKIP_NO_BASELINE"]);
  }

  const currentRunId = parseInt(process.env["GITHUB_RUN_ID"] ?? "0", 10);
  if (!currentRunId) {
    return createSkippedResult(["SKIP_NO_BASELINE"]);
  }

  const currentRun = makeRun(currentRunId);
  const currentJobs = await client.listJobsForRun(currentRunId);
  const runDuration = computeRunDuration(currentRun, currentJobs);

  const analyzerConfig: DurationAnalyzerConfig = {
    regressionThresholdPct: config.regressionThresholdPct,
    budgetTotalMs: config.budgetTotalMs,
    budgetPerJobMs: config.budgetPerJobMs,
  };

  const analysis = analyzeDuration(
    runDuration,
    baselineResult.runs,
    baselineResult.confidence,
    analyzerConfig,
  );

  const policyConfig: MinutesPolicyConfig = {
    mode: config.mode,
    regressionThresholdPct: config.regressionThresholdPct,
    noBaselineBehavior: config.noBaselineBehavior,
  };

  const policyResult = evaluateMinutesPolicy(analysis, policyConfig);

  const regressions = policyResult.regressions.map((r) => ({
    scope: r.scope,
    name: r.name,
    baseline_ms: r.baselineMs,
    current_ms: r.currentMs,
    delta_pct: r.deltaPct,
  }));

  const findings = policyResult.topJobs.map((j) => ({
    scope: "job" as const,
    name: j.name,
    risk_level: (j.deltaPct ?? 0) > config.regressionThresholdPct ? "high" : "low",
    detail: `${formatMs(j.durationMs)}${j.deltaPct !== undefined ? ` (${j.deltaPct > 0 ? "+" : ""}${j.deltaPct.toFixed(1)}%)` : ""}`,
  }));

  return {
    result: policyResult.verdict,
    confidence: policyResult.confidence,
    reason_codes: policyResult.reasonCodes,
    baseline_samples: analysis.baselineSamples,
    top_regressions: regressions.length > 0 ? regressions : undefined,
    top_findings: findings.length > 0 ? findings : undefined,
    fix_suggestions: generateFixSuggestions(policyResult),
  };
}

function makeRun(runId: number) {
  return {
    id: runId,
    workflow_id: 0,
    status: "completed",
    conclusion: "success" as const,
    event: process.env["GITHUB_EVENT_NAME"] ?? "unknown",
    head_branch: process.env["GITHUB_HEAD_REF"] ?? null,
    created_at: process.env["GITHUB_RUN_CREATED_AT"] ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
    run_started_at: process.env["GITHUB_RUN_STARTED_AT"],
  };
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

function resolveWorkflowId(): string {
  const ref = process.env["GITHUB_WORKFLOW_REF"];
  if (ref) {
    const match = ref.match(/\.github\/workflows\/([^@]+)/);
    if (match?.[1]) return match[1];
  }
  return process.env["GITHUB_WORKFLOW"] ?? "";
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function generateFixSuggestions(policyResult: ReturnType<typeof evaluateMinutesPolicy>): string[] {
  const suggestions: string[] = [];

  if (policyResult.regressions.length > 0) {
    const topRegression = policyResult.regressions[0];
    if (topRegression) {
      if (topRegression.scope === "workflow") {
        suggestions.push(
          "Overall workflow duration regressed. Check the top jobs below for the biggest contributors.",
        );
      } else {
        suggestions.push(
          `Job "${topRegression.name}" regressed ${topRegression.deltaPct.toFixed(0)}%. Review its steps for new or slower operations.`,
        );
      }
    }
  }

  if (policyResult.budgetViolations.length > 0) {
    for (const v of policyResult.budgetViolations) {
      suggestions.push(
        `${v.scope === "workflow" ? "Workflow" : `Job "${v.name}"`} exceeded budget by ${formatMs(v.overageMs)}. Consider parallelizing steps or caching dependencies.`,
      );
    }
  }

  return suggestions;
}
