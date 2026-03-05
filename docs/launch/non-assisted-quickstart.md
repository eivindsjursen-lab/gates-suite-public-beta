# Zero-Assistance Quickstart (Public Beta)

This guide is for running Cache Health Gate without live help.

## Primary install path (use this)

Use the public tag ref:

1. In workflow:

```yaml
- name: Cache Health Gate
  uses: eivindsjursen-lab/gates-suite-public-beta/packages/cache-health-gate@cache-health-gate/v1
  with:
    mode: warn
    no_baseline_behavior: warn
    baseline_event_filter: push
```

2. If your environment blocks cross-repo actions, use vendored fallback:
   - `.github/actions/cache-health-gate/action.yml`
   - `.github/actions/cache-health-gate/dist/*`
   - `uses: ./.github/actions/cache-health-gate`

## Required instrumentation

For each cache operation, add:

- one `[cache-step]` marker on the cache restore step
- one `[cache]` token step after restore

If these are missing, verdict will be:

- `SKIP_NO_CACHE_DETECTED`

This is setup-related, not a regression.

## What to expect on first runs

Expected during onboarding:

- `WARN_NO_BASELINE` or `SKIP_NO_BASELINE`
- `CONFIDENCE=low`

This is temporary until baseline is built.

## Success criteria (definition of done)

You are "set up correctly" when all of these are true:

1. Workflow runs on `push` to default branch.
2. After 5-10 successful `push` runs:
   - `BASELINE_SAMPLES > 0`
3. Controlled bad PR (cache key churn with `${{ github.sha }}`) yields:
   - `WARN_HIT_RATE_DROP`
4. PR comment/summary explains what changed and what to fix.

## If you are blocked

Use troubleshooting:

- `docs/troubleshooting/common-issues.md`

Most common blockers:

- `SKIP_NO_CACHE_DETECTED` (missing markers)
- `repository not found` (wrong install path/access)
- `WARN_NO_BASELINE` not clearing (no default-branch `push` history)

## Feedback (please report)

- Issue template:
  - `https://github.com/eivindsjursen-lab/gates-suite-public-beta/issues/new?template=early-access-feedback.yml`
