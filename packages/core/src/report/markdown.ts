import type { GateResult, Regression, Finding } from "../schema/result.js";
import { getReasonMessage } from "../reason-codes/registry.js";

export interface MarkdownReportOptions {
  title: string;
  gateName: string;
}

/**
 * Render a GateResult as a GitHub Job Summary markdown string.
 * Structure: What changed / So what / Now what.
 */
export function renderJobSummary(result: GateResult, options: MarkdownReportOptions): string {
  const lines: string[] = [];

  lines.push(`## ${options.title}`);
  lines.push("");
  lines.push(renderVerdictBadge(result));
  lines.push("");

  // What changed
  lines.push("### What changed");
  lines.push("");

  if (result.top_regressions && result.top_regressions.length > 0) {
    lines.push(renderRegressionsTable(result.top_regressions));
  } else if (result.top_findings && result.top_findings.length > 0) {
    lines.push(renderFindingsTable(result.top_findings));
  } else {
    lines.push("No regressions or findings detected.");
  }
  lines.push("");

  // So what
  lines.push("### So what");
  lines.push("");
  lines.push(renderReasonCodes(result.reason_codes));
  lines.push("");

  if (result.baseline) {
    lines.push(
      `Baseline: **${result.baseline.samples_used}** samples from \`${result.baseline.branch}\` ` +
        `(${result.baseline.mode} mode, workflow ${result.baseline.workflow_id})`,
    );
    lines.push("");
  }

  // Now what
  lines.push("### Now what");
  lines.push("");

  if (result.fix_suggestions.length > 0) {
    for (const fix of result.fix_suggestions) {
      lines.push(`- ${fix}`);
    }
  } else {
    for (const step of defaultNextSteps(result)) {
      lines.push(`- ${step}`);
    }
  }
  lines.push("");

  // Feedback
  lines.push("### Feedback");
  lines.push("");
  lines.push(`- Report feedback/issues: ${feedbackLinkForGate(options.gateName)}`);
  lines.push("");

  // Footer
  lines.push("---");
  lines.push(
    `*${options.gateName} · confidence: ${result.confidence} · ` +
      `${result.baseline_samples} baseline samples*`,
  );

  return lines.join("\n");
}

function renderVerdictBadge(result: GateResult): string {
  const emoji: Record<string, string> = {
    pass: "✅",
    warn: "⚠️",
    fail: "❌",
    skipped: "⏭️",
  };
  const icon = emoji[result.result] ?? "❓";
  return `**${icon} ${result.result.toUpperCase()}** · confidence: **${result.confidence}**`;
}

function renderRegressionsTable(regressions: Regression[]): string {
  const lines: string[] = [];
  lines.push("| Scope | Name | Delta | Baseline | Current |");
  lines.push("|-------|------|------:|----------:|--------:|");
  const seenRows = new Set<string>();

  for (const r of regressions) {
    const sign = r.delta_pct >= 0 ? "+" : "";
    const row =
      `| ${r.scope} | ${r.name} | ${sign}${r.delta_pct.toFixed(1)}% | ` +
      `${formatMs(r.baseline_ms)} | ${formatMs(r.current_ms)} |`;
    // Cache/CI policies can emit multiple reason codes that map to the same visible row.
    // Deduping here keeps the PR summary readable without changing the result schema.
    if (seenRows.has(row)) continue;
    seenRows.add(row);
    lines.push(row);
  }

  return lines.join("\n");
}

function renderFindingsTable(findings: Finding[]): string {
  const lines: string[] = [];
  lines.push("| Scope | Name | Risk | Detail |");
  lines.push("|-------|------|------|--------|");

  for (const f of findings) {
    lines.push(`| ${f.scope} | ${f.name} | ${f.risk_level} | ${f.detail} |`);
  }

  return lines.join("\n");
}

function renderReasonCodes(codes: string[]): string {
  return codes.map((code) => `- **${code}**: ${getReasonMessage(code)}`).join("\n");
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function defaultNextSteps(result: GateResult): string[] {
  const codes = new Set(result.reason_codes);

  if (codes.has("SKIP_NO_CACHE_DETECTED")) {
    return [
      "No cache markers were detected in this workflow run. Add `[cache-step]` markers to cache restore steps and a `[cache]` token step after each cache restore.",
      "This is an onboarding/setup issue, not a CI regression. See the Cache Health Gate README examples for Node/Python instrumentation.",
    ];
  }

  if (codes.has("WARN_NO_BASELINE") || codes.has("SKIP_NO_BASELINE")) {
    return [
      "Run the workflow on `push` for the default branch to build baseline history (usually 5-10 successful runs).",
      "After baseline is available, open a PR with a controlled cache-key change to verify `WARN_HIT_RATE_DROP` is detected.",
    ];
  }

  return ["No action required."];
}

function feedbackLinkForGate(gateName: string): string {
  if (gateName === "cache-health-gate") {
    return "https://github.com/eivindsjursen-lab/gates-suite/issues/new?template=early-access-feedback.yml";
  }
  return "https://github.com/eivindsjursen-lab/gates-suite/issues/new/choose";
}
