<!-- cache-health-gate -->

## Cache Health Gate

**⚠️ WARN** · confidence: **med**

### What changed

| Scope | Name | Delta | Baseline | Current |
|------|------|------:|---------:|--------:|
| job | test | +35.2% | 2.0m | 2.7m |
| step | npm install | +80.0% | 30.0s | 54.0s |

### So what

- **WARN_RESTORE_REGRESSION**: Cache restore time increased compared to baseline. Monitor for sustained regression.
- **WARN_LOW_CONFIDENCE**: Analysis completed but confidence is low due to limited data or high variance. Results may not be representative.

Baseline: **8** samples from `main` (api mode, workflow 456)

### Now what

- Add restore-keys to the cache configuration
- Check for new dependencies inflating install time

### Feedback

- Report feedback/issues: `<your feedback link>`

---
*gates-suite/cache-health-gate · confidence: med · 8 baseline samples*
