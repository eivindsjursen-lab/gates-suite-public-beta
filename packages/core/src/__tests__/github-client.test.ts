import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GatesApiClient, GatesApiError } from "../github/client.js";

const OWNER = "test-org";
const REPO = "test-repo";
const WORKFLOW_ID = 12345;
const RUNS_URL = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_ID}/runs`;
const JOBS_URL = `https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/100/jobs`;

function makeRun(id: number, conclusion = "success") {
  return {
    id,
    workflow_id: WORKFLOW_ID,
    status: "completed",
    conclusion,
    event: "push",
    head_branch: "main",
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-02-01T00:10:00Z",
    run_started_at: "2026-02-01T00:00:00Z",
    run_attempt: 1,
  };
}

function makeJob(id: number, runId: number, name: string) {
  return {
    id,
    run_id: runId,
    name,
    status: "completed",
    conclusion: "success",
    started_at: "2026-02-01T00:00:00Z",
    completed_at: "2026-02-01T00:05:00Z",
    steps: [
      {
        name: "Run tests",
        status: "completed",
        conclusion: "success",
        number: 1,
        started_at: "2026-02-01T00:01:00Z",
        completed_at: "2026-02-01T00:04:00Z",
      },
    ],
  };
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function createClient(budget = 30, retryAttempts = 2, retryBaseDelayMs = 10) {
  return new GatesApiClient({
    token: "test-token",
    owner: OWNER,
    repo: REPO,
    apibudgetCalls: budget,
    retryAttempts,
    retryBaseDelayMs,
  });
}

describe("GatesApiClient", () => {
  describe("listWorkflowRuns", () => {
    it("fetches and maps workflow runs", async () => {
      server.use(
        http.get(RUNS_URL, () =>
          HttpResponse.json({
            total_count: 2,
            workflow_runs: [makeRun(1), makeRun(2, "failure")],
          }),
        ),
      );

      const client = createClient();
      const runs = await client.listWorkflowRuns({ workflowId: WORKFLOW_ID });

      expect(runs).toHaveLength(2);
      expect(runs[0]?.id).toBe(1);
      expect(runs[0]?.conclusion).toBe("success");
      expect(runs[1]?.conclusion).toBe("failure");
    });

    it("paginates across multiple pages", async () => {
      let callCount = 0;
      server.use(
        http.get(RUNS_URL, ({ request }) => {
          callCount++;
          const url = new URL(request.url);
          const page = Number(url.searchParams.get("page") ?? "1");
          const perPage = Number(url.searchParams.get("per_page") ?? "30");

          if (page === 1) {
            return HttpResponse.json({
              total_count: perPage + 5,
              workflow_runs: Array.from({ length: perPage }, (_, i) => makeRun(i + 1)),
            });
          }
          return HttpResponse.json({
            total_count: perPage + 5,
            workflow_runs: Array.from({ length: 5 }, (_, i) => makeRun(perPage + i + 1)),
          });
        }),
      );

      const client = createClient();
      const runs = await client.listWorkflowRuns({
        workflowId: WORKFLOW_ID,
        perPage: 10,
      });

      expect(runs.length).toBe(15);
      expect(callCount).toBe(2);
    });

    it("passes query parameters correctly", async () => {
      let capturedParams: Record<string, string> = {};
      server.use(
        http.get(RUNS_URL, ({ request }) => {
          const url = new URL(request.url);
          capturedParams = Object.fromEntries(url.searchParams.entries());
          return HttpResponse.json({ total_count: 0, workflow_runs: [] });
        }),
      );

      const client = createClient();
      await client.listWorkflowRuns({
        workflowId: WORKFLOW_ID,
        branch: "main",
        event: "push",
        status: "completed",
      });

      expect(capturedParams["branch"]).toBe("main");
      expect(capturedParams["event"]).toBe("push");
      expect(capturedParams["status"]).toBe("completed");
    });
  });

  describe("listJobsForRun", () => {
    it("fetches and maps jobs with steps", async () => {
      server.use(
        http.get(JOBS_URL, () =>
          HttpResponse.json({
            total_count: 1,
            jobs: [makeJob(200, 100, "test")],
          }),
        ),
      );

      const client = createClient();
      const jobs = await client.listJobsForRun(100);

      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.name).toBe("test");
      expect(jobs[0]?.steps).toHaveLength(1);
      expect(jobs[0]?.steps?.[0]?.name).toBe("Run tests");
    });
  });

  describe("rate limiting and retries", () => {
    it("retries on 429 with exponential backoff", async () => {
      let attempts = 0;
      server.use(
        http.get(RUNS_URL, () => {
          attempts++;
          if (attempts < 3) {
            return new HttpResponse(null, { status: 429 });
          }
          return HttpResponse.json({ total_count: 0, workflow_runs: [] });
        }),
      );

      const client = createClient(30, 3, 10);
      const runs = await client.listWorkflowRuns({ workflowId: WORKFLOW_ID });

      expect(runs).toHaveLength(0);
      expect(attempts).toBe(3);
    });

    it("retries on 500 server errors", async () => {
      let attempts = 0;
      server.use(
        http.get(RUNS_URL, () => {
          attempts++;
          if (attempts < 2) {
            return new HttpResponse(null, { status: 502 });
          }
          return HttpResponse.json({ total_count: 0, workflow_runs: [] });
        }),
      );

      const client = createClient(30, 3, 10);
      const runs = await client.listWorkflowRuns({ workflowId: WORKFLOW_ID });

      expect(runs).toHaveLength(0);
      expect(attempts).toBe(2);
    });
  });

  describe("abuse detection", () => {
    it("classifies 403 abuse response and retries", async () => {
      let attempts = 0;
      server.use(
        http.get(RUNS_URL, () => {
          attempts++;
          if (attempts === 1) {
            return HttpResponse.json(
              { message: "You have exceeded a secondary rate limit" },
              { status: 403 },
            );
          }
          return HttpResponse.json({ total_count: 0, workflow_runs: [] });
        }),
      );

      const client = createClient(30, 3, 10);
      const runs = await client.listWorkflowRuns({ workflowId: WORKFLOW_ID });
      expect(runs).toHaveLength(0);
      expect(attempts).toBe(2);
    });

    it("does not retry 403 permission denied", async () => {
      server.use(
        http.get(RUNS_URL, () =>
          HttpResponse.json({ message: "Resource not accessible by integration" }, { status: 403 }),
        ),
      );

      const client = createClient(30, 3, 10);
      await expect(client.listWorkflowRuns({ workflowId: WORKFLOW_ID })).rejects.toThrow(
        GatesApiError,
      );
    });

    it("does not retry 404", async () => {
      server.use(http.get(RUNS_URL, () => new HttpResponse(null, { status: 404 })));

      const client = createClient(30, 3, 10);
      await expect(client.listWorkflowRuns({ workflowId: WORKFLOW_ID })).rejects.toThrow(
        GatesApiError,
      );
    });
  });

  describe("API budget", () => {
    it("tracks budget usage", async () => {
      server.use(
        http.get(RUNS_URL, () => HttpResponse.json({ total_count: 0, workflow_runs: [] })),
      );

      const client = createClient(5);
      expect(client.budgetState.used).toBe(0);

      await client.listWorkflowRuns({ workflowId: WORKFLOW_ID });
      expect(client.budgetState.used).toBe(1);
    });

    it("throws when budget is exhausted", async () => {
      server.use(
        http.get(RUNS_URL, () => HttpResponse.json({ total_count: 0, workflow_runs: [] })),
      );

      const client = createClient(2);
      await client.listWorkflowRuns({ workflowId: WORKFLOW_ID });
      await client.listWorkflowRuns({ workflowId: WORKFLOW_ID });

      await expect(client.listWorkflowRuns({ workflowId: WORKFLOW_ID })).rejects.toThrow(
        "API budget exhausted",
      );

      expect(client.budgetState.exhausted).toBe(true);
    });
  });
});
