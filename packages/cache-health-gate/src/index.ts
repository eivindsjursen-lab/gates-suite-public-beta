export { run } from "./main.js";

export {
  parseTokenFields,
  parseCacheToken,
  parseCacheStepMarker,
  extractCacheData,
} from "./parser/token-parser.js";

export type { CacheToken, CacheStepMarker, CacheTokenWithContext } from "./parser/types.js";

export { associateTimings, computeGroupMetrics } from "./metrics/timing.js";

export type { CacheGroupMetrics, TimingAssociation } from "./metrics/types.js";

export { evaluatePolicy } from "./policy/evaluate.js";

export type {
  CacheThresholds,
  CachePolicyConfig,
  CacheBaselineMetrics,
  PolicyViolation,
  CachePolicyResult,
} from "./policy/types.js";
