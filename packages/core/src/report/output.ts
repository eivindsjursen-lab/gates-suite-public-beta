import * as actionsCore from "@actions/core";
import type { GateResult } from "../schema/result.js";
import { renderJobSummary, type MarkdownReportOptions } from "./markdown.js";

export interface OutputDispatcherOptions extends MarkdownReportOptions {
  writeComment: boolean;
  commentToken?: string | undefined;
  owner?: string | undefined;
  repo?: string | undefined;
  prNumber?: number | undefined;
  extraOutputs?: Record<string, string> | undefined;
}

/**
 * Dispatch gate results to all output channels.
 * Job Summary is always written. PR comment is best-effort.
 * Never throws on comment failure (fork safety).
 */
export async function dispatchOutput(
  result: GateResult,
  options: OutputDispatcherOptions,
): Promise<void> {
  const markdown = renderJobSummary(result, options);

  // Job Summary — always
  await actionsCore.summary.addRaw(markdown).write();

  // Action outputs
  actionsCore.setOutput("result", result.result);
  actionsCore.setOutput("confidence", result.confidence);
  actionsCore.setOutput("reason_codes", JSON.stringify(result.reason_codes));
  actionsCore.setOutput("baseline_samples", String(result.baseline_samples));

  if (options.extraOutputs) {
    for (const [key, value] of Object.entries(options.extraOutputs)) {
      actionsCore.setOutput(key, value);
    }
  }

  // PR Comment — best-effort
  if (options.writeComment && options.prNumber) {
    try {
      await postPrComment(markdown, options);
    } catch {
      actionsCore.warning(
        "Could not post PR comment (permissions may be restricted). Job Summary is available above.",
      );
    }
  }

  // Set exit code based on verdict
  if (result.result === "fail") {
    actionsCore.setFailed(`Gate failed: ${result.reason_codes.join(", ")}`);
  }
}

async function postPrComment(body: string, options: OutputDispatcherOptions): Promise<void> {
  const { Octokit } = await import("@octokit/rest");
  const octokit = new Octokit({ auth: options.commentToken });

  if (!options.owner || !options.repo || !options.prNumber) {
    return;
  }

  const marker = `<!-- ${options.gateName} -->`;
  const commentBody = `${marker}\n${body}`;

  const { data: comments } = await octokit.issues.listComments({
    owner: options.owner,
    repo: options.repo,
    issue_number: options.prNumber,
    per_page: 100,
  });

  const existing = comments.find((c) => c.body?.includes(marker));

  if (existing) {
    await octokit.issues.updateComment({
      owner: options.owner,
      repo: options.repo,
      comment_id: existing.id,
      body: commentBody,
    });
  } else {
    await octokit.issues.createComment({
      owner: options.owner,
      repo: options.repo,
      issue_number: options.prNumber,
      body: commentBody,
    });
  }
}

/**
 * Write result as a JSON artifact string (for file output).
 */
export function serializeResultJson(result: GateResult): string {
  return JSON.stringify(result, null, 2);
}
