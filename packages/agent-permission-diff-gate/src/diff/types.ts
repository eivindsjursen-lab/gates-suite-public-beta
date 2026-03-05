import type { Capability, RiskLevel } from "../parser/types.js";

/**
 * A single permission change between base and head.
 */
export interface PermissionDiff {
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
export interface DiffSummary {
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
