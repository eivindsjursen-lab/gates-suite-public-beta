# Agent Tool Permission Diff Gate

> Fail (or warn) PRs when agent or tool capability scope expands without approval.

## Quick Start

Add the gate to your PR workflow:

```yaml
- name: Permission Diff Gate
  uses: your-org/gates-suite/packages/agent-permission-diff-gate@v1
  with:
    mode: warn
    policy_level: standard
```

The gate automatically scans `.github/mcp*.yml`, `.github/agent*.yml`, and workflow files for permission changes.

## Inputs

| Input            | Default                | Description                                    |
| ---------------- | ---------------------- | ---------------------------------------------- |
| `token`          | `${{ github.token }}`  | GitHub token for API access                    |
| `mode`           | `warn`                 | Gate mode: `warn` or `fail`                    |
| `policy_level`   | `standard`             | Strictness: `lenient`, `standard`, or `strict` |
| `approval_label` | `agent-scope-approved` | Label that approves scope expansion            |
| `allowlist_path` | _(none)_               | Path to allowlist YAML file                    |
| `config_paths`   | see below              | JSON array of glob patterns for config files   |

Default `config_paths`:

```json
[
  ".github/mcp*.yml",
  ".github/mcp*.yaml",
  ".github/mcp*.json",
  ".github/agent*.yml",
  ".github/agent*.yaml"
]
```

## Outputs

| Output           | Description                                        |
| ---------------- | -------------------------------------------------- |
| `result`         | Gate verdict: `pass`, `warn`, `fail`, or `skipped` |
| `confidence`     | Confidence level: `low`, `med`, or `high`          |
| `reason_codes`   | JSON array of machine-readable reason codes        |
| `findings_count` | Number of permission findings                      |

## How It Works

1. **Detect** — Identifies changed config files (MCP, agent, workflow) between base and head
2. **Parse** — Extracts permission entries: explicit declarations + heuristic inference
3. **Diff** — Computes set diff of `(tool, capability)` pairs
4. **Score** — Classifies changes by risk level (low → critical)
5. **Evaluate** — Applies policy with degrade ladder
6. **Report** — Renders findings sorted by risk with fix suggestions

## Capability Taxonomy

| Risk         | Capabilities                                                 |
| ------------ | ------------------------------------------------------------ |
| **Low**      | `read.repo`, `read.issues`, `read.pulls`, `read.packages`    |
| **Medium**   | `write.issues`, `write.pulls`, `write.packages`              |
| **High**     | `write.repo`, `write.actions`, `secrets.read`, `egress.http` |
| **Critical** | `secrets.write`, `egress.ssh`, `exec.shell`, `exec.docker`   |

## Policy Levels

| Level      | FAIL triggers                    |
| ---------- | -------------------------------- |
| `lenient`  | Only critical-risk escalations   |
| `standard` | High + critical risk escalations |
| `strict`   | Any capability expansion         |

## Degrade Ladder

1. **Approval label** on PR → PASS (overrides all findings)
2. **No config changes** → PASS_NO_SCOPE_CHANGE
3. **mode=warn** → FAIL degrades to WARN
4. **Low confidence** (>80% heuristic) → FAIL degrades to WARN
5. **Heuristic detected** → adds WARN_HEURISTIC_MAPPING

## Reason Codes

| Code                         | Severity | Meaning                             |
| ---------------------------- | -------- | ----------------------------------- |
| `PASS_NO_SCOPE_CHANGE`       | pass     | No capability changes detected      |
| `FAIL_CAPABILITY_ESCALATION` | fail     | High/critical risk capability added |
| `WARN_CAPABILITY_EXPANSION`  | warn     | Low/medium risk expansion detected  |
| `WARN_HEURISTIC_MAPPING`     | warn     | Permissions inferred, not declared  |
| `SKIP_NO_BASELINE`           | skip     | Cannot determine base commit        |

## Allowlist

Create a YAML file listing pre-approved tool capabilities:

```yaml
- tool: actions/checkout@v4
  capabilities:
    - read.repo
- tool: docker/build-push-action@v5
  capabilities:
    - exec.docker
    - write.packages
    - egress.http
```

Reference it in the action:

```yaml
- uses: your-org/gates-suite/packages/agent-permission-diff-gate@v1
  with:
    allowlist_path: .github/permission-allowlist.yml
```

## Heuristic Inference

When tools lack explicit `permissions:` declarations, the gate infers capabilities from names:

| Pattern                      | Inferred capabilities                          |
| ---------------------------- | ---------------------------------------------- |
| `actions/checkout@*`         | `read.repo`                                    |
| `docker/build-push-action@*` | `exec.docker`, `write.packages`, `egress.http` |
| MCP server `filesystem`      | `read.repo`, `write.repo`                      |
| MCP server `browser`         | `egress.http`, `exec.shell`                    |
| MCP server `terminal`        | `exec.shell`                                   |

Add explicit `permissions:` to your configs to avoid heuristic warnings and increase confidence.

## Troubleshooting

**Gate returns SKIP_NO_BASELINE**

- The gate needs both `GITHUB_BASE_SHA` and `GITHUB_SHA` environment variables
- Ensure the workflow triggers on `pull_request` events

**Everything shows WARN_HEURISTIC_MAPPING**

- Add explicit `permissions:` arrays to your MCP/agent config files
- This increases confidence from `low` to `high`

**False positive: known tool flagged**

- Add the tool to an allowlist file and reference it via `allowlist_path`
- Or add the `agent-scope-approved` label to the PR

**Want to lock down all changes**

- Set `policy_level: strict` to fail on any capability expansion
- Combine with `mode: fail` for hard enforcement

## Examples

See [`examples/permission-diff-demo/`](../../examples/permission-diff-demo/) for safe vs. risky config demos and an allowlist example.
