import * as actionsCore from "@actions/core";
import { Octokit } from "@octokit/rest";
import { dispatchOutput, createSkippedResult, type GateResult } from "@gates-suite/core";
import { parseConfigFile, parseAllowlist } from "./parser/config-parser.js";
import { computeDiff } from "./diff/engine.js";
import { evaluatePermissionPolicy } from "./policy/evaluate.js";
import type { PermissionSnapshot, AllowlistEntry } from "./parser/types.js";
import type { PermissionPolicyConfig, PolicyLevel } from "./policy/types.js";

export async function run(): Promise<void> {
  try {
    const config = readInputs();
    const result = await execute(config);
    const findingsCount = result.top_findings?.length ?? 0;
    await dispatchOutput(result, {
      title: "Agent Permission Diff Gate",
      gateName: "agent-permission-diff-gate",
      writeComment: config.prNumber !== undefined,
      commentToken: config.token,
      owner: config.owner,
      repo: config.repo,
      prNumber: config.prNumber,
      extraOutputs: { findings_count: String(findingsCount) },
    });
  } catch (error) {
    const result = handleGracefulDegrade(error);
    if (result) {
      await dispatchOutput(result, {
        title: "Agent Permission Diff Gate",
        gateName: "agent-permission-diff-gate",
        writeComment: false,
      });
    } else {
      actionsCore.setFailed(error instanceof Error ? error.message : String(error));
    }
  }
}

interface ActionConfig {
  token: string;
  mode: "warn" | "fail";
  policyLevel: PolicyLevel;
  approvalLabel: string;
  allowlistPath: string | undefined;
  configPaths: string[];
  owner: string;
  repo: string;
  prNumber: number | undefined;
  baseSha: string;
  headSha: string;
}

function readInputs(): ActionConfig {
  const [owner = "", repo = ""] = (process.env["GITHUB_REPOSITORY"] ?? "").split("/");

  const prNumberStr =
    process.env["GITHUB_EVENT_NAME"] === "pull_request"
      ? (process.env["PR_NUMBER"] ?? actionsCore.getInput("pr_number"))
      : undefined;
  const prNumber = prNumberStr ? parseInt(prNumberStr, 10) || undefined : undefined;

  let configPaths: string[];
  try {
    configPaths = JSON.parse(actionsCore.getInput("config_paths") || "[]") as string[];
  } catch {
    configPaths = [
      ".github/mcp*.yml",
      ".github/mcp*.yaml",
      ".github/mcp*.json",
      ".github/agent*.yml",
      ".github/agent*.yaml",
    ];
  }

  const policyInput = actionsCore.getInput("policy_level") || "standard";
  const policyLevel: PolicyLevel =
    policyInput === "lenient" || policyInput === "strict" ? policyInput : "standard";

  return {
    token: actionsCore.getInput("token") || (process.env["GITHUB_TOKEN"] ?? ""),
    mode: actionsCore.getInput("mode") === "fail" ? "fail" : "warn",
    policyLevel,
    approvalLabel: actionsCore.getInput("approval_label") || "agent-scope-approved",
    allowlistPath: actionsCore.getInput("allowlist_path") || undefined,
    configPaths,
    owner,
    repo,
    prNumber,
    baseSha: process.env["GITHUB_BASE_SHA"] ?? process.env["GITHUB_EVENT_BEFORE"] ?? "",
    headSha: process.env["GITHUB_SHA"] ?? "",
  };
}

function handleGracefulDegrade(error: unknown): GateResult | undefined {
  const status = (error as { status?: number }).status;

  if (status === 403) {
    const msg = error instanceof Error ? error.message : String(error);
    const isAbuse =
      msg.toLowerCase().includes("abuse") || msg.toLowerCase().includes("secondary rate limit");
    if (isAbuse) {
      actionsCore.warning(`GitHub abuse detection triggered: ${msg}`);
      return createSkippedResult(["SKIP_GITHUB_ABUSE_LIMIT"]);
    }
    actionsCore.warning(`Insufficient permissions: ${msg}`);
    return createSkippedResult(["SKIP_PERMISSION_DENIED"]);
  }

  if (status === 429) {
    actionsCore.warning("GitHub API rate limit hit. Reduce API calls or wait for reset.");
    return createSkippedResult(["SKIP_RATE_LIMITED"]);
  }

  return undefined;
}

