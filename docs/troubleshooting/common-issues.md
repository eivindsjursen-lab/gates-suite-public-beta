# Troubleshooting Guide

Common issues and solutions for CI Efficiency Gates.

## SKIP_NO_BASELINE — "No baseline runs found"

**Symptom:** Gate skips with `SKIP_NO_BASELINE` on every PR.

**Causes:**

1. The workflow has never run on the default branch with `push` events.
2. `baseline_window_days` is too short for the repository's merge frequency.
3. `GITHUB_WORKFLOW_REF` is not available (very old runner images).

**Fix:**

- Ensure your workflow triggers on `push` to the default branch.
- Increase `baseline_window_days` (default: 14).
- After merging a PR, wait for one push-triggered run to complete.

## SKIP_PERMISSION_DENIED — "Insufficient permissions"

**Symptom:** Gate skips with `SKIP_PERMISSION_DENIED`.

**Causes:**

1. The `GITHUB_TOKEN` lacks `actions: read` permission.
2. Fork PRs have restricted token scope.
3. The repository's Actions settings limit token permissions.

**Fix:**

```yaml
permissions:
  contents: read
  actions: read
  pull-requests: write # for PR comments
```

For fork PRs, consider using `pull_request_target` with caution.

## SKIP_API_BUDGET_EXHAUSTED — "API budget exhausted"

**Symptom:** Gate skips partway through analysis.

**Causes:**

1. `api_budget_calls` is too low for the number of baseline runs.
2. Matrix workflows with many jobs consume more API calls.

**Fix:**

- Increase `api_budget_calls` (default: 30).
- Reduce `baseline_runs` to fetch fewer historical runs.

## SKIP_GITHUB_ABUSE_LIMIT — "Abuse detection triggered"

**Symptom:** Gate skips with abuse detection error.

**Cause:** Too many API calls in a short window (GitHub secondary rate limit).

**Fix:**

- Reduce `baseline_runs` and `api_budget_calls`.
- Add delays between gate runs in matrix workflows.
- This is transient — retrying usually works.

## Empty Job Summary — no markdown output

**Symptom:** The workflow step succeeds but Job Summary is blank.

**Causes:**

1. The action crashed before reaching `dispatchOutput`.
2. `GITHUB_STEP_SUMMARY` is not writable (very rare).

**Fix:**

- Check the step logs for errors before the summary write.
- Ensure the runner image supports `GITHUB_STEP_SUMMARY`.

## Need deeper diagnostics during pilot onboarding

If verdicts are hard to interpret during setup, enable debug mode temporarily:

```yaml
with:
  debug: "true"
```

Debug mode logs:

- baseline run IDs selected for analysis
- parsed cache token / cache-step marker counts
- cache-baseline coverage and confidence downgrade details

Turn debug back off after onboarding to keep logs concise.

## Cache Health Gate: SKIP_NO_CACHE_DETECTED

**Symptom:** Cache gate always skips.

**Cause:** Workflow steps don't include `[cache]` or `[cache-step]` markers
in their step names.

**Fix:**

Name your cache steps using the token grammar:

```yaml
- name: "[cache] group=deps&hit=${{ steps.cache.outputs.cache-hit }}&key_fp=${{ hashFiles('**/pnpm-lock.yaml') }}"
  run: echo "cache marker"
```

See the [Cache Health Gate README](../../packages/cache-health-gate/README.md) for details.

## Cache Health Gate: "repository not found" when using `uses: owner/repo/path@tag`

**Symptom:** The workflow fails during job setup before the gate step runs, with
an error like `repository not found`.

**Cause:** The action repository is private, and the target repository does not
have access to use the action by cross-repo reference.

**Fix (Private Alpha recommended path):**

- Vendor the action locally in the target repo:
  - `.github/actions/cache-health-gate/action.yml`
  - `.github/actions/cache-health-gate/dist/*`
- Use a local action reference:

```yaml
- name: Cache Health Gate
  uses: ./.github/actions/cache-health-gate
```

**Alternative (same org / shared private repo):**

- Ensure the target repository is allowed to access the private action repo.
- Confirm workflow permissions and org/repo Actions settings allow private action
  reuse.

## Cache Health Gate: small repo calibration (noise in smoke/toy workflows)

**Symptom:** A stable `main` workflow still reports cache warnings (often
`WARN_RESTORE_REGRESSION`) in a very small repo or minimal smoke fixture.

**Why this happens:**

- Small caches and short workflows amplify runner timing variance.
- Early runs have limited baseline history (`BASELINE_SAMPLES` is low).
- Restore timing noise can look like a regression before the baseline settles.

This is common in smoke fixtures and toy repos. Treat it as a tuning problem
first, not a product bug by default.

### Recommended baseline setup (first run)

1. Enable the gate on a workflow that runs on `push` to the default branch.
2. Run the workflow on `main` 3-5 times (small commits are fine).
3. Wait until `WARN_NO_BASELINE` disappears.
4. Confirm outputs are meaningful:
   - `BASELINE_SAMPLES > 0`
   - `CONFIDENCE` is preferably `med` or `high`

Early behavior like `WARN_NO_BASELINE` and `CONFIDENCE=low` is expected until
history exists.

### Threshold tuning for small repos (start here)

Start with defaults. If a good/stable `main` still warns, tune workflow inputs
before changing product code.

First adjustment (most common):

- `thresholds_restore_regression_pct`

Example (minimal smoke fixture):

```yaml
with:
  thresholds_restore_regression_pct: "300"
```

This is a smoke-fixture calibration example, not a universal production default.

### Known pattern in real repos (larger / matrix / package-heavy)

In larger or matrix-heavy workflows, you may sometimes see:

- `WARN_RESTORE_REGRESSION`
- `CONFIDENCE=high`

