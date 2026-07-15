# Learnings

Corrections, insights, knowledge gaps, and best practices captured for future Codex sessions.

**Categories**: correction | insight | knowledge_gap | best_practice
**Areas**: frontend | backend | infra | tests | docs | config
**Statuses**: pending | in_progress | resolved | wont_fix | promoted

---

## [LRN-20260615-001] correction

**Logged**: 2026-06-15T07:26:12Z
**Priority**: high
**Status**: pending
**Area**: backend

### Summary
项目中的手机端和小程序自动化必须通过 USB 或无线 ADB 操作 Android 真机，移动浏览器视口不能替代真机。

### Details
跨端用例可能先在 Web 后台操作，再切换到管理小程序或手机端验证。步骤可显式使用 [Web]/[手机]，旧用例也需要从小程序、移动端、App、H5 等语义自动识别。

### Suggested Action
维护独立的 Playwright Web 会话和 ADB Android 会话；手机步骤执行前检查 adb devices，并支持 adb pair/adb connect。

### Metadata
- Source: manual_capture
- Related Files: server/device/adb-device.js
- Tags: adb, android, cross-device

---

## [LRN-20260710-001] correction

**Logged**: 2026-07-10T11:27:10Z
**Priority**: high
**Status**: pending
**Area**: config

### Summary
The Scout instance with the existing GitLab, Bug, history, scripts, and user data is outputs/scout-web; work/scout-web is a different incomplete copy.

### Details
Editing or starting work/scout-web makes the user-visible app appear to lose existing features. Implementation, verification, and npm run dev for this project must target outputs/scout-web unless the user explicitly redirects the workspace.

### Suggested Action
Before editing or restarting Scout, compare the screenshot navigation and run git status in outputs/scout-web, then launch that directory on port 3000.

### Metadata
- Source: manual_capture
- Related Files: AGENTS.md
- Tags: workspace, runtime-copy

---
