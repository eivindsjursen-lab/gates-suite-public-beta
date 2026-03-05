# Week 1 Outreach Execution (Public Beta)

Use this checklist to run outreach without improvising.

## Target

- Contact 5 candidates (3 Node, 2 Python)
- Get 2 pilot starts
- Log outcomes in `docs/launch/pilot-candidate-tracker.md`

## Daily plan (repeat)

1. Send 2 outreach messages (issue/discussion/DM).
2. Follow up once on earlier messages (only one follow-up).
3. Log status changes in tracker.
4. When someone says yes, send:
   - install ref
   - minimal workflow snippet
   - rollback steps
   - feedback template link

## First-contact message (short)

```text
Hi — I maintain Cache Health Gate (public beta), a GitHub Action that flags cache regressions in PRs (hit-rate drop, key churn, restore-time regression).

Install ref:
uses: eivindsjursen-lab/gates-suite-public-beta/packages/cache-health-gate@cache-health-gate/v1

Quickstart + troubleshooting:
- docs/launch/non-assisted-quickstart.md
- docs/troubleshooting/common-issues.md

Would you be open to a quick pilot run in your repo? I only need feedback on:
1) install friction
2) signal vs noise
3) would you keep it enabled
```

## Follow-up message (once)

```text
Quick follow-up in case this is relevant:
I can share a minimal workflow snippet (warn-only, easy rollback) and you can test in ~10-15 minutes.

Feedback form:
https://github.com/eivindsjursen-lab/gates-suite-public-beta/issues/new?template=early-access-feedback.yml
```

## Go / no-go after 2 pilots

- Continue outreach if at least one pilot reports `would_keep_gate_enabled = yes`.
- Pause outreach and patch docs/wording if both report `no`.
