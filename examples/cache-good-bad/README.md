# Cache Good vs. Bad — Demo Fixtures

Two contrasting workflows that show what Cache Health Gate detects.

## `good-workflow.yml`

A properly instrumented workflow with stable cache keys:

- **`[cache-step] group=deps`** — marks the `actions/cache@v4` step for timing
- **`[cache] group=deps hit=... key_fp=...`** — emits deterministic key fingerprint
- Key based only on `pnpm-lock.yaml` hash → stable across runs → high hit rate
- Gate result: **PASS**

## `bad-workflow.yml`

A broken workflow demonstrating common anti-patterns:

- Cache key includes `github.run_id` → changes every run → cache never hits
- Key fingerprint is volatile → high key churn
- Gate detects: **FAIL_HIT_RATE_DROP** + **WARN_KEY_CHURN**
- Fix: remove `run_id` from the cache key, use only deterministic inputs

## Usage

Copy either workflow into your `.github/workflows/` and adjust paths.
The gate step should run after all cache-instrumented steps complete.

```yaml
- name: Cache Health Gate
  uses: your-org/gates-suite/packages/cache-health-gate@v1
  with:
    mode: warn # or fail
```
