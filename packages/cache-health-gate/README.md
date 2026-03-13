# Cache Health Gate

> Fail (or warn) PRs when GitHub Actions cache regresses: hit-rate drops, restore time spikes, or key churn grows.

## Quick Start

Add two instrumentation steps to each cached operation in your workflow, then add the gate as a final step:

```yaml
steps:
  # 1. Mark the cache step for timing
  - name: "[cache-step] group=deps"
    id: deps_cache
    uses: actions/cache@v4
    with:
      path: ~/.pnpm-store
      key: pnpm-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}

  # 2. Emit the cache token
  - name: "[cache] group=deps hit=${{ steps.deps_cache.outputs.cache-hit }} key_fp=${{ hashFiles('pnpm-lock.yaml') }} key_hint=pnpm"
    run: echo "cache token emitted"

  # ... your build/test steps ...

  # 3. Run the gate
  - name: Cache Health Gate
    uses: ./.github/actions/cache-health-gate
    with:
      mode: warn
```

## Primary Install Path (Non-Assisted Alpha)

Use the **local vendored bundle** as the default path in non-assisted alpha.
This avoids private cross-repo access failures and keeps rollback simple.

1. Copy pilot bundle files into your repo:
   - `.github/actions/cache-health-gate/action.yml`
   - `.github/actions/cache-health-gate/dist/*`
2. Use the local action path:

```yaml
- name: Cache Health Gate
  uses: ./.github/actions/cache-health-gate
```

3. Follow the zero-assistance flow:
   - `docs/launch/non-assisted-quickstart.md`

## Other Install Paths (Advanced)

Use these only when distribution/access is known to be correct.

### A) Public action ref (public soft launch / later)

Use this when the action repository is public and the tag is accessible from the
target repository.

```yaml
- name: Cache Health Gate
  uses: eivindsjursen-lab/gates-suite/packages/cache-health-gate@cache-health-gate/v1
```

### B) Private shared action repo (same org / explicit access)

Use this only when the target repository can access the private action
repository (for example within the same org with the right settings).

If the target repo does **not** have access, GitHub Actions will fail during
job setup with an error like:

- `repository not found`

## Quickstart Profiles (copy/paste)

Use one of these as your starting point, then tune only if needed.

### Profile A — First Try (minimal / low-friction)

Use this first in most repos.

```yaml
- name: Cache Health Gate
  uses: ./.github/actions/cache-health-gate
  with:
    mode: warn
    no_baseline_behavior: warn
    baseline_event_filter: push
```

What this does:

- avoids blocking onboarding (`mode=warn`)
- shows `WARN_NO_BASELINE` instead of failing on day 1
- builds baseline from successful default-branch `push` runs

### Profile B — Matrix / package-heavy repos (recommended tuning start)

Use this when CI is noisier (matrix builds, larger dependency installs, longer restore times).

```yaml
- name: Cache Health Gate
  uses: ./.github/actions/cache-health-gate
  with:
    mode: warn
    no_baseline_behavior: warn
    baseline_runs: "10"
    baseline_event_filter: push
    thresholds_restore_regression_pct: "35"
```

What this changes:

- larger baseline window for more stable comparisons
- less sensitive restore warning threshold (higher value = less sensitive)
- still treats `WARN_HIT_RATE_DROP` as the strongest first signal

## Install Validation Checklist (2-5 minutes)

Use this to confirm the gate is wired correctly before tuning anything.

1. First run shows `WARN_NO_BASELINE` or `SKIP_NO_BASELINE` (expected).
2. Workflow runs on `push` to your default branch (`main`/`master`) so baseline can build.
3. After 5-10 successful `push` runs, `BASELINE_SAMPLES` is > 0 and confidence improves.
4. A controlled bad PR (cache key churn, e.g. `${{ github.sha }}` in key) produces `WARN_HIT_RATE_DROP`.
5. PR comment explains what changed and what to fix (key composition should usually be the first suggestion).

## 2-minute test (recommended)

Use this to verify the action gives a useful signal quickly.

1. Enable the gate in **warn mode** in your CI workflow.
2. Run the workflow on your default branch (`main`) a few times to build a baseline.
3. Open a PR with an intentionally bad cache key (example below).
4. Confirm the PR gets a warning with a clear explanation.

Expected onboarding:

- first runs may show `WARN_NO_BASELINE`
- this is normal until enough successful baseline runs exist

## What to expect in real repos

On the first runs, the action will often return:

- `WARN_NO_BASELINE` (default `no_baseline_behavior=warn`)
- `SKIP_NO_BASELINE` (if `no_baseline_behavior=skip`)
- `CONFIDENCE=low`

This is expected. The gate needs a baseline from successful runs on the default
branch before comparisons become meaningful.

### Known pattern in larger or matrix-heavy repos

In real-world repos (especially matrix builds or package-heavy workflows), you
may sometimes see:

- `WARN_RESTORE_REGRESSION`
- `CONFIDENCE=high`

...even when nothing is “wrong” with your cache setup.

This is usually caused by normal runtime variance, for example:

