# Node 24 Migration Task

Context:

- GitHub Actions is deprecating Node.js 20 for JavaScript actions.
- Runner warning observed in `cvat-cache-alpha` sanity run:
  - `actions/checkout@v4`
  - `eivindsjursen-lab/gates-suite-public-beta/packages/cache-health-gate@cache-health-gate/v1`
- GitHub warning states Node 24 becomes the default runtime on June 2, 2026.

Scope:

- `packages/cache-health-gate/action.yml`
- `packages/ci-minutes-gate/action.yml`
- `packages/agent-permission-diff-gate/action.yml`

Required change:

- update `runs.using` from `node20` to `node24`

Validation:

1. Run `pnpm ci:local`
2. Rebuild committed `dist/`
3. Run one real GitHub Actions sanity check for `cache-health-gate`
4. Confirm no runtime regressions in summary, outputs, or PR comment behavior

Notes:

- This is maintenance work, not product hardening.
- Do not combine with unrelated policy or docs changes.
