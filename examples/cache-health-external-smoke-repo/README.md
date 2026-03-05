# Cache Health Gate External Smoke Repo (Minimal)

This folder is a template for a separate test repo used to validate the first release of `Cache Health Gate` in a real GitHub Actions context.

Goal: prove a new user can copy/paste one workflow, trigger one "good" branch and one "bad" branch, and understand the gate output within 60 seconds.

Use this as an operator checklist, not a polished demo.

## What to create externally

Create a new repo (for example `cache-health-gate-smoke`) and copy these files:

- `.github/workflows/cache-smoke.yml` from this folder
- `pnpm-lock.yaml` from your project (or any stable lockfile; only used as a deterministic cache-key input)

## Branch plan (brutal + minimal)

- `good` branch: keep the stable cache key (default in the template)
- `bad` branch: change the cache key to include `${{ github.sha }}` (diff shown below)

Expected outcome:

- `good` branch builds baseline and then trends toward stable cache behavior
- `bad` branch causes key churn / misses and should produce actionable warnings/failures

## Baseline protocol (important)

Do this in this order, otherwise you will mostly test `WARN_NO_BASELINE`:

1. Create repo + add workflow on `main`
2. Push `main` 3-5 times (or use `workflow_dispatch`) to build baseline samples
3. Confirm gate stops returning `WARN_NO_BASELINE` on `main`
4. Create `bad` branch with the cache-killer diff below
5. Open PR: `bad -> main`
6. Evaluate the PR summary/comment for clarity and fix quality

If you skip step 2, you are testing degrade behavior, not product value.

## Pass / fail criteria (first external smoke)

Pass if all are true:

- Verdict matches reality (`warn`/`fail` only on the bad branch/PR)
- Output clearly explains what changed (hit-rate drop / key churn)
- Output includes at least one fix suggestion the user can apply immediately
- No irrelevant warnings in the good branch after baseline exists

Fail (needs polish before wider posting) if any are true:

- Bad PR returns `pass`
- Good branch regularly returns `warn`/`fail` after baseline is established
- Message is technically correct but not understandable in <60 seconds
- Suggested fix is vague ("improve cache") instead of concrete ("remove `${{ github.sha }}` from key")

## What to capture (signal log)

For each repo/test, record:

- repo URL + type (toy repo / OSS fork / monorepo)
- workflow shape (single job / matrix / multiple cache groups)
- baseline setup friction (none / minor / blocked)
- verdict correctness (correct / false positive / false negative)
- top confusion point (if any)

A template is included in `signal-log-template.md`.

## Bad-branch diff (the only change you need)

In `.github/workflows/cache-smoke.yml`, change:

```yaml
key: deps-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}
```

to:

```yaml
key: deps-${{ runner.os }}-${{ github.sha }}-${{ hashFiles('pnpm-lock.yaml') }}
```

And change:

```yaml
- name: "[cache] group=deps hit=${{ steps.deps_cache.outputs.cache-hit }} key_fp=${{ hashFiles('pnpm-lock.yaml') }} key_hint=deps"
```

to:

```yaml
- name: "[cache] group=deps hit=${{ steps.deps_cache.outputs.cache-hit }} key_fp=${{ github.sha }}-${{ hashFiles('pnpm-lock.yaml') }} key_hint=deps"
```

## Copy/paste install target

The workflow references the released action by prefixed major tag:

`eivindsjursen-lab/gates-suite/packages/cache-health-gate@cache-health-gate/v1`

## First week operator loop (recommended)

1. Run this smoke repo and capture one screenshot of a useful bad-PR result
2. Dogfood in 1-2 real repos (own fork is enough)
3. Log friction and false positives in `signal-log-template.md`
4. Adjust wording/thresholds/docs before broader posting