...even when the cache setup is stable and healthy.

Common causes include:

- GitHub-hosted runner load variance
- network / package registry response-time variance
- matrix timing spread across jobs
- cache archive size / compression overhead
- small dependency or path changes that preserve good cache behavior but shift timing

Treat this as a **tuning signal first**, not a product bug.

In private alpha so far, `WARN_HIT_RATE_DROP` has been the most reliable first
signal to trust and investigate for dependency-cache style workflows.

For Docker/buildx-style local build caches, a controlled bad case may surface
first as `WARN_RESTORE_REGRESSION`. Treat that as a valid profile shape, then
check whether the summary still points back to the affected cache group.

### Tuning guide for noisy repos (matrix / package-heavy)

Use this sequence before changing product code or assuming a policy bug.

1. **Confirm cache key stability**
   - Avoid volatile values like `${{ github.sha }}`, `${{ github.run_id }}`, `${{ github.run_attempt }}`
   - Prefer stable inputs (OS, lockfile hash, package manager version, relevant matrix dimensions)
2. **Use `restore-keys`**
   - Partial hits are often still useful and improve signal quality
3. **Build a bigger baseline**
   - First useful signal: at least 5 runs
   - Noisy/matrix repos: prefer 8-10 runs
4. **Stay in `mode=warn` during onboarding**
   - Do not switch to stricter enforcement before you trust the signal
5. **Tune restore-warning sensitivity per repo**
   - Increase `thresholds_restore_regression_pct` if warnings are too noisy (**higher value = less sensitive warning**)
6. **Re-evaluate over time**
   - Recheck after ~1 week or ~10 baseline runs before tightening policy

### Suggested rollout profiles

**Profile A — Small / steady repos**

- `mode: warn` (initially)
- baseline: 5 successful default-branch runs
- trust both hit-rate and restore-time signals early
- tighten later after a few clean PRs

**Profile B — Matrix / package-heavy repos (recommended default)**

- `mode: warn`
- baseline: 8-10 successful default-branch runs
- treat `WARN_HIT_RATE_DROP` as primary signal
- treat `WARN_RESTORE_REGRESSION` as tuning guidance first
- tune restore thresholds before stricter enforcement

**Profile C — Docker/buildx / local build-cache repos**

- `mode: warn`
- baseline: prefer 8-10 successful default-branch runs
- expect restore-time signals to be more informative than hit-rate early on
- treat `WARN_RESTORE_REGRESSION` as a valid first signal for this profile
- confirm summaries still point back to the affected cache group(s)
- do not assume missing `WARN_HIT_RATE_DROP` means the gate is broken

### Good vs. bad smoke flow (recommended)

**Good case (`main`)**

- Run the workflow a few times to build baseline.
- Expected after baseline settles:
  - `RESULT=pass`
  - `REASON_CODES=["PASS_ALL_CLEAR"]`

**Bad case (PR)**

- Create a PR that intentionally destabilizes the cache key (for example, add
  `${{ github.sha }}` to cache `key` / `key_fp`).
- Expected:
  - `RESULT=warn` or `fail` (depending on policy)
  - reason codes pointing to cache regressions (for example hit-rate drop)

### Reading outputs during tuning

- `RESULT` — `pass` / `warn` / `fail` / `skipped`
- `CONFIDENCE` — `low` / `med` / `high`
- `BASELINE_SAMPLES` — number of historical runs used
- `REASON_CODES` — machine-readable explanation of the verdict

Quick interpretation:

- `WARN_NO_BASELINE` → not enough history yet
- `CONFIDENCE=low` → signal is weak; build more baseline before tuning
- `PASS_ALL_CLEAR` → no clear regression detected
- `WARN_*` → regression detected, but not a hard fail (or policy is `warn`)

### PR comments in smoke workflows

If you are testing PR comments in a smoke fixture, ensure the action receives the
PR number (for example `PR_NUMBER`) in addition to running under
`pull_request` context. Job Summary and outputs can still work without a PR
comment, but comment posting may be skipped if the PR number is missing.

## CI Minutes Gate: false regression on first run

**Symptom:** Gate reports regression on the first PR after enabling.

**Cause:** Insufficient baseline data leads to noisy comparisons.

**Fix:**

- Start with `mode: warn` (the default) to build baseline history.
- Wait for 5+ successful push-triggered runs before switching to `mode: fail`.
- The gate's confidence level accounts for this — `low` confidence degrades
  `FAIL` to `WARN` automatically.

## Permission Diff Gate: SKIP_UNSUPPORTED_FORMAT

**Symptom:** Gate skips when config files are present.

**Cause:** The YAML file doesn't match any recognized format (workflow, MCP
server config, or agent config).

**Fix:**

- Ensure config files use one of the supported structures.
- Check for YAML syntax errors (`yaml --check file.yml`).
- See the [Permission Diff README](../../packages/agent-permission-diff-gate/README.md)
  for supported formats.

## Permission Diff Gate: heuristic vs. explicit

**Symptom:** Gate warns about heuristic-only detection.

**Cause:** No explicit `permissions` or `capabilities` declarations found.
The gate inferred capabilities from action/tool names using pattern matching.

**Fix:**

Add explicit capability declarations to your config:

```yaml
servers:
  my-server:
    capabilities:
      - read.repo
      - exec.shell
```

This improves accuracy and raises confidence from "low" to "high".

## dist/ is stale — CI verify-dist fails

**Symptom:** `verify-dist` job fails with "dist/ is stale".

**Cause:** Source was changed but `pnpm build` output wasn't committed.

**Fix:**

```bash
pnpm build
git add packages/*/dist/
git commit --amend --no-edit
git push --force-with-lease
```

Always run `pnpm build` before pushing when you change source files.
