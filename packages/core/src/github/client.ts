import { Octokit } from "@octokit/rest";
import type { GatesApiClientOptions, ApiBudgetState, WorkflowRun, WorkflowJob } from "./types.js";

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;

export class GatesApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly isRetryable: boolean,
    public readonly isAbuseDetection: boolean,
  ) {
    super(message);
    this.name = "GatesApiError";
  }
}

export class GatesApiClient {
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;
  private readonly retryAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly budget: ApiBudgetState;

  constructor(options: GatesApiClientOptions) {
    this.octokit = new Octokit({ auth: options.token });
    this.owner = options.owner;
    this.repo = options.repo;
    this.retryAttempts = options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.budget = {
      used: 0,
      limit: options.apibudgetCalls,
      exhausted: false,
    };
  }

  get budgetState(): Readonly<ApiBudgetState> {
    return { ...this.budget };
  }

  private checkBudget(): void {
    if (this.budget.used >= this.budget.limit) {
      this.budget.exhausted = true;
      throw new GatesApiError(
        `API budget exhausted: ${this.budget.used}/${this.budget.limit} calls used`,
        0,
        false,
        false,
      );
    }
  }

  private consumeBudget(): void {
    this.budget.used++;
    if (this.budget.used >= this.budget.limit) {
      this.budget.exhausted = true;
    }
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
      try {
        this.checkBudget();
        this.consumeBudget();
        return await operation();
      } catch (error: unknown) {
        lastError = error;
        const apiError = this.classifyError(error);

        if (!apiError.isRetryable || attempt === this.retryAttempts) {
          throw apiError;
        }

        const delay = this.retryBaseDelayMs * Math.pow(2, attempt);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private classifyError(error: unknown): GatesApiError {
    if (error instanceof GatesApiError) {
      return error;
    }

    const statusCode = (error as { status?: number }).status ?? 0;
    const message = error instanceof Error ? error.message : String(error);

    const isAbuseDetection =
      statusCode === 403 &&
      (message.toLowerCase().includes("abuse") ||
        message.toLowerCase().includes("secondary rate limit"));

    const isRateLimit = statusCode === 429;
    const isServerError = statusCode >= 500;
    const isRetryable = isAbuseDetection || isRateLimit || isServerError;

    return new GatesApiError(message, statusCode, isRetryable, isAbuseDetection);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async listWorkflowRuns(params: {
    workflowId: number | string;
    branch?: string;
    event?: string;
    status?: string;
    perPage?: number;
    maxPages?: number;
  }): Promise<WorkflowRun[]> {
    const runs: WorkflowRun[] = [];
    const perPage = params.perPage ?? 30;
    const maxPages = params.maxPages ?? 3;

    for (let page = 1; page <= maxPages; page++) {
      const response = await this.withRetry(() =>
        this.octokit.actions.listWorkflowRuns({
          owner: this.owner,
          repo: this.repo,
          workflow_id: params.workflowId,
          branch: params.branch,
          event: params.event,
          status: params.status as "completed" | undefined,
          per_page: perPage,
          page,
        }),
      );

      const pageRuns = response.data.workflow_runs.map(
        (r): WorkflowRun => ({
          id: r.id,
          workflow_id: r.workflow_id,
          status: r.status ?? "unknown",
          conclusion: r.conclusion ?? null,
          event: r.event,
          head_branch: r.head_branch,
          created_at: r.created_at,
          updated_at: r.updated_at,
          run_started_at: r.run_started_at ?? undefined,
          run_attempt: r.run_attempt ?? undefined,
        }),
      );

      runs.push(...pageRuns);

      if (pageRuns.length < perPage) break;
    }

    return runs;
  }

  async listJobsForRun(runId: number): Promise<WorkflowJob[]> {
    const response = await this.withRetry(() =>
      this.octokit.actions.listJobsForWorkflowRun({
        owner: this.owner,
        repo: this.repo,
        run_id: runId,
        per_page: 100,
      }),
    );

    return response.data.jobs.map(
      (j): WorkflowJob => ({
        id: j.id,
        run_id: j.run_id,
        name: j.name,
        status: j.status,
        conclusion: j.conclusion ?? null,
        started_at: j.started_at ?? null,
        completed_at: j.completed_at ?? null,
        steps: j.steps?.map((s) => ({
          name: s.name,
          status: s.status,
          conclusion: s.conclusion ?? null,
          number: s.number,
          started_at: s.started_at ?? null,
          completed_at: s.completed_at ?? null,
        })),
      }),
    );
  }
}
