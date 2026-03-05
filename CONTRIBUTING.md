# Contributing

Thanks for contributing to `gates-suite`.

## Scope and Expectations

- Keep PRs small and focused.
- Do not change public contracts (inputs, outputs, reason codes, schema) without
  explicit rationale and corresponding docs/tests updates.
- During Public Beta, prioritize reliability, clarity, and onboarding over new
  feature scope.

For agent-specific contribution rules, see `.github/AGENTS.md`.

## Local Setup

Requirements:

- Node 20 (`.nvmrc`)
- pnpm 10+

```bash
nvm use
corepack enable
pnpm install
```

## Required Checks

Run before opening a PR:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify-dist
```

Or run all in one command:

```bash
pnpm ci:local
```

## Pull Request Requirements

- Describe what changed and why.
- Note compatibility impact for any contract-sensitive change.
- Update docs when user-facing behavior changes.
- Commit `dist/` changes for action packages in the same PR.

CI is authoritative: PRs merge only when checks are green.
