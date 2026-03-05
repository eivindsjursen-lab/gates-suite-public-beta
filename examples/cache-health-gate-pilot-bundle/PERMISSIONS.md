# Permissions and Data Use (Public Beta Pilot)

## Recommended workflow permissions

Use these workflow permissions for the beta workflow:

- `contents: read`
- `actions: read`
- `pull-requests: write` (only needed if you want PR comments)

If `pull-requests: write` is unavailable, the action can still provide outputs and Job Summary. PR comments may fail best-effort.

## What the action reads

Using the GitHub API (`GITHUB_TOKEN`), the action reads:

- workflow runs (for baseline history)
- jobs for selected runs (to parse cache markers and timings)

## What the action writes

- Action outputs (`result`, `confidence`, `reason_codes`, `baseline_samples`)
- Job Summary markdown
- PR comment (best-effort, if permissions and PR context are available)

## What it does not require

- no third-party SaaS account
- no external database
- no long-lived API key beyond the repo/workflow token

## Notes

- This pilot is designed for evaluation in `mode=warn`.
- Baseline is built from successful `push` runs on the default branch.
