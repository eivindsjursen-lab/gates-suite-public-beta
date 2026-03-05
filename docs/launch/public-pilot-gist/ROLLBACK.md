# Rollback

Rollback is low-risk and takes 1-2 minutes.

## Remove pilot completely

Delete:

- `.github/workflows/cache-alpha.yml`
- `.github/actions/cache-health-gate/`

This disables future pilot runs immediately.

## Keep workflow but disable gate

If you want to keep workflow structure:

- remove/comment the `cache-gate` job, or
- remove/comment the `Run Cache Health Gate` step

## Impact scope

This affects CI workflow behavior only.
Application runtime code is unchanged.
