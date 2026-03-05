import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const OWNER = "test-org";
const REPO = "test-repo";
const BASE_SHA = "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111";
const HEAD_SHA = "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222";
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

function b64(s: string) {
  return Buffer.from(s).toString("base64");
}

const MCP_CONFIG_BASE = `mcpServers:
  filesystem:
    command: npx
    args: ["-y", "@anthropic/mcp-fs"]
`;

const MCP_CONFIG_HEAD = `mcpServers:
  filesystem:
    command: npx
    args: ["-y", "@anthropic/mcp-fs"]
  browser:
    command: npx
    args: ["-y", "@anthropic/mcp-browser"]
`;

function fileContentResponse(content: string) {
  return HttpResponse.json({
    type: "file",
    encoding: "base64",
    size: content.length,
    name: "mcp.yml",
    path: ".github/mcp.yml",
    content: b64(content),
    sha: "abc123",
  });
}

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  tmpDir = mkdtempSync(join(tmpdir(), "perms-test-"));
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
    GITHUB_EVENT_NAME: "push",
    GITHUB_BASE_SHA: BASE_SHA,
    GITHUB_SHA: HEAD_SHA,
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
    "GITHUB_EVENT_NAME",
    "GITHUB_BASE_SHA",
    "GITHUB_SHA",
    "GITHUB_EVENT_BEFORE",
    "PR_NUMBER",
  ]) {
    Reflect.deleteProperty(process.env, key);
  }
}

describe("agent-permission-diff-gate runtime integration", () => {
  beforeEach(() => {
    setEnv();
    setInputs({
      token: "test-token",
      mode: "warn",
      policy_level: "standard",
      approval_label: "agent-scope-approved",
      config_paths: JSON.stringify([".github/mcp*.yml", ".github/agent*.yml"]),
    });
  });

  it("no config changes → PASS_NO_SCOPE_CHANGE with findings_count=0", async () => {
    server.use(
      http.get(`${BASE_URL}/compare/${BASE_SHA}...${HEAD_SHA}`, () =>
        HttpResponse.json({
          files: [
            { filename: "src/index.ts", status: "modified" },
            { filename: "README.md", status: "modified" },
          ],
        }),
      ),
    );

    const { run } = await import("../main.js");
    await run();

    const outputs = parseOutputFile();
    expect(outputs["result"]).toBe("pass");
    expect(JSON.parse(outputs["reason_codes"] ?? "[]")).toContain("PASS_NO_SCOPE_CHANGE");
    expect(outputs["findings_count"]).toBe("0");
    expect(process.exitCode).toBeUndefined();
  });

  it("new MCP server added → warn with findings", async () => {
    server.use(
      http.get(`${BASE_URL}/compare/${BASE_SHA}...${HEAD_SHA}`, () =>
        HttpResponse.json({
          files: [{ filename: ".github/mcp.yml", status: "modified" }],
        }),
      ),
      http.get(`${BASE_URL}/contents/:path+`, ({ request }) => {
        const url = new URL(request.url);
        const ref = url.searchParams.get("ref");
        const content = ref === BASE_SHA ? MCP_CONFIG_BASE : MCP_CONFIG_HEAD;
        return fileContentResponse(content);
      }),
    );

    const { run } = await import("../main.js");
    await run();

    const outputs = parseOutputFile();
    expect(outputs["result"]).toBe("warn");
    const codes = JSON.parse(outputs["reason_codes"] ?? "[]") as string[];
    expect(codes.some((c: string) => c.startsWith("WARN_"))).toBe(true);
    expect(parseInt(outputs["findings_count"] ?? "0")).toBeGreaterThan(0);
    expect(process.exitCode).toBeUndefined();
  });

  it("missing base/head SHA → SKIP_NO_BASELINE", async () => {
    setEnv({ GITHUB_BASE_SHA: "", GITHUB_SHA: "" });
    delete process.env["GITHUB_EVENT_BEFORE"];

    const { run } = await import("../main.js");
    await run();

    const outputs = parseOutputFile();
    expect(outputs["result"]).toBe("skipped");
    expect(JSON.parse(outputs["reason_codes"] ?? "[]")).toContain("SKIP_NO_BASELINE");
  });

  it("API 403 on compare → SKIP_PERMISSION_DENIED", async () => {
    server.use(
      http.get(`${BASE_URL}/compare/${BASE_SHA}...${HEAD_SHA}`, () =>
        HttpResponse.json({ message: "Resource not accessible by integration" }, { status: 403 }),
      ),
    );

    const { run } = await import("../main.js");
    await run();

    const outputs = parseOutputFile();
    expect(outputs["result"]).toBe("skipped");
    expect(JSON.parse(outputs["reason_codes"] ?? "[]")).toContain("SKIP_PERMISSION_DENIED");
  });

  it("API 429 on compare → SKIP_RATE_LIMITED", async () => {
    server.use(
      http.get(
        `${BASE_URL}/compare/${BASE_SHA}...${HEAD_SHA}`,
        () => new HttpResponse(null, { status: 429 }),
      ),
    );

    const { run } = await import("../main.js");
    await run();

    const outputs = parseOutputFile();
    expect(outputs["result"]).toBe("skipped");
    expect(JSON.parse(outputs["reason_codes"] ?? "[]")).toContain("SKIP_RATE_LIMITED");
  });

  it("findings_count output is always set", async () => {
    server.use(
      http.get(`${BASE_URL}/compare/${BASE_SHA}...${HEAD_SHA}`, () =>
        HttpResponse.json({
          files: [{ filename: "src/app.ts", status: "modified" }],
        }),
      ),
    );

    const { run } = await import("../main.js");
    await run();

    const outputs = parseOutputFile();
    expect(outputs["findings_count"]).toBeDefined();
  });

  it("Job Summary is always written", async () => {
    server.use(
      http.get(`${BASE_URL}/compare/${BASE_SHA}...${HEAD_SHA}`, () =>
        HttpResponse.json({
          files: [{ filename: "src/app.ts", status: "modified" }],
        }),
      ),
    );

    const { run } = await import("../main.js");
    await run();

    const summary = readFileSync(summaryFile, "utf-8");
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).toContain("Agent Permission Diff Gate");
  });
});
