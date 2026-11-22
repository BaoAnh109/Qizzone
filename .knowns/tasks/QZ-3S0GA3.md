---
id: QZ-3S0GA3
title: 'M3: Admin AccountManagement refactor & commit BugReportsAdmin'
status: done
priority: high
labels:
  - m3,admin,ui
createdAt: '2026-11-22T04:34:18.080Z'
updatedAt: '2026-11-22T05:20:20.615Z'
completedAt: '2026-11-22T05:20:20.615Z'
timeSpent: 707
assignee: '@me'
---
# M3: Admin AccountManagement refactor & commit BugReportsAdmin

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Typecheck & commit BugReportsAdmin.tsx (already written). Refactor apps/web/src/pages/admin/AccountManagement.tsx with Teacher/Student tabs, search input, clickable table rows opening detail Modal (stats, classrooms, quizzes, approve/reject, lock/unlock, change role). Match Playwright selectors in tests/e2e/m3-admin-workflows.spec.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 BugReportsAdmin.tsx typechecks cleanly and is committed
- [x] #2 AccountManagement has Giáo viên / Học sinh tabs and search input
- [x] #3 Clicking a row opens detail Modal with stats and approve/reject/lock/role actions
- [x] #4 Matches E2E selectors in tests/e2e/m3-admin-workflows.spec.ts
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Compare the existing BugReportsAdmin change and AccountManagement surface with the M3 E2E contract and current adminService/domain APIs.
2. Verify the existing bug report page with typecheck and tests; fix review findings, then commit that file separately as M3-A.
3. Replace AccountManagement with accessible teacher/student tabs, search, clickable table rows, and an account detail modal backed by adminService.
4. Match the exact Playwright roles, names, labels, and placeholders in tests/e2e/m3-admin-workflows.spec.ts.
5. Run typecheck and the relevant test suite, review the integrated M3 diff, and record evidence before closing the task.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
M3 implementation completed. BugReportsAdmin.tsx is included in HEAD commit 79cd42c; AccountManagement now uses adminService summaries/details with accessible role tabs, searchable clickable rows, account modal, teacher request review, lock/unlock, and role change. Verification: root typecheck PASS; web Vitest 205 passed / 24 skipped; web lint 0 errors / 1 existing warning in Register.tsx. M3 Playwright selectors were read and matched; live E2E was not run. System Decision Impact: none — the UI uses existing admin service/API contracts. Spec Decision Compliance: n/a — standalone task, no linked spec or Locked Decisions.



Final integration verification: root typecheck PASS; web Vitest 205 passed / 24 skipped; production build PASS; integrated diff check PASS. Live M3 Playwright was not run.
<!-- SECTION:NOTES:END -->

