import { describe, it, expect } from "vitest";
import { parseConfigFile, parseAllowlist } from "../parser/config-parser.js";
import { inferCapabilities, isKnownTool } from "../parser/heuristics.js";

describe("parseConfigFile — workflow files", () => {
  it("extracts explicit top-level permissions", () => {
    const yaml = `
on: push
permissions:
  contents: read
  issues: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;
    const snapshot = parseConfigFile(".github/workflows/ci.yml", yaml);
    const explicitEntries = snapshot.entries.filter((e) => e.sourceType === "explicit");
    expect(explicitEntries.length).toBeGreaterThanOrEqual(2);

    const caps = explicitEntries.map((e) => e.capability);
    expect(caps).toContain("read.repo");
    expect(caps).toContain("write.issues");
  });

  it("extracts per-job permissions", () => {
    const yaml = `
on: push
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      packages: write
    steps:
      - uses: actions/checkout@v4
`;
    const snapshot = parseConfigFile(".github/workflows/deploy.yml", yaml);
    const jobEntries = snapshot.entries.filter(
      (e) => e.sourceType === "explicit" && e.tool === "job:deploy",
    );
    const caps = jobEntries.map((e) => e.capability);
    expect(caps).toContain("write.repo");
    expect(caps).toContain("write.packages");
  });

  it("infers heuristic capabilities from action uses", () => {
    const yaml = `
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/build-push-action@v5
      - uses: softprops/action-gh-release@v2
`;
    const snapshot = parseConfigFile(".github/workflows/ci.yml", yaml);

    const tools = snapshot.tools;
    expect(tools).toHaveLength(3);
    expect(tools.find((t) => t.name.includes("checkout"))?.capabilities).toContain("read.repo");
    expect(tools.find((t) => t.name.includes("docker"))?.capabilities).toContain("exec.docker");
    expect(tools.find((t) => t.name.includes("softprops"))?.capabilities).toContain("write.repo");
  });

  it("handles empty workflow gracefully", () => {
    const snapshot = parseConfigFile("empty.yml", "");
    expect(snapshot.entries).toHaveLength(0);
    expect(snapshot.tools).toHaveLength(0);
  });

  it("handles invalid YAML gracefully", () => {
    const snapshot = parseConfigFile("bad.yml", "{ invalid yaml: [");
    expect(snapshot.entries).toHaveLength(0);
  });
});

describe("parseConfigFile — MCP config files", () => {
  it("extracts explicit MCP server permissions", () => {
    const yaml = `
mcpServers:
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem"]
    permissions:
      - read.repo
      - write.repo
  browser:
    command: npx
    args: ["-y", "@anthropic/browser-mcp"]
`;
    const snapshot = parseConfigFile(".github/mcp.yml", yaml);

    const fsEntries = snapshot.entries.filter((e) => e.tool === "filesystem");
    expect(fsEntries.some((e) => e.sourceType === "explicit")).toBe(true);
    expect(fsEntries.map((e) => e.capability)).toContain("write.repo");

    const browserTool = snapshot.tools.find((t) => t.name === "browser");
    expect(browserTool?.type).toBe("mcp-server");
    expect(browserTool?.capabilities).toContain("egress.http");
  });

  it("handles mcp_servers key variant", () => {
    const yaml = `
mcp_servers:
  git-tool:
    command: git-mcp
`;
    const snapshot = parseConfigFile(".github/mcp.yml", yaml);
    expect(snapshot.tools).toHaveLength(1);
    expect(snapshot.tools[0]?.name).toBe("git-tool");
  });
});

describe("parseConfigFile — agent config files", () => {
  it("extracts explicit agent tool permissions", () => {
    const yaml = `
tools:
  - name: file-editor
    permissions:
      - read.repo
      - write.repo
  - name: api-client
    permissions:
      - egress.http
`;
    const snapshot = parseConfigFile(".github/agent.yml", yaml);
    expect(snapshot.tools).toHaveLength(2);

    const fileEditor = snapshot.tools.find((t) => t.name === "file-editor");
    expect(fileEditor?.capabilities).toContain("write.repo");

    const apiEntries = snapshot.entries.filter((e) => e.tool === "api-client");
    expect(apiEntries.map((e) => e.capability)).toContain("egress.http");
  });

  it("infers capabilities for tools without explicit permissions", () => {
    const yaml = `
tools:
  - name: docker-runner
`;
    const snapshot = parseConfigFile(".github/agent.yml", yaml);
    const tool = snapshot.tools[0];
    expect(tool?.capabilities).toContain("exec.docker");
  });
});

describe("parseAllowlist", () => {
  it("parses allowlist entries", () => {
    const yaml = `
- tool: actions/checkout@v4
  capabilities:
    - read.repo
- tool: docker/build-push-action@v5
  capabilities:
    - exec.docker
    - write.packages
`;
    const entries = parseAllowlist(yaml);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.tool).toBe("actions/checkout@v4");
    expect(entries[0]?.capabilities).toContain("read.repo");
    expect(entries[1]?.capabilities).toContain("exec.docker");
  });

  it("filters invalid capabilities", () => {
    const yaml = `
- tool: test
  capabilities:
    - read.repo
    - not.a.real.cap
`;
    const entries = parseAllowlist(yaml);
    expect(entries[0]?.capabilities).toEqual(["read.repo"]);
  });

  it("handles empty/invalid input", () => {
    expect(parseAllowlist("")).toEqual([]);
    expect(parseAllowlist("not-an-array")).toEqual([]);
  });
});

describe("inferCapabilities", () => {
  it("maps actions/checkout to read.repo", () => {
    expect(inferCapabilities("actions/checkout@v4", "action")).toContain("read.repo");
  });

  it("maps docker/build-push-action to exec.docker", () => {
    const caps = inferCapabilities("docker/build-push-action@v5", "action");
    expect(caps).toContain("exec.docker");
    expect(caps).toContain("write.packages");
  });

  it("maps aws-actions/* to egress + secrets", () => {
    const caps = inferCapabilities("aws-actions/configure-aws-credentials@v4", "action");
    expect(caps).toContain("egress.http");
    expect(caps).toContain("secrets.read");
  });

  it("maps MCP filesystem server", () => {
    const caps = inferCapabilities("filesystem", "mcp-server");
    expect(caps).toContain("read.repo");
    expect(caps).toContain("write.repo");
  });

  it("maps MCP browser server", () => {
    const caps = inferCapabilities("browser-use", "mcp-server");
    expect(caps).toContain("egress.http");
  });

  it("returns empty for unknown tools", () => {
    expect(inferCapabilities("my-custom-step", "action")).toEqual([]);
  });
});

describe("isKnownTool", () => {
  it("recognizes known actions", () => {
    expect(isKnownTool("actions/checkout@v4")).toBe(true);
    expect(isKnownTool("docker/build-push-action@v5")).toBe(true);
  });

  it("recognizes MCP server patterns", () => {
    expect(isKnownTool("filesystem")).toBe(true);
    expect(isKnownTool("browser-use")).toBe(true);
  });

  it("returns false for unknown", () => {
    expect(isKnownTool("totally-unknown-tool")).toBe(false);
  });
});
