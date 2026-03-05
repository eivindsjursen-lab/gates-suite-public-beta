# Permission Diff Demo — Safe vs. Risky

Demonstrates the Agent Permission Diff Gate detecting capability escalation.

## `safe-config.yml`

An MCP configuration with only read-only tools:

- filesystem: explicit `read.repo` only
- git: explicit `read.repo` only
- Gate result: **PASS** (no expansion from baseline)

## `risky-config.yml`

An MCP configuration with critical capabilities:

- filesystem: _upgraded_ from `read.repo` to `write.repo` (high risk)
- browser: new tool, inferred `egress.http` (high risk, heuristic)
- terminal: new tool, inferred `exec.shell` (critical risk, heuristic)
- Gate result: **FAIL_CAPABILITY_ESCALATION**

## `allowlist.yml`

Pre-approved tools that won't trigger the gate:

- `actions/checkout@v4` → `read.repo`
- `actions/cache@v4` → `read.repo`
- `docker/build-push-action@v5` → `exec.docker`, `write.packages`, `egress.http`

## Tip

Use explicit `permissions:` in your MCP/agent configs instead of relying on heuristics. This gives higher confidence and avoids `WARN_HEURISTIC_MAPPING`.
