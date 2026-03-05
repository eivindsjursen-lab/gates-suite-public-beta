import { describe, it, expect } from "vitest";
import { parseConfigFile, parseAllowlist } from "../parser/config-parser.js";
import { computeDiff } from "../diff/engine.js";
import { evaluatePermissionPolicy } from "../policy/evaluate.js";
import type { PermissionPolicyConfig } from "../policy/types.js";

const standardConfig: PermissionPolicyConfig = {
  mode: "fail",
  policyLevel: "standard",
  approvalLabel: "agent-scope-approved",
  hasApprovalLabel: false,
};

describe("end-to-end: full Permission Diff pipeline", () => {
  it("PASS — no changes between identical configs", () => {
    const yaml = `
on: push
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;
    const base = [parseConfigFile("ci.yml", yaml)];
    const head = [parseConfigFile("ci.yml", yaml)];
    const diff = computeDiff(base, head);
    const result = evaluatePermissionPolicy(diff, standardConfig);

    expect(result.verdict).toBe("pass");
    expect(result.reasonCodes).toContain("PASS_NO_SCOPE_CHANGE");
  });

  it("FAIL — new MCP server with critical capabilities", () => {
    const baseYaml = `
mcpServers:
  filesystem:
    command: fs-mcp
    permissions:
      - read.repo
`;
    const headYaml = `
mcpServers:
  filesystem:
    command: fs-mcp
    permissions:
      - read.repo
  terminal:
    command: terminal-mcp
`;
    const base = [parseConfigFile("mcp.yml", baseYaml)];
    const head = [parseConfigFile("mcp.yml", headYaml)];
    const diff = computeDiff(base, head);
    const result = evaluatePermissionPolicy(diff, standardConfig);

    expect(result.verdict).toBe("fail");
    expect(result.reasonCodes).toContain("FAIL_CAPABILITY_ESCALATION");
    expect(result.findings.some((f) => f.riskLevel === "critical")).toBe(true);
  });

  it("WARN — new low-risk action added", () => {
    const baseYaml = `
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;
    const headYaml = `
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/cache@v4
`;
    const base = [parseConfigFile("ci.yml", baseYaml)];
    const head = [parseConfigFile("ci.yml", headYaml)];
    const diff = computeDiff(base, head);
    const result = evaluatePermissionPolicy(diff, standardConfig);

    expect(result.verdict).toBe("warn");
    expect(result.reasonCodes).toContain("WARN_CAPABILITY_EXPANSION");
  });

  it("PASS — approved via label", () => {
    const headYaml = `
mcpServers:
  terminal:
    command: terminal-mcp
`;
    const base: ReturnType<typeof parseConfigFile>[] = [];
    const head = [parseConfigFile("mcp.yml", headYaml)];
    const diff = computeDiff(base, head);
    const result = evaluatePermissionPolicy(diff, {
      ...standardConfig,
      hasApprovalLabel: true,
    });

    expect(result.verdict).toBe("pass");
  });

  it("WARN — permission downgrade (tool removed)", () => {
    const baseYaml = `
on: push
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: softprops/action-gh-release@v2
`;
    const headYaml = `
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;
    const base = [parseConfigFile("ci.yml", baseYaml)];
    const head = [parseConfigFile("ci.yml", headYaml)];
    const diff = computeDiff(base, head);
    const result = evaluatePermissionPolicy(diff, standardConfig);

    expect(diff.removed.length).toBeGreaterThan(0);
    expect(["pass", "warn"]).toContain(result.verdict);
  });

  it("allowlist suppresses known-good expansions", () => {
    const baseYaml = `
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;
    const headYaml = `
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/build-push-action@v5
`;
    const base = [parseConfigFile("ci.yml", baseYaml)];
    const head = [parseConfigFile("ci.yml", headYaml)];

    const allowlist = parseAllowlist(`
- tool: docker/build-push-action@v5
  capabilities:
    - exec.docker
    - write.packages
    - egress.http
`);

    const diff = computeDiff(base, head, allowlist);
    const result = evaluatePermissionPolicy(diff, standardConfig);

    expect(result.verdict).toBe("pass");
  });
});