- GitHub-hosted runner load variance
- network / registry response-time variance
- matrix-job timing spread
- cache archive size/compression overhead
- small lockfile/path changes that still preserve good cache behavior

Treat this as a **tuning signal first**, not a product bug.

In our private alpha so far, `WARN_HIT_RATE_DROP` has been the most reliable
first signal to trust and investigate for dependency-cache style workflows
such as `npm`, `pnpm`, `pip`, and package-manager caches backed by
`actions/cache`.

For Docker/buildx-style local build caches, a controlled bad case may instead
surface first as `WARN_RESTORE_REGRESSION`. Treat that as a valid profile
shape, not automatically as a broken install.

## Bad vs Good Cache Key Examples

### Bad example (causes cache churn)

```yaml
- name: Cache dependencies
  uses: actions/cache@v4
  with:
    path: ~/.pnpm-store
    key: pnpm-${{ runner.os }}-${{ github.sha }}-${{ hashFiles('**/pnpm-lock.yaml') }}
```

Why this is bad:

- `${{ github.sha }}` changes every commit
- cache keys churn across runs
- hit-rate drops and CI gets slower

### Better example (stable key)

```yaml
- name: Cache dependencies
  uses: actions/cache@v4
  with:
    path: ~/.pnpm-store
    key: pnpm-${{ runner.os }}-${{ hashFiles('**/pnpm-lock.yaml') }}
    restore-keys: |
      pnpm-${{ runner.os }}-
```

## Tuning guide for noisy repos (matrix / package-heavy)

If your repo often shows `WARN_RESTORE_REGRESSION` on "good" runs, use this
sequence before changing product code.

### 1) Confirm cache key stability

Make sure your cache key is stable across normal runs.

**Avoid** volatile values like:

- `${{ github.sha }}`
- `${{ github.run_id }}`
- `${{ github.run_attempt }}`

Use stable inputs such as:

- runner OS
- lockfile hash
- package manager version (optional)
- relevant matrix dimensions (only if needed)

### 2) Use restore keys

Always provide `restore-keys` when possible so partial hits are still useful.

This improves hit behavior and makes the gate output more actionable.

### 3) Build a bigger baseline

For noisy repos, use a larger baseline window before judging the warnings.

Recommended:

- at least **5 runs** for first signal
- preferably **8-10 runs** for matrix/package-heavy workflows

### 4) Start in warn mode

Keep the gate in `mode=warn` during onboarding and alpha rollout.

This lets teams learn the signal quality before enforcing failures.

### 5) Tune restore-warning thresholds per repo

If hit-rate signals are good but restore warnings are too noisy, increase
`thresholds_restore_regression_pct` for that repo (**higher value = less
sensitive warning**).

Use docs/tuning first. Do not tighten to `fail` mode until you trust the
signal.

### 6) Re-evaluate over a week

Watch the trend for a few days (or ~10 baseline runs), then decide:

- keep thresholds
- tune thresholds
- move to stricter policy

## Suggested rollout profiles

### Profile A — Small / steady repos (strict later)

Use this if your CI is simple and stable (single runtime, low variance).

- `mode: warn` (initially)
- baseline: 5 successful default-branch runs
- trust both hit-rate and restore-time signals early
- move to stricter policy after a few clean PRs

### Profile B — Matrix / package-heavy repos (recommended default)

Use this if you run a matrix (for example Node 20/22) or package installs are
noisy.

- `mode: warn`
- baseline: 8-10 successful default-branch runs
- treat `WARN_HIT_RATE_DROP` as the primary signal
- treat `WARN_RESTORE_REGRESSION` as tuning guidance first
- tune restore thresholds before enabling stricter enforcement

### Profile C — Docker/buildx / local build-cache repos

Use this if your workflow restores local build caches for Docker/Buildx or
similar heavy build artifacts.

- `mode: warn`
- baseline: prefer 8-10 successful default-branch runs
- expect restore-time signals to be more informative than hit-rate early on
- treat `WARN_RESTORE_REGRESSION` as a valid first signal for this profile
- confirm summaries still point back to the affected cache group(s)
- do not assume missing `WARN_HIT_RATE_DROP` means the gate is broken

## Inputs

| Input                               | Default               | Description                                        |
| ----------------------------------- | --------------------- | -------------------------------------------------- |
| `token`                             | `${{ github.token }}` | GitHub token for API access                        |
| `mode`                              | `warn`                | Gate mode: `warn` or `fail`                        |
| `baseline_runs`                     | `10`                  | Number of baseline runs to fetch                   |
| `baseline_window_days`              | `14`                  | Look-back window in days                           |
| `baseline_event_filter`             | `push`                | Event type filter for baseline runs                |
| `no_baseline_behavior`              | `warn`                | Behavior when no baseline exists: `warn` or `skip` |
| `thresholds_hit_rate_drop_pct`      | `5`                   | Hit rate drop threshold (percentage points)        |
| `thresholds_restore_regression_pct` | `20`                  | Restore time regression threshold (percent)        |
| `thresholds_restore_hard_ms`        | `30000`               | Absolute restore time limit (ms)                   |
| `api_budget_calls`                  | `30`                  | Maximum GitHub API calls per run                   |
| `debug`                             | `false`               | Enable verbose diagnostics in step logs            |

