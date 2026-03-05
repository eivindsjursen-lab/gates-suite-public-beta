import type { PermissionSnapshot, Capability, AllowlistEntry } from "../parser/types.js";
import { CAPABILITY_RISK_MAP } from "../parser/types.js";
import type { PermissionDiff, DiffSummary } from "./types.js";

const RISK_ORDER = ["low", "medium", "high", "critical"] as const;

/**
 * Compute the permission diff between base and head snapshots.
 * Optionally filter out allowlisted capabilities.
 */
export function computeDiff(
  baseSnapshots: PermissionSnapshot[],
  headSnapshots: PermissionSnapshot[],
  allowlist: AllowlistEntry[] = [],
): DiffSummary {
  const basePerms = collectPermissions(baseSnapshots);
  const headPerms = collectPermissions(headSnapshots);
  const allowed = buildAllowedSet(allowlist);

  const diffs: PermissionDiff[] = [];

  for (const [key, headEntry] of headPerms) {
    if (allowed.has(key)) continue;

    const baseEntry = basePerms.get(key);
    if (!baseEntry) {
      diffs.push({
        ...headEntry,
        changeType: "added",
      });
    } else {
      diffs.push({
        ...headEntry,
        changeType: "unchanged",
      });
    }
  }

  for (const [key, baseEntry] of basePerms) {
    if (allowed.has(key)) continue;

    if (!headPerms.has(key)) {
      diffs.push({
        ...baseEntry,
        changeType: "removed",
      });
    }
  }

  detectUpgrades(diffs, basePerms, headPerms);

  const added = diffs.filter((d) => d.changeType === "added");
  const removed = diffs.filter((d) => d.changeType === "removed");
  const upgraded = diffs.filter((d) => d.changeType === "upgraded");
  const unchanged = diffs.filter((d) => d.changeType === "unchanged");

  const expansionDiffs = [...added, ...upgraded];
  const highestRiskAdded = getHighestRisk(expansionDiffs);
  const hasEscalation = highestRiskAdded === "high" || highestRiskAdded === "critical";

  return {
    added,
    removed,
    upgraded,
    unchanged,
    hasExpansion: expansionDiffs.length > 0,
    hasEscalation,
    highestRiskAdded,
    heuristicCount: diffs.filter((d) => d.sourceType === "heuristic").length,
    totalChanges: added.length + removed.length + upgraded.length,
  };
}

interface PermKey {
  capability: Capability;
  tool: string;
  riskLevel: (typeof CAPABILITY_RISK_MAP)[Capability];
  sourceType: "explicit" | "heuristic";
  source: string;
}

function collectPermissions(snapshots: PermissionSnapshot[]): Map<string, PermKey> {
  const map = new Map<string, PermKey>();

  for (const snapshot of snapshots) {
    for (const entry of snapshot.entries) {
      const key = `${entry.tool}::${entry.capability}`;
      if (!map.has(key)) {
        map.set(key, {
          capability: entry.capability,
          tool: entry.tool,
          riskLevel: CAPABILITY_RISK_MAP[entry.capability],
          sourceType: entry.sourceType,
          source: entry.source,
        });
      }
    }
  }

  return map;
}

function buildAllowedSet(allowlist: AllowlistEntry[]): Set<string> {
  const set = new Set<string>();
  for (const entry of allowlist) {
    for (const cap of entry.capabilities) {
      set.add(`${entry.tool}::${cap}`);
    }
  }
  return set;
}

function detectUpgrades(
  diffs: PermissionDiff[],
  basePerms: Map<string, PermKey>,
  headPerms: Map<string, PermKey>,
): void {
  const baseToolCaps = groupByTool(basePerms);
  const headToolCaps = groupByTool(headPerms);

  for (const [tool, headCaps] of headToolCaps) {
    const baseCaps = baseToolCaps.get(tool);
    if (!baseCaps) continue;

    const baseMaxRisk = getHighestRiskFromCaps(baseCaps);
    const headMaxRisk = getHighestRiskFromCaps(headCaps);

    if (baseMaxRisk !== undefined && headMaxRisk !== undefined) {
      const baseIdx = RISK_ORDER.indexOf(baseMaxRisk);
      const headIdx = RISK_ORDER.indexOf(headMaxRisk);

      if (headIdx > baseIdx) {
        const newHighCaps = headCaps.filter((c) => {
          const risk = CAPABILITY_RISK_MAP[c];
          return RISK_ORDER.indexOf(risk) > baseIdx && !baseCaps.includes(c);
        });

        for (const diff of diffs) {
          if (
            diff.tool === tool &&
            diff.changeType === "added" &&
            newHighCaps.includes(diff.capability)
          ) {
            diff.changeType = "upgraded";
          }
        }
      }
    }
  }
}

function groupByTool(perms: Map<string, PermKey>): Map<string, Capability[]> {
  const map = new Map<string, Capability[]>();
  for (const [, entry] of perms) {
    const existing = map.get(entry.tool);
    if (existing) {
      existing.push(entry.capability);
    } else {
      map.set(entry.tool, [entry.capability]);
    }
  }
  return map;
}

function getHighestRisk(diffs: PermissionDiff[]): (typeof RISK_ORDER)[number] | undefined {
  if (diffs.length === 0) return undefined;

  let highest = -1;
  for (const d of diffs) {
    const idx = RISK_ORDER.indexOf(d.riskLevel);
    if (idx > highest) highest = idx;
  }

  return highest >= 0 ? RISK_ORDER[highest] : undefined;
}

function getHighestRiskFromCaps(caps: Capability[]): (typeof RISK_ORDER)[number] | undefined {
  let highest = -1;
  for (const cap of caps) {
    const risk = CAPABILITY_RISK_MAP[cap];
    const idx = RISK_ORDER.indexOf(risk);
    if (idx > highest) highest = idx;
  }
  return highest >= 0 ? RISK_ORDER[highest] : undefined;
}
