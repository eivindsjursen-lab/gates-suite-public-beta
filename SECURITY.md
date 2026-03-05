# Security Policy

## Scope

This repository contains GitHub Actions used for CI regression detection
(currently focused on Cache Health Gate in Public Beta).

## Reporting a Vulnerability

Please do **not** open a public issue for security-sensitive reports.

Report vulnerabilities by:

- opening a private support channel if already in pilot contact, or
- emailing the maintainer directly (preferred for beta pilot reports)

Include:

- affected action / version or tag
- reproduction steps
- expected vs actual behavior
- impact assessment (what could be read/written/executed)

We will acknowledge receipt and coordinate a fix before public disclosure.

## Data Access and Telemetry (Cache Health Gate)

### What the action reads (GitHub API via `GITHUB_TOKEN`)

| Data                               | Read? | Notes                                                     |
| ---------------------------------- | ----- | --------------------------------------------------------- |
| Workflow runs metadata             | Yes   | Used for baseline selection and comparisons               |
| Workflow job metadata / step names | Yes   | Used to parse cache markers and timings                   |
| Repository source code contents    | No    | The action does not fetch source files for cache analysis |
| Secrets values                     | No    | The action does not read or export secrets                |

### What the action writes

| Output                                                                             | Written?    | Notes                                          |
| ---------------------------------------------------------------------------------- | ----------- | ---------------------------------------------- |
| GitHub Action outputs (`result`, `confidence`, `reason_codes`, `baseline_samples`) | Yes         | For workflow consumption                       |
| Job Summary markdown                                                               | Yes         | Always written on successful dispatch path     |
| PR comment                                                                         | Best-effort | Only in PR context with `pull-requests: write` |

### Network / telemetry statement

- No third-party SaaS backend is used.
- No external telemetry service is used.
- Network calls are limited to the GitHub API using `GITHUB_TOKEN`.
- The action is designed to avoid logging secrets and does not intentionally
  transmit secrets outside GitHub.

## Recommended Permissions (Cache Health Gate)

Recommended workflow permissions:

- `contents: read`
- `actions: read`
- `pull-requests: write` (only if PR comments are desired)

If `pull-requests: write` is unavailable, the action should still provide
outputs and Job Summary, and PR comments degrade best-effort.

## Public Beta Notes

- Public beta users should prefer the published tag install path.
- Use the vendored local bundle only when cross-repo action usage is blocked.
- Keep the gate in `mode: warn` during initial rollout.
- Remove the workflow step/job to roll back quickly.
