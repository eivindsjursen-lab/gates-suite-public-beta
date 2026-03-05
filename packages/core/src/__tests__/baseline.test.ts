import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GatesApiClient } from "../github/client.js";
import { BaselineEngine } from "../baseline/engine.js";
import type { BaselineConfig } from "../baseline/types.js";

const OWNER = "test-org";
const REPO = "test-repo";
const WORKFLOW_ID = 99;

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function createEngine() {
  const client = new GatesApiClient({
    token: "test-token",
    owner: OWNER,
    repo: REPO,
    apibudgetCalls: 100,
    retryAttempts: 0,
    retryBaseDelayMs: 1,
  });
  return new BaselineEngine(client);
}

const defaultConfig: BaselineConfig = {
  mode: "api",
  branch: "main",
  workflowId: WORKFLOW_ID,
  runs: 10,
  windowDays: 14,
  eventFilter: "push",
  minSamples: 5,
  requireSuccess: true,
};

function makeRun(id: number, options: { conclusion?: string; minutesAgo?: number } = {}) {
  const { conclusion = "success", minutesAgo = 60 } = options;
  const date = new Date(Date.now() - minutesAgo * 60 * 1000);
  return {
    id,
    workflow_id: WORKFLOW_ID,
    status: "completed",
    conclusion,
    event: "push",
    head_branch: "main",
    created_at: date.toISOString(),
    updated_at: new Date(date.getTime() + 5 * 60 * 1000).toISOString(),
    run_started_at: date.toISOString(),
    run_attempt: 1,
  };
}

function makeJobs(runId: number, durationMinutes = 3) {
  const start = new Date("2026-02-01T00:00:00Z");
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return {
    total_count: 2,
    jobs: [
      {
        id: runId * 10,
        run_id: runId,
        name: "test",
        status: "completed",
        conclusion: "success",
        started_at: start.toISOString(),
        completed_at: end.toISOString(),
        steps: [
          {
            name: "Run tests",
            status: "completed",
            conclusion: "success",
            number: 1,
            started_at: start.toISOString(),
            completed_at: end.toISOString(),
          },
        ],
      },
      {
        id: runId * 10 + 1,
        run_id: runId,
        name: "build",
        status: "completed",
        conclusion: "success",
        started_at: start.toISOString(),
        completed_at: new Date(start.getTime() + 2 * 60 * 1000).toISOString(),
        steps: [],
      },
    ],
  };
}

