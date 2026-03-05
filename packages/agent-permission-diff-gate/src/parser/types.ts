/**
 * Capability taxonomy for agent/tool permissions.
 * Ordered by risk level (ascending).
 */
export type Capability =
  | "read.repo"
  | "read.issues"
  | "read.pulls"
  | "read.packages"
  | "write.issues"
  | "write.pulls"
  | "write.packages"
  | "write.repo"
  | "write.actions"
  | "secrets.read"
  | "secrets.write"
  | "egress.http"
  | "egress.ssh"
  | "exec.shell"
  | "exec.docker";

/**
 * Risk classification for a capability.
 */
export type RiskLevel = "low" | "medium" | "high" | "critical";

/**
 * A single permission entry extracted from config.
 */
export interface PermissionEntry {
  capability: Capability;
  source: string;
  sourceType: "explicit" | "heuristic";
  tool: string;
  raw: string;
}

/**
 * Complete permission snapshot for a config file.
 */
export interface PermissionSnapshot {
  filePath: string;
  entries: PermissionEntry[];
  tools: ToolDeclaration[];
  parseWarning?: "unrecognized_format" | "parse_error" | undefined;
}

/**
 * A tool/server declaration found in config.
 */
export interface ToolDeclaration {
  name: string;
  type: "mcp-server" | "action" | "agent-tool" | "unknown";
  capabilities: Capability[];
  source: string;
}

/**
 * Allowlist entry for pre-approved capabilities.
 */
export interface AllowlistEntry {
  tool: string;
  capabilities: Capability[];
}

/**
 * Mapping from known actions/tools to their implied capabilities.
 */
export const CAPABILITY_RISK_MAP: Record<Capability, RiskLevel> = {
  "read.repo": "low",
  "read.issues": "low",
  "read.pulls": "low",
  "read.packages": "low",
  "write.issues": "medium",
  "write.pulls": "medium",
  "write.packages": "medium",
  "write.repo": "high",
  "write.actions": "high",
  "secrets.read": "high",
  "secrets.write": "critical",
  "egress.http": "high",
  "egress.ssh": "critical",
  "exec.shell": "critical",
  "exec.docker": "critical",
};

/**
 * All known capabilities in risk order (lowest first).
 */
export const ALL_CAPABILITIES: readonly Capability[] = [
  "read.repo",
  "read.issues",
  "read.pulls",
  "read.packages",
  "write.issues",
  "write.pulls",
  "write.packages",
  "write.repo",
  "write.actions",
  "secrets.read",
  "secrets.write",
  "egress.http",
  "egress.ssh",
  "exec.shell",
  "exec.docker",
];
