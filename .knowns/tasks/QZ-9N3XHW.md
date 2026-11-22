---
id: QZ-9N3XHW
title: 'M6-M7: Typecheck, Vitest (205+ pass), Build, Commit & Push'
status: todo
priority: high
labels:
  - m6,m7,verify
createdAt: '2026-11-22T04:34:18.892Z'
updatedAt: '2026-11-22T04:34:18.892Z'
timeSpent: 0
---
# M6-M7: Typecheck, Vitest (205+ pass), Build, Commit & Push

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Run npm run typecheck, npm --workspace=@qizzone/web run test (must keep 205+ passing), and npm --workspace=@qizzone/web run build. Scan staged diff for secrets, commit to feat/v3-role-workflows-classroom-azota, and push to origin (NEVER push to main).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 npm run typecheck passes with 0 errors
- [ ] #2 Vitest passes with 205+ tests
- [ ] #3 Production build succeeds
- [ ] #4 Committed and pushed to feat/v3-role-workflows-classroom-azota
<!-- AC:END -->

