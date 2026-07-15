# Errors

Reusable command, tool, API, and environment failures captured for future Codex sessions.

**Areas**: frontend | backend | infra | tests | docs | config
**Statuses**: pending | in_progress | resolved | wont_fix | promoted

---

## [ERR-20260713-001] Exploration evidence route used wrong data directory

**Logged**: 2026-07-13T10:19:20Z
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
Exploration evidence routes must resolve the same screenshot directory used by the browser tool.

### Error
```
Exploration history image URLs returned 404 because routes read root data/screenshots while browser.js writes server/data/screenshots.
```

### Context
Browser screenshotDir resolves relative to server/pi/tools.

### Suggested Fix
Use server/data/screenshots as primary and keep root data/screenshots as legacy fallback; verify evidence URLs return image/png.

### Metadata
- Reproducible: yes
- Related Files: server/exploration/routes.js

---
