---
id: QZ-3S0GA3
title: 'M3: Admin AccountManagement refactor & commit BugReportsAdmin'
status: todo
priority: high
labels:
  - m3,admin,ui
createdAt: '2026-11-22T04:34:18.080Z'
updatedAt: '2026-11-22T04:34:18.080Z'
timeSpent: 0
---
# M3: Admin AccountManagement refactor & commit BugReportsAdmin

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Typecheck & commit BugReportsAdmin.tsx (already written). Refactor apps/web/src/pages/admin/AccountManagement.tsx with Teacher/Student tabs, search input, clickable table rows opening detail Modal (stats, classrooms, quizzes, approve/reject, lock/unlock, change role). Match Playwright selectors in tests/e2e/m3-admin-workflows.spec.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 BugReportsAdmin.tsx typechecks cleanly and is committed
- [ ] #2 AccountManagement has Giáo viên / Học sinh tabs and search input
- [ ] #3 Clicking a row opens detail Modal with stats and approve/reject/lock/role actions
- [ ] #4 Matches E2E selectors in tests/e2e/m3-admin-workflows.spec.ts
<!-- AC:END -->

