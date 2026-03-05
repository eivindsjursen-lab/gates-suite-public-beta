# Actions v6 Compatibility Checklist

Purpose: validate and safely adopt `actions/checkout@v6` and
`actions/setup-node@v6` without breaking quality or onboarding.

## Scope

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- Any workflow docs/snippets that mention `checkout@v4` or `setup-node@v4`

## Change Plan

1. Create one focused PR for `checkout@v6` + `setup-node@v6`.
2. Update workflow action versions only (no unrelated refactors).
3. Run full quality checks in CI:
   - format
   - lint
   - typecheck
   - test
   - build
   - verify-dist
4. Run one manual smoke workflow after merge.
5. Update docs/examples if version references are shown.

## Pass Criteria

- CI job succeeds on PR and on `main` after merge.
- No regression in dependency cache behavior.
- No workflow permission regressions.
- No runtime/toolchain changes required for contributors.

## Failure / Rollback

- If any compatibility regression appears, revert the version bump commit.
- Keep v6 migration in a separate PR to make rollback fast.

## Out of Scope

- Marketplace changes
- Product logic changes
- Threshold/policy tuning
