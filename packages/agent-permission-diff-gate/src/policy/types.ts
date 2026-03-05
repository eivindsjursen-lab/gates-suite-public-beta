import type { GateVerdict, ConfidenceLevel } from "@gates-suite/core";
import type { DiffSummary } from "../diff/types.js";

export type PolicyLevel = "lenient" | "standard" | "strict";

export interface PermissionPolicyConfig {
  mode: "warn" | "fail";
  policyLevel: PolicyLevel;
  approvalLabel: string;
  hasApprovalLabel: boolean;
}

export interface PermissionPolicyResult {
  verdict: GateVerdict;
  confidence: ConfidenceLevel;
  reasonCodes: string[];
  findings: PermissionFinding[];
  diffSummary: DiffSummary;
}

export interface PermissionFinding {
  tool: string;
  capability: string;
  riskLevel: string;
  changeType: string;
  detail: string;
}
