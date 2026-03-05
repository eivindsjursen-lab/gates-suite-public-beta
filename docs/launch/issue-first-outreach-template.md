# Issue-First Outreach Template

Use this when approaching maintainers about cache/CI slowdown issues.

Rule: **comment first, PR only with consent**.

## 1) First comment (ask-first)

Thanks for the report. I built a small GitHub Action that checks for cache regressions in PRs (hit-rate drop / key churn / restore-time regression).

If useful, I can run it against a fork and share exact findings with a minimal `workflow_dispatch` pilot workflow.

If you want, I can open a PR that is easy to remove (single workflow file).

## 2) Follow-up with findings (no unsolicited PR)

I tested this on a fork and found:

- Result: `<pass|warn|fail|skipped>`
- Top reason codes: `<...>`
- Main recommendation: `<1-2 bullets>`

If you want, I can open a PR with:

- one pilot workflow (`workflow_dispatch`)
- `mode=warn`
- rollback note (delete one workflow file)

## 3) PR description template (only after maintainer says yes)

### What this PR adds

- Adds a minimal cache-regression pilot workflow (`workflow_dispatch`)
- Runs Cache Health Gate in warn mode only
- Adds no external service dependency

### Why

- Detect cache regressions early in PRs
- Provide structured output (`reason_codes`, summary) for faster triage

### Risk / rollback

- Low runtime risk; warn-only
- Rollback is deleting one workflow file

### Notes

- PR comments are best-effort depending on token/permissions
- Job Summary is always emitted
