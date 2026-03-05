# Permissions and Data Use

## Recommended workflow permissions

Use these permissions in the pilot workflow:

- `contents: read`
- `actions: read`
- `pull-requests: write` (only needed for PR comments)

If `pull-requests: write` is unavailable, outputs and Job Summary still work. PR comments may be skipped best-effort.

## What the action reads

Using `GITHUB_TOKEN`, the action reads:

- workflow runs (baseline history)
- jobs for selected runs (cache markers and timings)

## What the action writes

- action outputs (`result`, `confidence`, `reason_codes`, `baseline_samples`)
- Job Summary markdown
- PR comment (best-effort if permissions + PR context allow)

## Privacy notes

- no third-party SaaS backend
- no external database
- no telemetry endpoint
- no long-lived API key beyond repository workflow token
