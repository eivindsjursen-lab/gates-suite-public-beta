import { z } from 'zod';

declare const GateVerdict: z.ZodEnum<{
    pass: "pass";
    warn: "warn";
    fail: "fail";
    skipped: "skipped";
}>;
type GateVerdict = z.infer<typeof GateVerdict>;
declare const ConfidenceLevel: z.ZodEnum<{
    low: "low";
    med: "med";
    high: "high";
}>;
type ConfidenceLevel = z.infer<typeof ConfidenceLevel>;
declare const BaselineMode: z.ZodEnum<{
    api: "api";
}>;
type BaselineMode = z.infer<typeof BaselineMode>;
declare const BaselineInfo: z.ZodObject<{
    mode: z.ZodEnum<{
        api: "api";
    }>;
    branch: z.ZodString;
    workflow_id: z.ZodNumber;
    runs: z.ZodNumber;
    samples_used: z.ZodNumber;
}, z.core.$strip>;
type BaselineInfo = z.infer<typeof BaselineInfo>;
declare const RegressionScope: z.ZodEnum<{
    workflow: "workflow";
    job: "job";
    step: "step";
    group: "group";
}>;
type RegressionScope = z.infer<typeof RegressionScope>;
declare const Regression: z.ZodObject<{
    scope: z.ZodEnum<{
        workflow: "workflow";
        job: "job";
        step: "step";
        group: "group";
    }>;
    name: z.ZodString;
    delta_pct: z.ZodNumber;
    baseline_ms: z.ZodNumber;
    current_ms: z.ZodNumber;
}, z.core.$strip>;
type Regression = z.infer<typeof Regression>;
declare const Finding: z.ZodObject<{
    scope: z.ZodString;
    name: z.ZodString;
    risk_level: z.ZodString;
    detail: z.ZodString;
}, z.core.$strip>;
type Finding = z.infer<typeof Finding>;
/**
 * Standard result JSON shape (Appendix B of the blueprint).
 * All gates produce this shape. Products may extend top_regressions
 * or top_findings but the envelope is fixed.
 */
declare const GateResult: z.ZodObject<{
    result: z.ZodEnum<{
        pass: "pass";
        warn: "warn";
        fail: "fail";
        skipped: "skipped";
    }>;
    confidence: z.ZodEnum<{
        low: "low";
        med: "med";
        high: "high";
    }>;
    reason_codes: z.ZodArray<z.ZodString>;
    baseline: z.ZodOptional<z.ZodObject<{
        mode: z.ZodEnum<{
            api: "api";
        }>;
        branch: z.ZodString;
        workflow_id: z.ZodNumber;
        runs: z.ZodNumber;
        samples_used: z.ZodNumber;
    }, z.core.$strip>>;
    baseline_samples: z.ZodNumber;
    top_regressions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        scope: z.ZodEnum<{
            workflow: "workflow";
            job: "job";
            step: "step";
            group: "group";
        }>;
        name: z.ZodString;
        delta_pct: z.ZodNumber;
        baseline_ms: z.ZodNumber;
        current_ms: z.ZodNumber;
    }, z.core.$strip>>>;
    top_findings: z.ZodOptional<z.ZodArray<z.ZodObject<{
        scope: z.ZodString;
        name: z.ZodString;
        risk_level: z.ZodString;
        detail: z.ZodString;
    }, z.core.$strip>>>;
    fix_suggestions: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
type GateResult = z.infer<typeof GateResult>;
declare function createPassResult(overrides?: Partial<GateResult>): GateResult;
declare function createSkippedResult(reasonCodes: string[], overrides?: Partial<GateResult>): GateResult;

