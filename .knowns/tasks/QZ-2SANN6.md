---
id: QZ-2SANN6
title: 'M4: Teacher Classes, ClassDetail, QuizList assign & CreateQuiz Azota settings'
status: done
priority: high
labels:
  - m4,teacher,ui
createdAt: '2026-11-22T04:34:18.518Z'
updatedAt: '2026-11-22T05:20:20.677Z'
completedAt: '2026-11-22T05:20:20.677Z'
timeSpent: 862
assignee: '@me'
---
# M4: Teacher Classes, ClassDetail, QuizList assign & CreateQuiz Azota settings

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement teacher/Classes.tsx (grid of classrooms, create modal, archive), teacher/ClassDetail.tsx (Học sinh/Bài tập/Cài đặt tabs, Excel roster import via excelRosterImport, invite code), QuizList.tsx Giao cho lớp modal, and CreateQuiz.tsx Step 3 Azota publish settings (publishScope, opensAt, closesAt, maxAttempts, shuffle, scoreVisibility, answerVisibility). Match tests/e2e/m4-teacher-classroom-azota.spec.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 teacher/Classes.tsx lists classrooms, supports create modal and archive
- [x] #2 teacher/ClassDetail.tsx has Học sinh, Bài tập, Cài đặt tabs with roster Excel import
- [x] #3 QuizList.tsx supports Giao cho lớp modal with dueAt and latePolicy
- [x] #4 CreateQuiz.tsx Step 3 wires Azota publish settings to quizService.updatePublishSettings
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read the M4 Playwright contracts and current classroomService, quizService, domain contracts, and design primitives.
2. Implement teacher Classes list/create/archive and ClassDetail roster, assignments, settings, Excel import, invite code controls.
3. Add QuizList assign-to-class modal and wire CreateQuiz Step 3 Azota settings to quizService.
4. Match accessible selectors and responsive/touch target rules from the task.
5. Run typecheck and relevant tests, review the M4 diff, then record acceptance evidence.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
M4 implemented: teacher Classes list/create/archive/restore/filter/copy; ClassDetail roster, Excel/CSV import preview, edit/invite/assignment tabs; QuizList classroom assignment and Azota settings modal; CreateQuiz publish scope/window/attempt/visibility settings; QuizResultsView tracking matrix and per-question earned points. Verified root typecheck PASS, web lint 0 errors (1 existing Register.tsx warning), and git diff --check PASS. M4 Playwright against Supabase was not run; full web Vitest/build remain for M6. API calls use existing services and domain schemas.



Final integration verification: root typecheck PASS; web Vitest 205 passed / 24 skipped; production build PASS; integrated diff check PASS. Live M4 Playwright against Supabase was not run.
<!-- SECTION:NOTES:END -->