async function execute(config: ActionConfig): Promise<GateResult> {
  if (!config.baseSha || !config.headSha) {
    return createSkippedResult(["SKIP_NO_BASELINE"]);
  }

  const octokit = new Octokit({ auth: config.token });

  let hasApprovalLabel = false;
  if (config.prNumber) {
    try {
      const { data: labels } = await octokit.issues.listLabelsOnIssue({
        owner: config.owner,
        repo: config.repo,
        issue_number: config.prNumber,
      });
      hasApprovalLabel = labels.some((l) => l.name === config.approvalLabel);
    } catch {
      actionsCore.warning("Could not check PR labels. Proceeding without approval check.");
    }
  }

  const changedFilesResult = await getChangedFiles(octokit, config);

  if (changedFilesResult === "permission_denied") {
    return createSkippedResult(["SKIP_PERMISSION_DENIED"]);
  }

  if (changedFilesResult === "rate_limited") {
    return createSkippedResult(["SKIP_RATE_LIMITED"]);
  }

  if (changedFilesResult === "error") {
    return createSkippedResult(["SKIP_PERMISSION_DENIED"]);
  }

  const relevantFiles = changedFilesResult.filter((f) =>
    config.configPaths.some((pattern) => matchGlob(pattern, f.filename)),
  );

  if (relevantFiles.length === 0) {
    return {
      result: "pass",
      confidence: "high",
      reason_codes: ["PASS_NO_SCOPE_CHANGE"],
      baseline_samples: 0,
      fix_suggestions: [],
    };
  }

  const baseSnapshots: PermissionSnapshot[] = [];
  const headSnapshots: PermissionSnapshot[] = [];

  for (const file of relevantFiles) {
    if (file.status !== "added") {
      const baseContent = await fetchFileContent(octokit, config, file.filename, config.baseSha);
      if (baseContent) {
        baseSnapshots.push(parseConfigFile(file.filename, baseContent));
      }
    }

    if (file.status !== "removed") {
      const headContent = await fetchFileContent(octokit, config, file.filename, config.headSha);
      if (headContent) {
        headSnapshots.push(parseConfigFile(file.filename, headContent));
      }
    }
  }

  const allSnapshots = [...baseSnapshots, ...headSnapshots];
  const parseWarnings = allSnapshots.filter((s) => s.parseWarning);
  if (parseWarnings.length > 0 && allSnapshots.every((s) => s.entries.length === 0)) {
    const files = parseWarnings.map((s) => s.filePath).join(", ");
    actionsCore.warning(`Config files could not be parsed: ${files}`);
    return createSkippedResult(["SKIP_UNSUPPORTED_FORMAT"]);
  }
  for (const snap of parseWarnings) {
    actionsCore.warning(
      `${snap.filePath}: ${snap.parseWarning === "parse_error" ? "YAML parse error" : "unrecognized config format"} — file skipped`,
    );
  }

  let allowlist: AllowlistEntry[] = [];
  if (config.allowlistPath) {
    const allowlistContent = await fetchFileContent(
      octokit,
      config,
      config.allowlistPath,
      config.headSha,
    );
    if (allowlistContent) {
      allowlist = parseAllowlist(allowlistContent);
    }
  }

  const diff = computeDiff(baseSnapshots, headSnapshots, allowlist);

  const policyConfig: PermissionPolicyConfig = {
    mode: config.mode,
    policyLevel: config.policyLevel,
    approvalLabel: config.approvalLabel,
    hasApprovalLabel,
  };

  const policyResult = evaluatePermissionPolicy(diff, policyConfig);

  const findings = policyResult.findings.map((f) => ({
    scope: "job" as const,
    name: `${f.tool}/${f.capability}`,
    risk_level: f.riskLevel,
    detail: f.detail,
  }));

  return {
    result: policyResult.verdict,
    confidence: policyResult.confidence,
    reason_codes: policyResult.reasonCodes,
    baseline_samples: 0,
    top_findings: findings.length > 0 ? findings : undefined,
    fix_suggestions: generateFixSuggestions(policyResult, config),
  };
}

async function getChangedFiles(
  octokit: Octokit,
  config: ActionConfig,
): Promise<
  { filename: string; status: string }[] | "permission_denied" | "rate_limited" | "error"
> {
  try {
    const { data } = await octokit.repos.compareCommits({
      owner: config.owner,
      repo: config.repo,
      base: config.baseSha,
      head: config.headSha,
    });
    return (data.files ?? []).map((f) => ({
      filename: f.filename,
      status: f.status ?? "modified",
    }));
  } catch (error) {
    const status = (error as { status?: number }).status;
    actionsCore.warning(
      `Could not compare commits ${config.baseSha.slice(0, 7)}...${config.headSha.slice(0, 7)}: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (status === 429) return "rate_limited";
    if (status === 403) return "permission_denied";
    return "error";
  }
}

async function fetchFileContent(
  octokit: Octokit,
  config: ActionConfig,
  path: string,
  ref: string,
): Promise<string | undefined> {
  try {
    const { data } = await octokit.repos.getContent({
      owner: config.owner,
      repo: config.repo,
      path,
      ref,
    });

    if ("content" in data && typeof data.content === "string") {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function matchGlob(pattern: string, filename: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regexStr}$`).test(filename);
}

function generateFixSuggestions(
  policyResult: ReturnType<typeof evaluatePermissionPolicy>,
  config: ActionConfig,
): string[] {
  const suggestions: string[] = [];

  if (policyResult.diffSummary.hasEscalation) {
    suggestions.push(
      `High-risk capability change detected. Add the "${config.approvalLabel}" label to approve, or request CODEOWNERS review.`,
    );
  }

  if (policyResult.diffSummary.heuristicCount > 0) {
    suggestions.push(
      "Some permissions were inferred by heuristic. Add explicit capability declarations to your config for accuracy.",
    );
  }

  const criticalFindings = policyResult.findings.filter((f) => f.riskLevel === "critical");
  for (const f of criticalFindings.slice(0, 3)) {
    suggestions.push(
      `Critical: ${f.tool} uses ${f.capability}. Ensure this is intentional and documented.`,
    );
  }

  return suggestions;
}