describe("BaselineEngine", () => {
  describe("fetchBaseline", () => {
    it("fetches and filters successful runs within window", async () => {
      const runs = Array.from({ length: 8 }, (_, i) => makeRun(i + 1));

      server.use(
        http.get(
          `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_ID}/runs`,
          () => HttpResponse.json({ total_count: runs.length, workflow_runs: runs }),
        ),
        http.get(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/:runId/jobs`, () =>
          HttpResponse.json(makeJobs(1)),
        ),
      );

      const engine = createEngine();
      const result = await engine.fetchBaseline(defaultConfig);

      expect(result.samplesUsed).toBe(8);
      expect(result.runs).toHaveLength(8);
    });

    it("filters out failed runs when requireSuccess is true", async () => {
      const runs = [
        makeRun(1, { conclusion: "success" }),
        makeRun(2, { conclusion: "failure" }),
        makeRun(3, { conclusion: "success" }),
        makeRun(4, { conclusion: "cancelled" }),
      ];

      server.use(
        http.get(
          `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_ID}/runs`,
          () => HttpResponse.json({ total_count: runs.length, workflow_runs: runs }),
        ),
        http.get(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/:runId/jobs`, () =>
          HttpResponse.json(makeJobs(1)),
        ),
      );

      const engine = createEngine();
      const result = await engine.fetchBaseline(defaultConfig);

      expect(result.samplesUsed).toBe(2);
      expect(result.runs.every((r) => r.run.conclusion === "success")).toBe(true);
    });

    it("returns low confidence with no samples", async () => {
      server.use(
        http.get(
          `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_ID}/runs`,
          () => HttpResponse.json({ total_count: 0, workflow_runs: [] }),
        ),
      );

      const engine = createEngine();
      const result = await engine.fetchBaseline(defaultConfig);

      expect(result.samplesUsed).toBe(0);
      expect(result.confidence).toBe("low");
      expect(result.confidenceReasons).toContain("No baseline samples available");
    });

    it("returns low confidence when samples < minSamples", async () => {
      const runs = [makeRun(1), makeRun(2)];

      server.use(
        http.get(
          `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_ID}/runs`,
          () => HttpResponse.json({ total_count: 2, workflow_runs: runs }),
        ),
        http.get(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/:runId/jobs`, () =>
          HttpResponse.json(makeJobs(1)),
        ),
      );

      const engine = createEngine();
      const result = await engine.fetchBaseline({ ...defaultConfig, minSamples: 5 });

      expect(result.samplesUsed).toBe(2);
      expect(result.confidence).toBe("low");
    });

    it("returns high confidence with enough stable samples", async () => {
      const runs = Array.from({ length: 10 }, (_, i) => makeRun(i + 1));

      server.use(
        http.get(
          `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_ID}/runs`,
          () => HttpResponse.json({ total_count: runs.length, workflow_runs: runs }),
        ),
        http.get(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/:runId/jobs`, () =>
          HttpResponse.json(makeJobs(1)),
        ),
      );

      const engine = createEngine();
      const result = await engine.fetchBaseline(defaultConfig);

      expect(result.samplesUsed).toBe(10);
      expect(result.confidence).toBe("high");
    });

    it("excludes configured run ids from baseline samples", async () => {
      const runs = [makeRun(101), makeRun(102), makeRun(103)];

      server.use(
        http.get(
          `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_ID}/runs`,
          () => HttpResponse.json({ total_count: runs.length, workflow_runs: runs }),
        ),
        http.get(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/:runId/jobs`, () =>
          HttpResponse.json(makeJobs(1)),
        ),
      );

      const engine = createEngine();
      const result = await engine.fetchBaseline({
        ...defaultConfig,
        excludeRunIds: [102],
      });

      expect(result.samplesUsed).toBe(2);
      expect(result.runs.map((r) => r.run.id)).toEqual([101, 103]);
    });
  });

  describe("computeDurationBaseline", () => {
    it("returns undefined for empty baseline", async () => {
      server.use(
        http.get(
          `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_ID}/runs`,
          () => HttpResponse.json({ total_count: 0, workflow_runs: [] }),
        ),
      );

      const engine = createEngine();
      const result = await engine.fetchBaseline(defaultConfig);
      const baseline = engine.computeDurationBaseline(result);

      expect(baseline).toBeUndefined();
    });

    it("computes workflow and job duration medians", async () => {
      const runs = Array.from({ length: 5 }, (_, i) => makeRun(i + 1));

      server.use(
        http.get(
          `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_ID}/runs`,
          () => HttpResponse.json({ total_count: runs.length, workflow_runs: runs }),
        ),
        http.get(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/:runId/jobs`, () =>
          HttpResponse.json(makeJobs(1, 3)),
        ),
      );

      const engine = createEngine();
      const result = await engine.fetchBaseline(defaultConfig);
      const baseline = engine.computeDurationBaseline(result);

      expect(baseline).toBeDefined();
      expect(baseline?.medianMs).toBeGreaterThan(0);
      expect(baseline?.jobs.length).toBe(2);

      const testJob = baseline?.jobs.find((j) => j.name === "test");
      expect(testJob?.medianMs).toBe(3 * 60 * 1000);

      const buildJob = baseline?.jobs.find((j) => j.name === "build");
      expect(buildJob?.medianMs).toBe(2 * 60 * 1000);
    });

    it("sorts jobs by duration descending", async () => {
      const runs = Array.from({ length: 3 }, (_, i) => makeRun(i + 1));

      server.use(
        http.get(
          `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_ID}/runs`,
          () => HttpResponse.json({ total_count: runs.length, workflow_runs: runs }),
        ),
        http.get(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/:runId/jobs`, () =>
          HttpResponse.json(makeJobs(1, 5)),
        ),
      );

      const engine = createEngine();
      const result = await engine.fetchBaseline(defaultConfig);
      const baseline = engine.computeDurationBaseline(result);

      expect(baseline?.jobs[0]?.name).toBe("test");
      expect(baseline?.jobs[1]?.name).toBe("build");
    });
  });
});
