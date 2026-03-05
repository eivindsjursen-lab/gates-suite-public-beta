import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const OWNER = "test-org";
const REPO = "test-repo";
const WORKFLOW_FILE = "ci.yml";
const RUN_ID = 9001;
const BASE_URL = `https://api.github.com/repos/${OWNER}/${REPO}`;

let tmpDir: string;
let outputFile: string;
let summaryFile: string;

function parseOutputFile(): Record<string, string> {
  const content = readFileSync(outputFile, "utf-8");
  const outputs: Record<string, string> = {};
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }
    const delimMatch = line.match(/^(.+?)<<(.+)$/);
    if (delimMatch) {
      const key = delimMatch[1] ?? "";
      const delim = delimMatch[2] ?? "";
      const valueLines: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== delim) {
        const valueLine = lines[i];
        if (valueLine !== undefined) valueLines.push(valueLine);
        i++;
      }
      outputs[key] = valueLines.join("\n");
    }
    i++;
  }
  return outputs;
}

function recentDate(daysAgo: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function makeWorkflowRun(id: number) {
  const created = recentDate(id);
  const ended = new Date(new Date(created).getTime() + 5 * 60_000).toISOString();
  return {
    id,
    workflow_id: 12345,
    status: "completed",
    conclusion: "success",
    event: "push",
    head_branch: "main",
    created_at: created,
    updated_at: ended,
    run_started_at: created,
  };
}

function makeJob(runId: number, name: string, durationMs: number) {
  const start = recentDate(1);
  const end = new Date(new Date(start).getTime() + durationMs).toISOString();
  return {
    id: runId * 100 + 1,
    run_id: runId,
    name,
    status: "completed",
    conclusion: "success",
    started_at: start,
    completed_at: end,
    steps: [
      {
        name: "Run tests",
        number: 1,
        status: "completed",
        conclusion: "success",
        started_at: start,
        completed_at: end,
      },
    ],
  };
}

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  tmpDir = mkdtempSync(join(tmpdir(), "minutes-test-"));
  outputFile = join(tmpDir, "output");
  summaryFile = join(tmpDir, "summary");
  process.env["GITHUB_OUTPUT"] = outputFile;
  process.env["GITHUB_STEP_SUMMARY"] = summaryFile;
});

beforeEach(() => {
  writeFileSync(outputFile, "");
  writeFileSync(summaryFile, "");
});

afterEach(() => {
  server.resetHandlers();
  process.exitCode = undefined;
  cleanEnv();
  cleanInputs();
});

afterAll(() => {
  server.close();
  delete process.env["GITHUB_OUTPUT"];
  delete process.env["GITHUB_STEP_SUMMARY"];
  rmSync(tmpDir, { recursive: true, force: true });
});

function setEnv(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    GITHUB_REPOSITORY: `${OWNER}/${REPO}`,
    GITHUB_WORKFLOW_REF: `${OWNER}/${REPO}/.github/workflows/${WORKFLOW_FILE}@refs/heads/main`,
    GITHUB_WORKFLOW: "CI",
    GITHUB_RUN_ID: String(RUN_ID),
    GITHUB_EVENT_NAME: "push",
    GITHUB_BASE_REF: "",
    GITHUB_RUN_CREATED_AT: recentDate(0),
    GITHUB_RUN_STARTED_AT: recentDate(0),
  };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) {
    process.env[k] = v;
  }
}

function setInputs(inputs: Record<string, string>) {
  for (const [k, v] of Object.entries(inputs)) {
    process.env[`INPUT_${k.toUpperCase()}`] = v;
  }
}

function cleanInputs() {
  const inputKeys = Object.keys(process.env).filter((k) => k.startsWith("INPUT_"));
  for (const key of inputKeys) {
    Reflect.deleteProperty(process.env, key);
  }
}

function cleanEnv() {
  for (const key of [
    "GITHUB_REPOSITORY",
    "GITHUB_WORKFLOW_REF",
    "GITHUB_WORKFLOW",
    "GITHUB_RUN_ID",
    "GITHUB_EVENT_NAME",
    "GITHUB_BASE_REF",
    "GITHUB_HEAD_REF",
    "GITHUB_RUN_CREATED_AT",
    "GITHUB_RUN_STARTED_AT",
  ]) {
    Reflect.deleteProperty(process.env, key);
  }
}

function fiveBaselineRuns() {
  return [1, 2, 3, 4, 5].map(makeWorkflowRun);
}