## Outputs

| Output             | Description                                        |
| ------------------ | -------------------------------------------------- |
| `result`           | Gate verdict: `pass`, `warn`, `fail`, or `skipped` |
| `confidence`       | Confidence level: `low`, `med`, or `high`          |
| `reason_codes`     | JSON array of machine-readable reason codes        |
| `baseline_samples` | Number of baseline samples used                    |

## How It Works

1. **Parse** — Scans workflow job steps for `[cache]` tokens and `[cache-step]` timing markers
2. **Associate** — Links each token to its nearest preceding cache-step marker by `(job, group)`
3. **Compute** — Calculates per-group metrics: hit rate, restore time (p50), key churn
4. **Baseline** — Fetches recent successful runs from the default branch for comparison
5. **Evaluate** — Applies policy thresholds with a degrade ladder (see below)
6. **Report** — Renders a "What changed / So what / Now what" Job Summary

## Token Grammar

Steps follow the format from Appendix A:

```
[cache] group=<name> hit=<true|false> key_fp=<fingerprint> [key_hint=<label>]
[cache-step] group=<name>
```

Values are URL-encoded. Keys must match `[a-zA-Z0-9_]+`.

## Metrics

| Metric       | Formula                             | Description                                 |
| ------------ | ----------------------------------- | ------------------------------------------- |
| `hit_rate`   | hits / restore_attempts             | Per-group exact hit rate                    |
| `restore_ms` | p50 of timing durations             | Median restore time from cache-step markers |
| `key_churn`  | distinct_key_fps / restore_attempts | How often the cache key changes             |

## Degrade Ladder

The gate follows a strict degrade ladder to avoid false-positive failures:

1. **No cache tokens** → `SKIP_NO_CACHE_DETECTED`
2. **No baseline** → `noBaselineBehavior` setting (`warn` or `skip`)
3. **Confidence < med** → any `FAIL_*` degrades to `WARN_*`
4. **mode=warn** → all `FAIL_*` verdicts degrade to `WARN_*`
5. **mode=fail + confidence >= med** → `FAIL_*` verdicts cause non-zero exit

## Reason Codes

| Code                              | Severity | Meaning                                     |
| --------------------------------- | -------- | ------------------------------------------- |
| `PASS_ALL_CLEAR`                  | pass     | All checks passed                           |
| `FAIL_HIT_RATE_DROP`              | fail     | Hit rate dropped beyond threshold           |
| `FAIL_RESTORE_REGRESSION`         | fail     | Restore time regressed beyond threshold     |
| `WARN_HIT_RATE_DROP`              | warn     | Hit rate dropped (degraded from FAIL)       |
| `WARN_RESTORE_REGRESSION`         | warn     | Restore time regressed (degraded from FAIL) |
| `WARN_KEY_CHURN`                  | warn     | High key churn detected                     |
| `WARN_DUPLICATE_CACHE_STEP_GROUP` | warn     | Multiple cache-step markers for same group  |
| `SKIP_NO_CACHE_DETECTED`          | skip     | No cache tokens found in workflow           |
| `SKIP_NO_BASELINE`                | skip     | No baseline runs available                  |

## Troubleshooting

**`uses: owner/repo/path@tag` fails with `repository not found`**

- This usually means the action repository is private and the target repository
  does not have access.
- For Private Alpha, prefer the **local vendored bundle** install path above.
- If you are testing cross-repo inside the same org, verify repository access
  and Actions permissions first.

**Gate always returns SKIP_NO_CACHE_DETECTED**

- Ensure your workflow has steps named `[cache] group=...` and `[cache-step] group=...`
- The gate scans step names, not step IDs
- For extra diagnostics while onboarding, set `debug: true` and inspect the step logs for parsed token/marker counts.

**Gate returns WARN_NO_BASELINE on first run**

- The gate needs successful push-event runs on the default branch to build a baseline
- After a few merges to main, the baseline will populate automatically
- Make sure the workflow runs on `push` to your default branch (for example `main`)
- If you set `no_baseline_behavior: skip`, expect `SKIP_NO_BASELINE` instead of `WARN_NO_BASELINE`
- If needed, set `debug: true` to print baseline run IDs and cache-baseline coverage details.

**Good runs still show WARN_RESTORE_REGRESSION (sometimes with high confidence)**

- This can happen in larger or matrix-heavy repos due to runtime variance
- Treat it as a tuning signal first: check key stability, add/verify `restore-keys`, and build a larger baseline (8-10 runs)
- In private alpha so far, `WARN_HIT_RATE_DROP` has been the most reliable first signal to trust

**Hit rate drops on every PR**

- Check if cache keys include PR-specific values (branch name, PR number)
- Use only deterministic inputs: lockfile hash, OS, node version

**High key churn warning**

- Review if volatile inputs (timestamps, random values, run IDs) are in the cache key
- The `key_fp` field should only change when actual dependencies change

## Examples

See [`examples/cache-good-bad/`](../../examples/cache-good-bad/) for working demo workflows showing healthy and broken cache patterns.
