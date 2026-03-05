import type { GateVerdict, ConfidenceLevel } from "@gates-suite/core";
import type { CacheGroupMetrics } from "../metrics/types.js";

export interface CacheThresholds {
  hitRateDropPct: number;
  restoreRegressionPct: number;
  restoreHardMs: number;
}

export interface CachePolicyConfig {
  mode: "warn" | "fail";
  thresholds: CacheThresholds;
  noBaselineBehavior: "warn" | "skip";
}

export interface CacheBaselineMetrics {
  hitRate: number;
  restoreMs: number | undefined;
}

export interface PolicyViolation {
  group: string;
  jobName: string;
  reasonCode: string;
  message: string;
}

export interface CachePolicyResult {
  verdict: GateVerdict;
  confidence: ConfidenceLevel;
  reasonCodes: string[];
  violations: PolicyViolation[];
  warnings: string[];
  metrics: CacheGroupMetrics[];
}