interface WorkflowRun {
    id: number;
    workflow_id: number;
    status: string;
    conclusion: string | null;
    event: string;
    head_branch: string | null;
    created_at: string;
    updated_at: string;
    run_started_at?: string | undefined;
    run_attempt?: number | undefined;
}
interface WorkflowJob {
    id: number;
    run_id: number;
    name: string;
    status: string;
    conclusion: string | null;
    started_at: string | null;
    completed_at: string | null;
    steps?: WorkflowStep[] | undefined;
}
interface WorkflowStep {
    name: string;
    status: string;
    conclusion: string | null;
    number: number;
    started_at: string | null;
    completed_at: string | null;
}
interface GatesApiClientOptions {
    token: string;
    owner: string;
    repo: string;
    apibudgetCalls: number;
    retryAttempts?: number;
    retryBaseDelayMs?: number;
}
interface ApiBudgetState {
    used: number;
    limit: number;
    exhausted: boolean;
}

declare class GatesApiError extends Error {
    readonly statusCode: number;
    readonly isRetryable: boolean;
    readonly isAbuseDetection: boolean;
    constructor(message: string, statusCode: number, isRetryable: boolean, isAbuseDetection: boolean);
}
declare class GatesApiClient {
    private readonly octokit;
    private readonly owner;
    private readonly repo;
    private readonly retryAttempts;
    private readonly retryBaseDelayMs;
    private readonly budget;
    constructor(options: GatesApiClientOptions);
    get budgetState(): Readonly<ApiBudgetState>;
    private checkBudget;
    private consumeBudget;
    private withRetry;
    private classifyError;
    private sleep;
    listWorkflowRuns(params: {
        workflowId: number | string;
        branch?: string;
        event?: string;
        status?: string;
        perPage?: number;
        maxPages?: number;
    }): Promise<WorkflowRun[]>;
    listJobsForRun(runId: number): Promise<WorkflowJob[]>;
}