describe("ci-minutes-gate runtime integration", () => {
  beforeEach(() => {
    setEnv();
    setInputs({
      token: "test-token",
      mode: "warn",
      baseline_runs: "10",
      baseline_window_days: "14",
      baseline_event_filter: "push",
      no_baseline_behavior: "warn",
      thresholds_total_regression_pct: "15",
      api_budget_calls: "30",
    });
  });

  it("happy path: stable duration → pass with correct outputs", async () => {
    server.use(
      http.get(`${BASE_URL}/actions/workflows/${WORKFLOW_FILE}/runs`, () =>
        HttpResponse.json({
          total_count: 5,
          workflow_runs: fiveBaselineRuns(),
        }),
      ),
      http.get(`${BASE_URL}/actions/runs/:runId/jobs`, ({ params }) => {
        const runId = Number(params["runId"]);
        return HttpResponse.json({
          total_count: 1,
          jobs: [makeJob(runId, "build", 5 * 60_000)],
        });
      }),
    );

    const { run } = await import("../main.js");
    await run();

    const outputs = parseOutputFile();
    expect(outputs["result"]).toBe("pass");
    expect(outputs["confidence"]).toBeDefined();
    expect(outputs["baseline_samples"]).toBe("5");
    expect(JSON.parse(outputs["reason_codes"] ?? "[]")).toContain("PASS_ALL_CLEAR");
    expect(process.exitCode).toBeUndefined();
  });

  it("duration regression → warn (mode=warn), process does NOT fail", async () => {
    server.use(
      http.get(`${BASE_URL}/actions/workflows/${WORKFLOW_FILE}/runs`, () =>
        HttpResponse.json({
          total_count: 5,
          workflow_runs: fiveBaselineRuns(),
        }),
      ),
      http.get(`${BASE_URL}/actions/runs/:runId/jobs`, ({ params }) => {
        const runId = Number(params["runId"]);
        if (runId === RUN_ID) {
          return HttpResponse.json({
            total_count: 1,
            jobs: [makeJob(runId, "build", 15 * 60_000)],
          });
        }
        return HttpResponse.json({
          total_count: 1,
          jobs: [makeJob(runId, "build", 5 * 60_000)],
        });
      }),
    );

    const { run } = await import("../main.js");
    await run();

    const outputs = parseOutputFile();
    expect(outputs["result"]).toBe("warn");
    expect(JSON.parse(outputs["reason_codes"] ?? "[]")).toContain("WARN_DURATION_INCREASE");
    expect(process.exitCode).toBeUndefined();
  });

  it("no baseline + skip behavior → SKIP_NO_BASELINE", async () => {
    setInputs({
      token: "test-token",
      no_baseline_behavior: "skip",
      api_budget_calls: "30",
    });

    server.use(
      http.get(`${BASE_URL}/actions/workflows/${WORKFLOW_FILE}/runs`, () =>
        HttpResponse.json({ total_count: 0, workflow_runs: [] }),
      ),
    );

    const { run } = await import("../main.js");
    await run();

    const outputs = parseOutputFile();
    expect(outputs["result"]).toBe("skipped");
    expect(JSON.parse(outputs["reason_codes"] ?? "[]")).toContain("SKIP_NO_BASELINE");
    expect(process.exitCode).toBeUndefined();
  });

  it("API 403 → graceful degrade to SKIP_PERMISSION_DENIED", async () => {
    server.use(
      http.get(`${BASE_URL}/actions/workflows/${WORKFLOW_FILE}/runs`, () =>
        HttpResponse.json({ message: "Resource not accessible by integration" }, { status: 403 }),
      ),
    );

    const { run } = await import("../main.js");
    await run();

    const outputs = parseOutputFile();
    expect(outputs["result"]).toBe("skipped");
    expect(JSON.parse(outputs["reason_codes"] ?? "[]")).toContain("SKIP_PERMISSION_DENIED");
  }, 15_000);

  it("API 429 → graceful degrade to SKIP_RATE_LIMITED", async () => {
    server.use(
      http.get(
        `${BASE_URL}/actions/workflows/${WORKFLOW_FILE}/runs`,
        () => new HttpResponse(null, { status: 429 }),
      ),
    );

    const { run } = await import("../main.js");
    await run();

    const outputs = parseOutputFile();
    expect(outputs["result"]).toBe("skipped");
    expect(JSON.parse(outputs["reason_codes"] ?? "[]")).toContain("SKIP_RATE_LIMITED");
  }, 15_000);

  it("GITHUB_BASE_REF empty string falls back to 'main'", async () => {
    setEnv({ GITHUB_BASE_REF: "" });

    let capturedBranch: string | undefined;
    server.use(
      http.get(`${BASE_URL}/actions/workflows/${WORKFLOW_FILE}/runs`, ({ request }) => {
        const url = new URL(request.url);
        capturedBranch = url.searchParams.get("branch") ?? undefined;
        return HttpResponse.json({ total_count: 0, workflow_runs: [] });
      }),
      http.get(`${BASE_URL}/actions/runs/:runId/jobs`, () =>
        HttpResponse.json({ total_count: 0, jobs: [] }),
      ),
    );

    const { run } = await import("../main.js");
    await run();

    expect(capturedBranch).toBe("main");
  });

  it("Job Summary is always written", async () => {
    server.use(
      http.get(`${BASE_URL}/actions/workflows/${WORKFLOW_FILE}/runs`, () =>
        HttpResponse.json({
          total_count: 5,
          workflow_runs: fiveBaselineRuns(),
        }),
      ),
      http.get(`${BASE_URL}/actions/runs/:runId/jobs`, ({ params }) => {
        const runId = Number(params["runId"]);
        return HttpResponse.json({
          total_count: 1,
          jobs: [makeJob(runId, "build", 5 * 60_000)],
        });
      }),
    );

    const { run } = await import("../main.js");
    await run();

    const summary = readFileSync(summaryFile, "utf-8");
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).toContain("CI Minutes Delta Gate");
  });
});
