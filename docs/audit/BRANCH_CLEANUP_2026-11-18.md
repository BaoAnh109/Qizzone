# Branch cleanup manifest — 2026-11-18

Repository: `BaoAnh109/Qizzone`. Base `main`: `42830769097c85638cc2f2e8413df4e37e215aa4`. The 21 refs below were verified against live `git ls-remote` and local merge ancestry; each tip is contained in `main`. GitHub's only open PR was #6 (`main` → `master`), so none is its head. Preserve this SHA list to recreate a ref if needed.

| Branch | Tip SHA |
|---|---|
| codex/contextual-practice-entry | 7dae96b427cd28fd695c8f003c884ddb17d1c43f |
| codex/dark-exam-toolbar | 9703c19a895a753964216aeafc73f406a97b5375 |
| codex/dark-mode-theme | b74396b4f336f0e00cf75e01808b1559abc7e77d |
| codex/dark-theme-contrast-fix | fd54b041687d3e98acc9598bdacd8662f2312f0e |
| codex/post-merge-release-checklist | 34efbaa6247993b98c3aa002e098e0539a21a701 |
| codex/practice-retry-checked-only | 59bf77a606949dc01330b954b4ddcd483f939425 |
| codex/production-backend-evidence | 2aacbf406eadc4a339173149affb3db477c1e8e5 |
| codex/production-checklist-edge-evidence | 1a2d3225f538781c05db5f440c6464594f8bdad0 |
| codex/production-env-bundle-evidence | e53a9fcd7dd2fbacf38eacb8c2746e357f06a81f |
| codex/production-release-status | 146b4155dcd7507cc94f047644a2ad6f74738385 |
| codex/production-web-fixes | 252d12d797124305439da92670f7307fb297682a |
| codex/release-evidence-pr18 | 11a161437be355a2b7cca8ee96fafe8dfa093566 |
| codex/release-evidence-pr20 | c9339219159987786962c59d6fa45550853cc4c4 |
| codex/release-evidence-pr22 | 2b31b1f7e95d27762f97a9699b157e92fbcc8eab |
| codex/security-redact-assignment-emails | 02aff83118f7ededaea3ea371f9f71b7ec62b482 |
| codex/supabase-migration-ledger-sync | ee3a62e1bd392e114bf1931a7da80daf06e71ef3 |
| feat/V1 | adf2b9b1ff89dd002ac9620099e8ad0de88f3454 |
| feature/practice-azota | 9b2480999e4fa60024f54fad956bc5b7e993dd8d |
| feature/role-switch-auth-flow | fe0fb8fce3baf399ea6b8cdaf1c43c955db158f1 |
| refactor/optimize-login-router | 919dbfdd67438552d49c99c7a96c257b288ac413 |
| review/production-v1 | 7ce6c8ab0faadd658393c5a24a7c33af73fa1811 |

Retained: `main`, `devolop/AIV3`, `ref/Repo`, `master`, `develop/AI`, `devolop/AI_V1`, `codex/practice-option-labels-ordered`, and `codex/shared-practice-question-frame`. They either serve current deployments/open PRs or contain commits absent from `main` and need feature-level review.

Deletion status: **complete**. All 21 listed refs were deleted using exact-SHA leases (the final 20 in one atomic push). A live remote read afterwards showed exactly the eight retained heads listed above. `main` and the local `devolop/AIV3` HEAD stayed at their recorded SHAs.
