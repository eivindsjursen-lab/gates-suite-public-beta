# Development Notes (Maintainers)

This file is maintainer-oriented. Product-facing onboarding stays in `README.md`.

## Monorepo layout

```text
.github/
  workflows/          # ci.yml, release.yml
  ISSUE_TEMPLATE/     # feedback/bug/feature/refactor templates
packages/
  core/               # shared API client, baseline engine, report rendering, reason codes
  cache-health-gate/  # cache parser/metrics/policy/action wrapper
  ci-minutes-gate/    # planned/internal
  agent-permission-diff-gate/  # planned/internal
examples/
  cache-good-bad/
  ci-minutes-demo/
  permission-diff-demo/
scripts/
  check-dist.js       # verify committed dist matches source
  release.sh          # release helper
```

## Local prerequisites

- Node 20 (`.nvmrc`)
- pnpm 10+

```bash
nvm use
corepack enable
pnpm install
```

## Local quality gate

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify-dist
```

Or all at once:

```bash
pnpm ci:local
```

## Architecture summary

### Shared core (`packages/core`)

- GitHub API client with retry/backoff, permission/rate-limit handling
- Baseline engine (sample selection, confidence, window/event/workflow filtering)
- Statistics helpers and markdown report renderer
- Output dispatcher (summary always, PR comment best-effort)
- Reason code registry + zod result schema

### Cache Health Gate (`packages/cache-health-gate`)

- token parser for `[cache-step]` and `[cache]`
- timing association by `(job, group)`
- metrics: `hit_rate`, `restore_ms`, `key_churn`
- policy thresholds and degrade ladder

## Output contract

All gates use one output contract:

- Job Summary (always)
- PR comment (best-effort)
- outputs: `result`, `confidence`, `reason_codes`, `baseline_samples`

## Release model

Action tags (monorepo prefix model):

- version tag: `cache-health-gate/v1.0.0`
- floating major tag: `cache-health-gate/v1`

Rules:

- `dist/` is committed in PRs before merge
- release workflows verify dist; they do not regenerate dist

## Public beta constraints

- keep onboarding `mode=warn`
- docs/wording changes before policy tuning
- no feature creep without repeated cross-profile evidence
