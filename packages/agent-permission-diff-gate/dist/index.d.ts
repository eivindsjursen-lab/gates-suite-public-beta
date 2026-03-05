import { GateVerdict, ConfidenceLevel } from '@gates-suite/core';

declare function run(): Promise<void>;

/**
 * Capability taxonomy for agent/tool permissions.
 * Ordered by risk level (ascending).
 */
type Capability = "read.repo" | "read.issues" | "read.pulls" | "read.packages" | "write.issues" | "write.pulls" | "write.packages" | "write.repo" | "write.actions" | "secrets.read" | "secrets.write" | "egress.http" | "egress.ssh" | "exec.shell" | "exec.docker";
/**
 * Risk classification for a capability.
 */
type RiskLevel = "low" | "medium" | "high" | "critical";
/**
 * A single permission entry extracted from config.
 */
interface PermissionEntry {
    capability: Capability;
    source: string;
    sourceType: "explicit" | "heuristic";
    tool: string;
    raw: string;
}
/**
 * Complete permission snapshot for a config file.
 */
interface PermissionSnapshot {
    filePath: string;
    entries: PermissionEntry[];
    tools: ToolDeclaration[];
    parseWarning?: "unrecognized_format" | "parse_error" | undefined;
}
/**
 * A tool/server declaration found in config.
 */
interface ToolDeclaration {
    name: string;
    type: "mcp-server" | "action" | "agent-tool" | "unknown";
    capabilities: Capability[];
    source: string;
}
/**
 * Allowlist entry for pre-approved capabilities.
 */
interface AllowlistEntry {
    tool: string;
    capabilities: Capability[];
}
/**
 * Mapping from known actions/tools to their implied capabilities.
 */
declare const CAPABILITY_RISK_MAP: Record<Capability, RiskLevel>;
/**
 * All known capabilities in risk order (lowest first).
 */
declare const ALL_CAPABILITIES: readonly Capability[];

/**
 * Parse a YAML config file and extract its permission snapshot.
 */
declare function parseConfigFile(filePath: string, content: string): PermissionSnapshot;
/**
 * Parse an allowlist YAML file.
 */
declare function parseAllowlist(content: string): AllowlistEntry[];

/**
 * Infer capabilities from a tool/action name using heuristic patterns.
 * Returns empty array if no pattern matches.
 */
declare function inferCapabilities(toolName: string, type?: "action" | "mcp-server" | "agent-tool" | "unknown"): Capability[];
/**
 * Check if a tool name matches any known heuristic pattern.
 */
declare function isKnownTool(toolName: string): boolean;

/**
 * A single permission change between base and head.
 */
interface PermissionDiff {
    capability: Capability;
    tool: string;
    changeType: "added" | "removed" | "upgraded" | "unchanged";
    riskLevel: RiskLevel;
    sourceType: "explicit" | "heuristic";
    source: string;
}
/**
 * Summary of all permission changes.
 */
interface DiffSummary {
    added: PermissionDiff[];
    removed: PermissionDiff[];
    upgraded: PermissionDiff[];
    unchanged: PermissionDiff[];
    hasExpansion: boolean;
    hasEscalation: boolean;
    highestRiskAdded: RiskLevel | undefined;
    heuristicCount: number;
    totalChanges: number;
}

/**
 * Compute the permission diff between base and head snapshots.
 * Optionally filter out allowlisted capabilities.
 */
declare function computeDiff(baseSnapshots: PermissionSnapshot[], headSnapshots: PermissionSnapshot[], allowlist?: AllowlistEntry[]): DiffSummary;

type PolicyLevel = "lenient" | "standard" | "strict";
interface PermissionPolicyConfig {
    mode: "warn" | "fail";
    policyLevel: PolicyLevel;
    approvalLabel: string;
    hasApprovalLabel: boolean;
}
interface PermissionPolicyResult {
    verdict: GateVerdict;
    confidence: ConfidenceLevel;
    reasonCodes: string[];
    findings: PermissionFinding[];
    diffSummary: DiffSummary;
}
interface PermissionFinding {
    tool: string;
    capability: string;
    riskLevel: string;
    changeType: string;
    detail: string;
}

/**
 * Evaluate permission diff against policy.
 *
 * Policy levels:
 * - lenient: only critical escalations trigger FAIL
 * - standard: high + critical escalations trigger FAIL
 * - strict: any expansion triggers FAIL
 *
 * Degrade ladder:
 * 1. Approval label present → PASS (overrides all)
 * 2. No changes → PASS_NO_SCOPE_CHANGE
 * 3. mode=warn → FAIL degrades to WARN
 * 4. Heuristic-only findings → confidence=low → degrade
 */
declare function evaluatePermissionPolicy(diff: DiffSummary, config: PermissionPolicyConfig): PermissionPolicyResult;

export { ALL_CAPABILITIES, type AllowlistEntry, CAPABILITY_RISK_MAP, type Capability, type DiffSummary, type PermissionDiff, type PermissionEntry, type PermissionFinding, type PermissionPolicyConfig, type PermissionPolicyResult, type PermissionSnapshot, type PolicyLevel, type RiskLevel, type ToolDeclaration, computeDiff, evaluatePermissionPolicy, inferCapabilities, isKnownTool, parseAllowlist, parseConfigFile, run };
