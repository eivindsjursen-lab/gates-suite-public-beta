# CI Minutes Demo — Fast vs. Slow

Two contrasting workflows that show what CI Minutes Delta Gate detects.

## `fast-workflow.yml`

A well-optimized workflow:

- Single job with cached dependencies
- Steps run sequentially within one job (minimal overhead)
- Gate result: **PASS** (within 15% of baseline)

## `slow-workflow.yml`

A slow workflow demonstrating common anti-patterns:

- **Sequential jobs** with unnecessary `needs:` dependencies
- **Duplicate `pnpm install`** in every job (no shared cache step)
- **No parallelism** — lint, typecheck, and test run one after another
- Gate detects: **FAIL_DURATION_REGRESSION** + **WARN_BUDGET_EXCEEDED**
- Fix: remove `needs:` chains, share installation via artifacts or cache

## Usage

Copy either workflow and adjust paths. The gate should run as a final step or job:

```yaml
- name: CI Minutes Gate
  if: always()
  uses: your-org/gates-suite/packages/ci-minutes-gate@v1
  with:
    mode: warn
    budget_total_seconds: "300"
```
