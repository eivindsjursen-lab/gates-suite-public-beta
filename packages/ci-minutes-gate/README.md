# CI Minutes Delta Gate

> Fail (or warn) PRs when CI duration regresses: workflow, job, and step ranking with fix hints.

## Quick Start

Add the gate as a final step (or dedicated job) in your CI workflow:

```yaml
steps:
  # ... your build/test steps ...

  - name: CI Minutes Gate
    if: always()
    uses: your-org/gates-suite/packages/ci-minutes-gate@v1
    with:
      mode: warn
      thresholds_total_regression_pct: "15"
```

No instrumentation steps needed — the gate reads workflow timing data directly from the GitHub API.

## Inputs

| Input                             | Default               | Description                                        |
| --------------------------------- | --------------------- | -------------------------------------------------- |
| `token`                           | `${{ github.token }}` | GitHub token for API access                        |
| `mode`                            | `warn`                | Gate mode: `warn` or `fail`                        |
| `baseline_runs`                   | `10`                  | Number of baseline runs to fetch                   |
| `baseline_window_days`            | `14`                  | Look-back window in days                           |
| `baseline_event_filter`           | `push`                | Event type filter for baseline runs                |
| `no_baseline_behavior`            | `warn`                | Behavior when no baseline exists: `warn` or `skip` |
| `thresholds_total_regression_pct` | `15`                  | Total duration regression threshold (percent)      |
| `budget_total_seconds`            | _(none)_              | Optional total workflow time budget (seconds)      |
| `budget_per_job_seconds`          | _(none)_              | Optional per-job time budget (seconds)             |
| `api_budget_calls`                | `30`                  | Maximum GitHub API calls per run                   |

## Outputs

| Output             | Description                                        |
| ------------------ | -------------------------------------------------- |
| `result`           | Gate verdict: `pass`, `warn`, `fail`, or `skipped` |
| `confidence`       | Confidence level: `low`, `med`, or `high`          |
| `reason_codes`     | JSON array of machine-readable reason codes        |
| `baseline_samples` | Number of baseline samples used                    |

## How It Works

1. **Baseline** — Fetches recent successful push-event runs from the default branch
2. **Compute** — Calculates workflow total and per-job durations for the current run
3. **Compare** — Computes median baseline durations and detects regressions above the threshold
4. **Budget** — Checks against optional total and per-job time budgets
5. **Evaluate** — Applies policy with degrade ladder (see below)
6. **Report** — Renders a "What changed / So what / Now what" Job Summary with top jobs ranking

## Metrics

| Metric         | Description                                           |
| -------------- | ----------------------------------------------------- |
| Workflow total | Wall-clock time from run start to completion          |
| Job duration   | Per-job start-to-completion time                      |
| Step duration  | Per-step timing (used for top-contributor ranking)    |
| Regression %   | `(current - baseline_median) / baseline_median × 100` |

## Degrade Ladder

1. **No baseline** → `noBaselineBehavior` setting (`warn` or `skip`)
2. **Confidence < med** → `FAIL_DURATION_REGRESSION` degrades to `WARN_DURATION_INCREASE`
3. **mode=warn** → all `FAIL_*` verdicts degrade to `WARN_*`
4. **mode=fail + confidence >= med** → `FAIL_DURATION_REGRESSION` causes non-zero exit
5. **Budget violations** are always `WARN_BUDGET_EXCEEDED` (never fail alone)

## Reason Codes

| Code                       | Severity | Meaning                                 |
| -------------------------- | -------- | --------------------------------------- |
| `PASS_ALL_CLEAR`           | pass     | Duration within threshold               |
| `FAIL_DURATION_REGRESSION` | fail     | Duration regressed beyond threshold     |
| `WARN_DURATION_INCREASE`   | warn     | Duration increased (degraded from FAIL) |
| `WARN_BUDGET_EXCEEDED`     | warn     | Duration exceeds configured budget      |
| `WARN_NO_BASELINE`         | warn     | No baseline data available              |
| `SKIP_NO_BASELINE`         | skip     | No baseline (configured to skip)        |

## Time Budgets

Set absolute time limits independently of baseline comparison:

```yaml
- name: CI Minutes Gate
  uses: your-org/gates-suite/packages/ci-minutes-gate@v1
  with:
    budget_total_seconds: "600" # 10 minute workflow limit
    budget_per_job_seconds: "300" # 5 minute per-job limit
```

Budget violations produce `WARN_BUDGET_EXCEEDED` — they inform but don't cause failures by themselves.

## Troubleshooting

**Gate always returns WARN_NO_BASELINE**

- The gate needs successful push-event runs on the default branch
- After a few merges to main, the baseline populates automatically

**Regression detected but workflow feels fast**

- The gate compares against the _median_ of recent runs, not the fastest
- Check if recent baseline runs were unusually fast (flaky timing)
- Consider increasing `baseline_runs` for more stable medians

**Budget exceeded on matrix jobs**

- `budget_per_job_seconds` applies to each matrix entry independently
- Matrix jobs with different OS/Node versions may have different speeds

**False positive on first PR after dependency update**

- Dependency installs may be slower with a cold cache
- Use `mode: warn` initially and switch to `fail` once baselines stabilize

## Examples

See [`examples/ci-minutes-demo/`](../../examples/ci-minutes-demo/) for working demo workflows showing fast and slow patterns.
