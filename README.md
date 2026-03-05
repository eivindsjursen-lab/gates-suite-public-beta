# CI Efficiency Gates Suite

GitHub Actions that stop regressions at PR time:
fail when cache breaks, CI slows down, or agent permissions creep.

| Action                                                                 | One-liner                                                                | Tests |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----- |
| [**Cache Health Gate**](packages/cache-health-gate/)                   | Fail PR when Actions cache regresses (hit-rate, restore time, key churn) | 102   |
| [**CI Minutes Delta Gate**](packages/ci-minutes-gate/)                 | Fail PR when CI duration regresses (workflow, job, step ranking)         | 41    |
| [**Agent Permission Diff Gate**](packages/agent-permission-diff-gate/) | Fail PR when agent/tool capability scope expands without approval        | 65    |

**352 tests** across 28 test files (+ 144 in shared core). All gates share one output contract and reason-code model.

## Spec (source of truth)

[`docs/CI_Gates_All_In_One_v2_1.pdf`](docs/CI_Gates_All_In_One_v2_1.pdf)

If anything conflicts with the PDF, the PDF wins.

## Current Phase

### Status by product

- **Cache Health Gate** - Public Beta (active)
- **CI Minutes Delta Gate** - Planned / internal development
- **Agent Permission Diff Gate** - Planned / internal development

### Current focus (Cache Health Gate)

Current work is focused on:

- installation reliability
- clear PR comments and reason codes
- signal quality in real repositories
- docs-first tuning guidance

New feature work is intentionally deferred until Public Beta signal quality
is validated.

## Public Beta / Support

The suite is in mixed maturity, but **Cache Health Gate** is the current focus and is in **Public Beta**.

If this gate catches regressions for your team, open an issue with your repo context.

- **Feedback**: use the **"Early Access Feedback (Cache Health Gate)"** issue template and include:
  repo/workflow type, verdict, `reason_codes`, whether the verdict was correct, and whether you had to tune thresholds
- **Paid priority support / rollout help**: open an issue and label it `support`
- **Sponsor signal**: GitHub Sponsors (if available for your account/org) is the fastest way to signal demand

What we want most from early users right now:

- false positives / false negatives
- PR comment clarity (did it explain the issue and fix?)
- threshold tuning friction (did defaults work, or what needed tuning?)

## Cache Health Gate (Public Beta)

GitHub Action that detects **cache regressions in PRs** before merge.

It catches:

- cache hit-rate drops
- restore-time regressions
- cache key churn (for example accidental `${{ github.sha }}` in cache keys)

### Current phase

This action is currently in **Public Beta**.

### Works with

Validated in real PR workflows on:

- Node + pnpm
- Node + pnpm (matrix)
- Python + pip
- `actions/cache@v4`

Note: In larger or matrix-heavy repos, restore-time warnings may require tuning.
In dogfood + pilot testing so far, hit-rate regressions (`WARN_HIT_RATE_DROP`) have
been the strongest first signal to trust and investigate.

### Onboarding behavior (expected)

On a fresh repo, you will usually see:

- `WARN_NO_BASELINE` (or low confidence)
- `SKIP_NO_BASELINE` if `no_baseline_behavior=skip`

This is expected. The gate builds a baseline from **successful runs on the default branch** (same workflow), then becomes more useful after a few runs.

### Quick baseline tip

Make sure your workflow runs on `push` to the default branch (for example `main`) so baseline samples can be collected.

### Feedback

- repo type (Node/Python/matrix/monorepo)
- whether install worked without help
- whether the warning was useful or noisy

## Repo layout

```
.github/
  workflows/          # ci.yml, release.yml, smoke-{cache,minutes,permissions}.yml
  ISSUE_TEMPLATE/     # feature.yml, bug.yml, refactor.yml
  pull_request_template.md
  CODEOWNERS
packages/
  core/               # Shared: API client, baseline engine, stats, report renderer, reason codes
  cache-health-gate/  # Token parser, timing association, metrics, policy, action wrapper
  ci-minutes-gate/    # Duration analyzer, regression detection, budget enforcement, action wrapper
  agent-permission-diff-gate/  # YAML parser, capability model, diff engine, risk scoring, action wrapper
examples/
  cache-good-bad/           # Good vs. broken cache workflow demos
  ci-minutes-demo/          # Fast vs. slow CI workflow demos
  permission-diff-demo/     # Safe vs. risky MCP config demos + allowlist
scripts/
  check-dist.js       # Verify committed dist matches source
  release.sh          # Blessed release path
docs/
  troubleshooting/    # Common issues and reason-code diagnostics
```

## Prerequisites

- **Node 20** (see `.nvmrc`)
- **pnpm >= 10** (see `package.json#packageManager`)

```bash
nvm use          # or nvm install 20
corepack enable  # enables pnpm via packageManager field
```

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

Run the full CI gate locally before pushing:

```bash
pnpm ci:local
```

Small, focused PRs. One feature or one bugfix per PR.
See `CONTRIBUTING.md` for contribution rules and local check expectations.

CI is the judge: **format → lint → typecheck → test → build → verify-dist** must be green.

Cost control defaults in this repo:

