export { run } from "./main.js";

export { parseConfigFile, parseAllowlist } from "./parser/config-parser.js";
export { inferCapabilities, isKnownTool } from "./parser/heuristics.js";

export type {
  Capability,
  RiskLevel,
  PermissionEntry,
  PermissionSnapshot,
  ToolDeclaration,
  AllowlistEntry,
} from "./parser/types.js";

export { CAPABILITY_RISK_MAP, ALL_CAPABILITIES } from "./parser/types.js";

export { computeDiff } from "./diff/engine.js";

export type { PermissionDiff, DiffSummary } from "./diff/types.js";

export { evaluatePermissionPolicy } from "./policy/evaluate.js";

export type {
  PolicyLevel,
  PermissionPolicyConfig,
  PermissionPolicyResult,
  PermissionFinding,
} from "./policy/types.js";
