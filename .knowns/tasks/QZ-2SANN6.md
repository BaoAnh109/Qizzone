---
id: QZ-2SANN6
title: 'M4: Teacher Classes, ClassDetail, QuizList assign & CreateQuiz Azota settings'
status: todo
priority: high
labels:
  - m4,teacher,ui
createdAt: '2026-11-22T04:34:18.518Z'
updatedAt: '2026-11-22T04:34:18.518Z'
timeSpent: 0
---
# M4: Teacher Classes, ClassDetail, QuizList assign & CreateQuiz Azota settings

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement teacher/Classes.tsx (grid of classrooms, create modal, archive), teacher/ClassDetail.tsx (Học sinh/Bài tập/Cài đặt tabs, Excel roster import via excelRosterImport, invite code), QuizList.tsx Giao cho lớp modal, and CreateQuiz.tsx Step 3 Azota publish settings (publishScope, opensAt, closesAt, maxAttempts, shuffle, scoreVisibility, answerVisibility). Match tests/e2e/m4-teacher-classroom-azota.spec.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 teacher/Classes.tsx lists classrooms, supports create modal and archive
- [ ] #2 teacher/ClassDetail.tsx has Học sinh, Bài tập, Cài đặt tabs with roster Excel import
- [ ] #3 QuizList.tsx supports Giao cho lớp modal with dueAt and latePolicy
- [ ] #4 CreateQuiz.tsx Step 3 wires Azota publish settings to quizService.updatePublishSettings
<!-- AC:END -->

