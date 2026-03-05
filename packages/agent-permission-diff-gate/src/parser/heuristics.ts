import type { Capability } from "./types.js";

/**
 * Known action/tool patterns mapped to their implied capabilities.
 * Used when explicit permission declarations are absent.
 */
const HEURISTIC_MAP: [RegExp, Capability[]][] = [
  // GitHub Actions — common
  [/^actions\/checkout@/, ["read.repo"]],
  [/^actions\/cache@/, ["read.repo"]],
  [/^actions\/upload-artifact@/, ["write.repo"]],
  [/^actions\/download-artifact@/, ["read.repo"]],
  [/^actions\/github-script@/, ["read.repo", "write.issues", "write.pulls"]],
  [/^actions\/create-release@/, ["write.repo"]],

  // Package publishing
  [/^actions\/setup-node@/, ["read.repo"]],
  [/publish/i, ["write.packages", "egress.http"]],

  // Docker
  [/docker\/build-push-action@/, ["exec.docker", "write.packages", "egress.http"]],
  [/docker\/login-action@/, ["secrets.read", "egress.http"]],

  // Deployment / external
  [/aws-actions\//, ["egress.http", "secrets.read"]],
  [/azure\//, ["egress.http", "secrets.read"]],
  [/google-github-actions\//, ["egress.http", "secrets.read"]],
  [/hashicorp\//, ["egress.http", "secrets.read"]],

  // PR comment/review bots
  [/peter-evans\/create-pull-request@/, ["write.pulls", "write.repo"]],
  [/peter-evans\/create-or-update-comment@/, ["write.issues"]],
  [/marocchino\/sticky-pull-request-comment@/, ["write.pulls"]],

  // Release tools
  [/softprops\/action-gh-release@/, ["write.repo"]],
  [/changesets\/action@/, ["write.repo", "write.pulls", "write.packages"]],

  // SSH / shell execution
  [/ssh/i, ["egress.ssh"]],
  [/appleboy\/ssh-action@/, ["egress.ssh", "exec.shell"]],
];

/**
 * MCP server type patterns.
 */
const MCP_SERVER_PATTERNS: [RegExp, Capability[]][] = [
  [/file[-_]?system/i, ["read.repo", "write.repo"]],
  [/browser/i, ["egress.http", "exec.shell"]],
  [/database|postgres|mysql|mongo/i, ["egress.http", "secrets.read"]],
  [/slack|discord|teams/i, ["egress.http"]],
  [/git\b/i, ["read.repo", "write.repo"]],
  [/terminal|shell|exec/i, ["exec.shell"]],
  [/docker/i, ["exec.docker"]],
  [/secret|vault|key/i, ["secrets.read"]],
];

/**
 * Infer capabilities from a tool/action name using heuristic patterns.
 * Returns empty array if no pattern matches.
 */
export function inferCapabilities(
  toolName: string,
  type: "action" | "mcp-server" | "agent-tool" | "unknown" = "unknown",
): Capability[] {
  const capabilities = new Set<Capability>();

  const patternSets =
    type === "mcp-server"
      ? [MCP_SERVER_PATTERNS]
      : type === "action"
        ? [HEURISTIC_MAP]
        : [HEURISTIC_MAP, MCP_SERVER_PATTERNS];

  for (const patterns of patternSets) {
    for (const [pattern, caps] of patterns) {
      if (pattern.test(toolName)) {
        for (const cap of caps) {
          capabilities.add(cap);
        }
      }
    }
  }

  return [...capabilities];
}

/**
 * Check if a tool name matches any known heuristic pattern.
 */
export function isKnownTool(toolName: string): boolean {
  for (const [pattern] of HEURISTIC_MAP) {
    if (pattern.test(toolName)) return true;
  }
  for (const [pattern] of MCP_SERVER_PATTERNS) {
    if (pattern.test(toolName)) return true;
  }
  return false;
}