interface BaselineConfig {
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
interface BaselineRunData {
    run: WorkflowRun;
    jobs: WorkflowJob[];
    durationMs: number;
}
interface BaselineResult {
    config: BaselineConfig;
    runs: BaselineRunData[];
    samplesUsed: number;
    confidence: ConfidenceLevel;
    confidenceReasons: string[];
}
interface JobDurationBaseline {
    name: string;
    medianMs: number;
    p90Ms: number | undefined;
    samples: number;
}
interface WorkflowDurationBaseline {
    medianMs: number;
    p90Ms: number | undefined;
    samples: number;
    jobs: JobDurationBaseline[];
}

declare class BaselineEngine {
    private readonly client;
    constructor(client: GatesApiClient);
    fetchBaseline(config: BaselineConfig): Promise<BaselineResult>;
    computeDurationBaseline(result: BaselineResult): WorkflowDurationBaseline | undefined;
    private isEligible;
    private computeRunDuration;
    private assessConfidence;
}

/**
 * Compute median of a numeric array. Returns undefined for empty arrays.
 */
declare function median(values: number[]): number | undefined;
/**
 * Compute the p-th percentile (0-100) of a numeric array.
 */
declare function percentile(values: number[], p: number): number | undefined;
/**
 * Compute coefficient of variation (std dev / mean). Higher = more variance.
 * Returns undefined for empty arrays or zero mean.
 */
declare function coefficientOfVariation(values: number[]): number | undefined;
/**
 * Compute percentage delta between baseline and current values.
 */
declare function deltaPct(baseline: number, current: number): number;

interface MarkdownReportOptions {
    title: string;
    gateName: string;
}
/**
 * Render a GateResult as a GitHub Job Summary markdown string.
 * Structure: What changed / So what / Now what.
 */
declare function renderJobSummary(result: GateResult, options: MarkdownReportOptions): string;

interface OutputDispatcherOptions extends MarkdownReportOptions {
    writeComment: boolean;
    commentToken?: string | undefined;
    owner?: string | undefined;
    repo?: string | undefined;
    prNumber?: number | undefined;
    extraOutputs?: Record<string, string> | undefined;
}
/**
 * Dispatch gate results to all output channels.
 * Job Summary is always written. PR comment is best-effort.
 * Never throws on comment failure (fork safety).
 */
declare function dispatchOutput(result: GateResult, options: OutputDispatcherOptions): Promise<void>;
/**
 * Write result as a JSON artifact string (for file output).
 */
declare function serializeResultJson(result: GateResult): string;

/**
 * Reason-code registry for the gates suite.
 *
 * Every WARN/FAIL/SKIPPED path must emit at least one stable reason code.
 * Codes use UPPER_SNAKE_CASE with prefixes: PASS_, WARN_, FAIL_, SKIP_.
 * Human text can improve over time; reason codes are the long-term contract.
 */
interface ReasonCodeEntry {
    code: string;
    severity: "pass" | "warn" | "fail" | "skip";
    message: string;
}
declare const PASS_ALL_CLEAR: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const SKIP_NO_BASELINE: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const SKIP_PERMISSION_DENIED: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const SKIP_GITHUB_ABUSE_LIMIT: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const SKIP_WORKFLOW_MISMATCH: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const SKIP_UNSUPPORTED_FORMAT: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const SKIP_API_BUDGET_EXHAUSTED: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const SKIP_RATE_LIMITED: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const WARN_LOW_CONFIDENCE: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const WARN_NO_BASELINE: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const WARN_INSUFFICIENT_SAMPLES: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const WARN_RATE_LIMITED: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const FAIL_HIT_RATE_DROP: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const FAIL_RESTORE_REGRESSION: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const WARN_HIT_RATE_DROP: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const WARN_RESTORE_REGRESSION: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const WARN_KEY_CHURN: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const WARN_DUPLICATE_CACHE_STEP_GROUP: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const SKIP_NO_CACHE_DETECTED: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const FAIL_DURATION_REGRESSION: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const WARN_DURATION_INCREASE: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const WARN_BUDGET_EXCEEDED: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const FAIL_CAPABILITY_ESCALATION: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const WARN_CAPABILITY_EXPANSION: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const WARN_HEURISTIC_MAPPING: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare const PASS_NO_SCOPE_CHANGE: {
    readonly code: string;
    readonly severity: "pass" | "warn" | "fail" | "skip";
    readonly message: string;
};
declare function lookupReasonCode(code: string): ReasonCodeEntry | undefined;
declare function getReasonMessage(code: string): string;
declare function isValidReasonCode(code: string): boolean;
declare function allReasonCodes(): ReadonlyMap<string, ReasonCodeEntry>;
declare function validateReasonCodePrefix(code: string): boolean;

export { type ApiBudgetState, type BaselineConfig, BaselineEngine, BaselineInfo, BaselineMode, type BaselineResult, type BaselineRunData, ConfidenceLevel, FAIL_CAPABILITY_ESCALATION, FAIL_DURATION_REGRESSION, FAIL_HIT_RATE_DROP, FAIL_RESTORE_REGRESSION, Finding, GateResult, GateVerdict, GatesApiClient, type GatesApiClientOptions, GatesApiError, type JobDurationBaseline, type MarkdownReportOptions, type OutputDispatcherOptions, PASS_ALL_CLEAR, PASS_NO_SCOPE_CHANGE, type ReasonCodeEntry, Regression, RegressionScope, SKIP_API_BUDGET_EXHAUSTED, SKIP_GITHUB_ABUSE_LIMIT, SKIP_NO_BASELINE, SKIP_NO_CACHE_DETECTED, SKIP_PERMISSION_DENIED, SKIP_RATE_LIMITED, SKIP_UNSUPPORTED_FORMAT, SKIP_WORKFLOW_MISMATCH, WARN_BUDGET_EXCEEDED, WARN_CAPABILITY_EXPANSION, WARN_DUPLICATE_CACHE_STEP_GROUP, WARN_DURATION_INCREASE, WARN_HEURISTIC_MAPPING, WARN_HIT_RATE_DROP, WARN_INSUFFICIENT_SAMPLES, WARN_KEY_CHURN, WARN_LOW_CONFIDENCE, WARN_NO_BASELINE, WARN_RATE_LIMITED, WARN_RESTORE_REGRESSION, type WorkflowDurationBaseline, type WorkflowJob, type WorkflowRun, type WorkflowStep, allReasonCodes, coefficientOfVariation, createPassResult, createSkippedResult, deltaPct, dispatchOutput, getReasonMessage, isValidReasonCode, lookupReasonCode, median, percentile, renderJobSummary, serializeResultJson, validateReasonCodePrefix };
