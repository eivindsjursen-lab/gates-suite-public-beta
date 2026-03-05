import type { GateVerdict, ConfidenceLevel } from "@gates-suite/core";
import type { DiffSummary } from "../diff/types.js";
import type { PermissionPolicyConfig, PermissionPolicyResult, PermissionFinding } from "./types.js";

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
export function evaluatePermissionPolicy(
  diff: DiffSummary,
  config: PermissionPolicyConfig,
): PermissionPolicyResult {
  if (config.hasApprovalLabel) {
    return {
      verdict: "pass",
      confidence: "high",
      reasonCodes: ["PASS_NO_SCOPE_CHANGE"],
      findings: buildFindings(diff),
      diffSummary: diff,
    };
  }

  if (!diff.hasExpansion && diff.totalChanges === 0) {
    return {
      verdict: "pass",
      confidence: "high",
      reasonCodes: ["PASS_NO_SCOPE_CHANGE"],
      findings: [],
      diffSummary: diff,
    };
  }

  const findings = buildFindings(diff);
  const reasonCodes = new Set<string>();
  const confidence = determineConfidence(diff);

  const shouldFail = shouldTriggerFail(diff, config);

  if (shouldFail) {
    reasonCodes.add("FAIL_CAPABILITY_ESCALATION");
  }

  if (diff.hasExpansion && !shouldFail) {
    reasonCodes.add("WARN_CAPABILITY_EXPANSION");
  }

  if (diff.heuristicCount > 0) {
    reasonCodes.add("WARN_HEURISTIC_MAPPING");
  }

  let verdict: GateVerdict;

  if (shouldFail) {
    if (config.mode === "warn" || confidence === "low") {
      reasonCodes.delete("FAIL_CAPABILITY_ESCALATION");
      reasonCodes.add("WARN_CAPABILITY_EXPANSION");
      verdict = "warn";
    } else {
      verdict = "fail";
    }
  } else if (reasonCodes.size > 0) {
    verdict = "warn";
  } else {
    reasonCodes.add("PASS_NO_SCOPE_CHANGE");
    verdict = "pass";
  }

  return {
    verdict,
    confidence,
    reasonCodes: [...reasonCodes],
    findings,
    diffSummary: diff,
  };
}

function shouldTriggerFail(diff: DiffSummary, config: PermissionPolicyConfig): boolean {
  switch (config.policyLevel) {
    case "strict":
      return diff.hasExpansion;
    case "standard":
      return diff.hasEscalation;
    case "lenient":
      return diff.highestRiskAdded === "critical";
    default:
      return diff.hasEscalation;
  }
}

function determineConfidence(diff: DiffSummary): ConfidenceLevel {
  const totalEntries = diff.added.length + diff.upgraded.length + diff.unchanged.length;
  if (totalEntries === 0) return "high";

  const heuristicRatio = diff.heuristicCount / totalEntries;
  if (heuristicRatio > 0.8) return "low";
  if (heuristicRatio > 0.3) return "med";
  return "high";
}

function buildFindings(diff: DiffSummary): PermissionFinding[] {
  const findings: PermissionFinding[] = [];

  for (const d of [...diff.added, ...diff.upgraded]) {
    findings.push({
      tool: d.tool,
      capability: d.capability,
      riskLevel: d.riskLevel,
      changeType: d.changeType,
      detail: `${d.changeType}: ${d.tool} gains ${d.capability} (${d.riskLevel} risk, ${d.sourceType})`,
    });
  }

  for (const d of diff.removed) {
    findings.push({
      tool: d.tool,
      capability: d.capability,
      riskLevel: d.riskLevel,
      changeType: "removed",
      detail: `removed: ${d.tool} loses ${d.capability}`,
    });
  }

  findings.sort((a, b) => {
    const riskOrder = ["critical", "high", "medium", "low"];
    return riskOrder.indexOf(a.riskLevel) - riskOrder.indexOf(b.riskLevel);
  });

  return findings;
}
