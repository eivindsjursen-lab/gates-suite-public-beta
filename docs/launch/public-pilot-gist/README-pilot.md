# Cache Health Gate - Pilot (Read-Only Docs)

This page explains the pilot setup and expected output for Cache Health Gate.

This is a low-risk GitHub Action pilot:

- runs in `mode: warn`
- uses only `GITHUB_TOKEN` against GitHub APIs
- no external SaaS backend
- easy rollback in 1-2 steps

## What it detects

- cache hit-rate drops
- cache key churn (for example accidental `${{ github.sha }}` in cache keys)
- restore-time regressions (can need tuning in noisy/matrix-heavy workflows)

## Primary pilot install path

For vendored/local deployment, use a local bundle in the target repo:

- `.github/actions/cache-health-gate/action.yml`
- `.github/actions/cache-health-gate/dist/*`

Then reference it in workflow:

```yaml
- name: Cache Health Gate
  uses: ./.github/actions/cache-health-gate
  with:
    mode: warn
    no_baseline_behavior: warn
    baseline_event_filter: push
```

## Expected onboarding behavior

On first runs, this is expected:

- `WARN_NO_BASELINE` (or `SKIP_NO_BASELINE` if configured)
- `CONFIDENCE=low`

After successful `push` runs on default branch, baseline stabilizes.

## Required instrumentation

If cache markers are missing, gate result will be:

- `SKIP_NO_CACHE_DETECTED`

You must add:

- one `[cache-step]` marker on cache restore step
- one `[cache]` token step after restore

## Definition of done

A pilot setup is considered valid when:

1. Workflow runs on `push` to default branch.
2. `BASELINE_SAMPLES > 0` after several successful runs.
3. A controlled bad PR (cache key churn) triggers `WARN_HIT_RATE_DROP`.
4. PR comment / Job Summary is clear enough to act on.

## Example output

See: `report-example.md`

## Permissions and rollback

- Permissions: `PERMISSIONS.md`
- Rollback: `ROLLBACK.md`

## Feedback requested

Please provide:

- install friction (1 easy - 5 hard)
- would keep enabled? (yes/no/maybe)
- needed manual tuning (none/light/medium/heavy)
- docs helped understand warning? (yes/no)
