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
  return {
    id,
    workflow_id: 12345,
    status: "completed",
    conclusion: "success",
    event: "push",
    head_branch: "main",
    created_at: recentDate(id),
    updated_at: recentDate(id),
    run_started_at: recentDate(id),
  };
}

function makeCacheJob(runId: number, hit = true, restoreMs = 500) {
  const start = "2026-02-01T00:00:00Z";
  const stepEnd = new Date(new Date(start).getTime() + restoreMs).toISOString();
  return {
    id: runId * 100,
    run_id: runId,
    name: "build",
    status: "completed",
    conclusion: "success",
    started_at: start,
    completed_at: "2026-02-01T00:10:00Z",
    steps: [
      {
        name: "[cache-step] group=deps",
        number: 1,
        status: "completed",
        conclusion: "success",
        started_at: start,
        completed_at: stepEnd,
      },
      {
        name: `[cache] group=deps hit=${hit} key_fp=abc123 key_hint=pnpm`,
        number: 2,
        status: "completed",
        conclusion: "success",
        started_at: stepEnd,
        completed_at: stepEnd,
      },
    ],
  };
}

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  tmpDir = mkdtempSync(join(tmpdir(), "gate-test-"));
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
    GITHUB_REF_NAME: "main",
    GITHUB_BASE_REF: "",
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
    "GITHUB_REF_NAME",
    "GITHUB_BASE_REF",
  ]) {
    Reflect.deleteProperty(process.env, key);
  }
}

function fiveBaselineRuns() {
  return [1, 2, 3, 4, 5].map(makeWorkflowRun);
}

describe("cache-health-gate runtime integration", () => {
  beforeEach(() => {
    setEnv();
    setInputs({
      token: "test-token",
      mode: "warn",
      baseline_runs: "10",
      baseline_window_days: "14",
      baseline_event_filter: "push",
      no_baseline_behavior: "warn",
      api_budget_calls: "30",
    });
  });

  it("happy path: healthy cache → pass with correct outputs", async () => {
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
          jobs: [makeCacheJob(runId, true, 500)],
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

  it("cache regression → warn (mode=warn), process does NOT fail", async () => {
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
            jobs: [makeCacheJob(runId, false, 500)],
          });
        }
        return HttpResponse.json({
          total_count: 1,
          jobs: [makeCacheJob(runId, true, 500)],
        });
      }),
    );

    const { run } = await import("../main.js");
    await run();

    const outputs = parseOutputFile();
    expect(outputs["result"]).toBe("warn");
    expect(JSON.parse(outputs["reason_codes"] ?? "[]")).toContain("WARN_HIT_RATE_DROP");
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
    expect(outputs["baseline_samples"]).toBe("0");
    expect(process.exitCode).toBeUndefined();
  });

  it("excludes current run from baseline (no self-baselining)", async () => {
    server.use(
      http.get(`${BASE_URL}/actions/workflows/${WORKFLOW_FILE}/runs`, () =>
        HttpResponse.json({
          total_count: 1,
          workflow_runs: [makeWorkflowRun(RUN_ID)],
        }),
      ),
      http.get(`${BASE_URL}/actions/runs/:runId/jobs`, ({ params }) => {
        const runId = Number(params["runId"]);
        return HttpResponse.json({
          total_count: 1,
          jobs: [makeCacheJob(runId, true, 500)],
        });
      }),
    );

    const { run } = await import("../main.js");
    await run();

    const outputs = parseOutputFile();
    expect(outputs["result"]).toBe("warn");
    expect(outputs["confidence"]).toBe("low");
    expect(outputs["baseline_samples"]).toBe("0");
    expect(JSON.parse(outputs["reason_codes"] ?? "[]")).toContain("WARN_NO_BASELINE");
  });

  it("thin cache baseline downgrades confidence and explains summary", async () => {
    server.use(
      http.get(`${BASE_URL}/actions/workflows/${WORKFLOW_FILE}/runs`, () =>
        HttpResponse.json({
          total_count: 5,
          workflow_runs: fiveBaselineRuns(),
        }),
      ),
      http.get(`${BASE_URL}/actions/runs/:runId/jobs`, ({ params }) => {
        const runId = Number(params["runId"]);
        if (runId === RUN_ID || runId === 1) {
          return HttpResponse.json({
            total_count: 1,
            jobs: [makeCacheJob(runId, true, 500)],
          });
        }
        return HttpResponse.json({
          total_count: 1,
          jobs: [
            {
              id: runId * 100,
              run_id: runId,
              name: "build",
              status: "completed",
              conclusion: "success",
              started_at: "2026-02-01T00:00:00Z",
              completed_at: "2026-02-01T00:10:00Z",
              steps: [
                {
                  name: "Install",
                  number: 1,
                  status: "completed",
                  conclusion: "success",
                  started_at: "2026-02-01T00:00:00Z",
                  completed_at: "2026-02-01T00:00:10Z",
                },
              ],
            },
          ],
        });
      }),
    );

    const { run } = await import("../main.js");
    await run();

    const outputs = parseOutputFile();
    expect(outputs["result"]).toBe("warn");
    expect(outputs["confidence"]).toBe("low");
    expect(JSON.parse(outputs["reason_codes"] ?? "[]")).toContain("WARN_LOW_CONFIDENCE");

    const summary = readFileSync(summaryFile, "utf-8");
    expect(summary).toContain("Cache baseline coverage is thin");
    expect(summary).toContain("Confidence was downgraded");
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

  it("push event uses GITHUB_REF_NAME for baseline branch", async () => {
    setEnv({ GITHUB_EVENT_NAME: "push", GITHUB_REF_NAME: "master", GITHUB_BASE_REF: "" });

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

    expect(capturedBranch).toBe("master");
  });

  it("pull_request event prefers GITHUB_BASE_REF for baseline branch", async () => {
    setEnv({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REF_NAME: "feature-x",
      GITHUB_BASE_REF: "main",
    });

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

  it("resolves workflow ID from GITHUB_WORKFLOW_REF", async () => {
    let capturedPath: string | undefined;
    server.use(
      http.get(`${BASE_URL}/actions/workflows/:workflowId/runs`, ({ params }) => {
        capturedPath = params["workflowId"] as string;
        return HttpResponse.json({ total_count: 0, workflow_runs: [] });
      }),
      http.get(`${BASE_URL}/actions/runs/:runId/jobs`, () =>
        HttpResponse.json({ total_count: 0, jobs: [] }),
      ),
    );

    const { run } = await import("../main.js");
    await run();

    expect(capturedPath).toBe(WORKFLOW_FILE);
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
          jobs: [makeCacheJob(runId, true, 500)],
        });
      }),
    );

    const { run } = await import("../main.js");
    await run();

    const summary = readFileSync(summaryFile, "utf-8");
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).toContain("Cache Health Gate");
  });
});