- CI runs automatically on `pull_request` (not on every `push` to `main`)
- CI quality checks run in one job (single install) to avoid repeated runner setup cost
- Cache smoke is PR-path scoped and minutes/permissions smoke are manual (`workflow_dispatch`)
- Smoke jobs keep runtime minimal (no unnecessary `pnpm install`)
- Prefer local `pnpm ci:local` before pushing to reduce GitHub Actions minutes

## Architecture

### Core (`packages/core/`)

The shared foundation used by all three gates:

- **GitHub API client** — Octokit wrapper with exponential backoff, retry on 429/5xx, abuse detection, permission-denied handling, API call budget tracking
- **Baseline engine** — Fetches recent successful runs, filters by window/event/workflow, computes confidence based on sample count, variance (CV), and data completeness
- **Statistics** — `median`, `percentile`, `coefficientOfVariation`, `deltaPct`
- **Report renderer** — Markdown Job Summary in "What changed / So what / Now what" format
- **Output dispatcher** — Job Summary (always), PR comment (best-effort), action outputs, exit code
- **Reason codes** — 26 shared codes (`PASS_*`, `WARN_*`, `FAIL_*`, `SKIP_*`) with prescriptive messages
- **Schema** — Zod-validated `GateResult` shape (Appendix B of blueprint)

### Cache Health Gate (`packages/cache-health-gate/`)

- **Token parser** — `[cache]` and `[cache-step]` step-name grammar (Appendix A)
- **Timing association** — Nearest-preceding cache-step matching by `(job, group)`
- **Metrics** — `hit_rate`, `restore_ms` (p50), `key_churn` per group
- **Policy** — Hit rate drop, restore regression, hard limit, key churn thresholds
- **Degrade ladder** — No cache → SKIP; no baseline → configurable; low confidence → WARN

### CI Minutes Delta Gate (`packages/ci-minutes-gate/`)

- **Duration analyzer** — Workflow/job/step durations with top-contributor ranking
- **Regression detection** — Median baseline comparison with configurable threshold
- **Budget enforcement** — Total workflow + per-job time limits
- **Policy** — Regression + budget violations with combined reason codes

### Agent Permission Diff Gate (`packages/agent-permission-diff-gate/`)

- **YAML parser** — Auto-detects workflow, MCP, and agent config file formats
- **Capability model** — 15 capabilities across 4 risk levels (low → critical)
- **Heuristic inference** — 20+ patterns mapping actions/MCP servers to capabilities
- **Diff engine** — Set diff of `(tool, capability)` pairs with upgrade detection
- **Policy** — 3 levels (lenient/standard/strict), approval label override, allowlist
- **Confidence** — Based on explicit vs. heuristic ratio

## Output contract

All gates share one output contract (consistent demos, docs, integrations):

- **Job Summary** — always (headline verdict, top regressions, causes, fixes)
- **PR Comment** — best-effort only (never fail if posting is blocked)
- **Action outputs** — `result`, `confidence`, `reason_codes`, `baseline_samples`
  (Permission gate also outputs `findings_count`)

Standard result shape (`GateResult`): `result`, `confidence`, `reason_codes`,
`baseline_samples`, `top_regressions`, `top_findings`, `fix_suggestions`.

V1 supports `baseline_mode: api` only. Artifact/repo modes planned for v2.

## Release model

Per-action tags in this monorepo use a prefix:

- version tag: `cache-health-gate/v1.0.0`
- floating major tag: `cache-health-gate/v1`
- initial internal baseline: `0.1.0-alpha.1` (workspace/package metadata)

Cache Health Gate install example:

```yaml
uses: eivindsjursen-lab/gates-suite-public-beta/packages/cache-health-gate@cache-health-gate/v1
```

`dist/` is committed in PRs before merge. Release workflows verify dist —
they never regenerate it.

For public beta onboarding and pilot-safe references, use:

- `docs/launch/non-assisted-quickstart.md` (primary self-serve flow)
- `docs/troubleshooting/common-issues.md` (symptom-based fixes)
- `docs/launch/public-pilot-gist/README-pilot.md` (public pilot overview)
- `docs/launch/public-pilot-gist/PERMISSIONS.md` (data use + minimum permissions)
- `docs/launch/public-pilot-gist/ROLLBACK.md` (fast off-ramp)
- `docs/launch/public-pilot-gist/report-example.md` (output format example)

Changesets is configured for monorepo versioning metadata:

```bash
pnpm changeset           # add a changeset entry
pnpm changeset:status    # inspect pending releases
pnpm changeset:version   # apply version bumps from changesets
```

Release notes are tracked in:

- `CHANGELOG.md`

## Locked decisions

- Monorepo with shared core + three action packages
- TypeScript + Node 20, pnpm workspaces, committed dist
- Release: dist committed in PRs, never generated by release workflow
- Default onboarding: `mode=warn` for all gates
- Baseline: success-only, same workflow_id, default branch, push events
- Output: Job Summary always; PR comment best-effort; never fail on comment block
- Reason codes required for all PASS/WARN/FAIL/SKIPPED paths

## Open decisions

- Scope of V1 policy packs for Permission Diff Gate
- Plugin scope beyond Cache Health in V1.x (Artifact Bloat, Dependency Install)
