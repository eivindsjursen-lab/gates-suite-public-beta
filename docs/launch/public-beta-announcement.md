# Public Beta Announcement (Cache Health Gate)

Copy/paste template for GitHub Discussions, Reddit, X, or Discord.

## Short version

Shipped **Cache Health Gate** (public beta): a GitHub Action that warns on cache regressions in PRs.

It detects:

- cache hit-rate drops (`WARN_HIT_RATE_DROP`)
- restore-time regressions
- cache key churn

It starts in `mode=warn`, posts a Job Summary (and PR comment best-effort), and is designed to be low-risk to try.

Install:

```yaml
uses: eivindsjursen-lab/gates-suite-public-beta/packages/cache-health-gate@cache-health-gate/v1
```

Quickstart + troubleshooting:

- `docs/launch/non-assisted-quickstart.md`
- `docs/troubleshooting/common-issues.md`

If you test it, please report feedback here:

- `issues/new?template=early-access-feedback.yml`

## Long version

I released **Cache Health Gate** in public beta.

Goal: catch CI cache regressions in PR review instead of discovering them later via slower pipelines.

What it flags:

- hit-rate drop
- restore-time regression
- cache key churn (for example accidental `${{ github.sha }}` in cache key)

Design choices:

- `mode=warn` by default (safe onboarding)
- no external backend required
- Job Summary always, PR comment best-effort
- clear reason codes + prescriptive fixes

Install ref:

```yaml
uses: eivindsjursen-lab/gates-suite-public-beta/packages/cache-health-gate@cache-health-gate/v1
```

I am specifically looking for feedback on:

1. install friction
2. signal vs noise
3. whether you would keep it enabled

Feedback template:

- `https://github.com/eivindsjursen-lab/gates-suite-public-beta/issues/new?template=early-access-feedback.yml`
