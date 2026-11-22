---
id: QZ-F73C1N
title: 'M5: Student Classes, ClassDetail & JoinClassByLink'
status: done
priority: high
labels:
  - m5,student,ui
createdAt: '2026-11-22T04:34:18.707Z'
updatedAt: '2026-11-22T05:20:20.648Z'
completedAt: '2026-11-22T05:20:20.648Z'
timeSpent: 456
assignee: '@me'
---
# M5: Student Classes, ClassDetail & JoinClassByLink

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement student/Classes.tsx (joined classrooms grid + Tham gia lớp modal), student/ClassDetail.tsx (assignments list with status badges Cần làm/Đã hoàn thành/Quá hạn/Nộp muộn + Làm bài/Xem kết quả links), and student/JoinClassByLink.tsx (auto joinByCode via URL param). Match tests/e2e/m5-student-classroom-exam.spec.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 student/Classes.tsx lists joined classrooms and supports Tham gia lớp by code
- [x] #2 student/ClassDetail.tsx shows assignments with status badges and action links
- [x] #3 student/JoinClassByLink.tsx auto-joins by :code param with loading/success/error states
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read the M5 Playwright contracts and current classroomService, student assignment/result flows, and route conventions.
2. Implement joined-class list and code join modal.
3. Implement student class detail with assignment statuses, due dates, and correct exam/result navigation.
4. Complete JoinClassByLink auto-join with loading, success, error, and already-joined handling.
5. Run typecheck and relevant tests, review the M5 diff, then record acceptance evidence.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
M5 implemented: student classroom grid with code join and translated disabled/archived/invalid errors; private class detail with assignment statuses, due countdown and exam/result links; invite-link auto-join after login with already-member handling. Added the classroom assignments hub to StudentDashboard because M5 F10 verifies classroom-assigned quizzes appear there. Verified root typecheck PASS, web Vitest 205 passed / 24 skipped, web lint 0 errors (1 existing Register.tsx warning), and git diff --check PASS. Live Playwright against Supabase was not run.



Final integration verification: root typecheck PASS; web Vitest 205 passed / 24 skipped; production build PASS; integrated diff check PASS. Live M5 Playwright against Supabase was not run.
<!-- SECTION:NOTES:END -->

