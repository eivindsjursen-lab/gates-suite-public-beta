# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog and adapted for monorepo action
releases.

## [Unreleased]

### Added

- `debug` input for Cache Health Gate to print baseline/cache diagnostics during
  pilot onboarding.
- `CONTRIBUTING.md` for contributor workflow and required local checks.
- `.github/dependabot.yml` for weekly dependency and GitHub Actions updates.

### Changed

- Golden snapshots updated to match current summary wording and setup guidance.

## [0.1.0-alpha.1] - 2026-03-02

### Added

- Private Alpha hardening for Cache Health Gate:
  - self-baselining protection
  - cache-aware baseline confidence downgrade
  - improved setup guidance in summaries for no-cache/no-baseline states

### Notes

- This is a Private Alpha milestone, not a public GA release.
- Preferred install path for pilots remains the local vendored bundle.
