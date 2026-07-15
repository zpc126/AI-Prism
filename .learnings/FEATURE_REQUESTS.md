# Feature Requests

Missing capabilities requested by users or discovered during delivery work.

**Areas**: frontend | backend | infra | tests | docs | config
**Statuses**: pending | in_progress | resolved | wont_fix | promoted

---

## [FEAT-20260710-001] Continuous Web exploration with optional duration

**Logged**: 2026-07-10T11:39:00Z
**Priority**: medium
**Status**: resolved
**Area**: backend

### Requested Capability
Allow Web AI exploration to run without an action limit, with a maximum duration that may be configured or left unlimited.

### User Context
Deep Web admin exploration may need more than the default 24 browser actions; users still need manual stop, read-only, and same-origin protection.

### Complexity Estimate
medium

### Suggested Implementation
Keep limited mode as the default; add continuous mode that ignores maxActions, accepts nullable maxDurationMinutes, persists both fields, and stops the runner timer when configured.

### Metadata
- Frequency: first_time

---
