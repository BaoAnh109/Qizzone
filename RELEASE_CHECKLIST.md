# Qizzone — release checklist v1

- Ngày cập nhật: **2026-10-26**
- Production frontend: [https://qizzone.vercel.app](https://qizzone.vercel.app), đang phục vụ từ `main`.
- Bản code production mới nhất đã xác minh là merge PR [#18](https://github.com/BaoAnh109/Qizzone/pull/18), `b24753a`; GitHub báo Vercel status thành công. Alias công khai `qizzone.vercel.app` trả HTTP 200 và các security headers lúc 2026-10-26 08:52 UTC. Lượt kiểm tra này chưa xác nhận deployment ID/Ready trực tiếp trong Vercel Dashboard.
- PR [#9](https://github.com/BaoAnh109/Qizzone/pull/9), #10, #11, #12, #13, #14, #15, #16, #17 và #18 đã merge vào `main` qua pull request.
- PR [#5](https://github.com/BaoAnh109/Qizzone/pull/5) (`feat/V1`) và PR [#15](https://github.com/BaoAnh109/Qizzone/pull/15) cho luyện tập đã merge vào `main`; `develop/v1` không có trong danh sách branch ở lần audit trước.

## Trạng thái cổng

- **Cổng mã nguồn: ĐẠT.** Baseline release feature trên commit `33bcd5f` đã qua lint, 26 file / 116 test, build, audit và `git diff --check`; PR #15 có 3/3 checks thành công. PR #18 sửa retry được merge tại `b24753a`; lint, build, 26 file / 117 test và `git diff --check` đều PASS; CI, Vercel Preview và Vercel Preview Comments đều thành công.
- **Frontend production: ĐÃ TRIỂN KHAI.** Domain công khai, `/login`, `/robots.txt` và các header đã được kiểm tra sau merge.
- **Toàn hệ thống production: CHƯA ký sign-off.** Edge xác nhận Supabase `qizzone` / `main PRODUCTION` (ref `iqojrgrljrttqjbhcogr`, region `ap-southeast-2`). Bảy migration đến `202610260002` đã chạy trong một transaction sau khi chủ repo xác nhận; hai bảng luyện tập bật RLS, không cấp quyền bảng trực tiếp cho client roles; sáu RPC `SECURITY DEFINER` từ chối `anon` và kiểm tra role/owner cho `authenticated`. PR #18 đã đưa migration `202610260003` vào `main`, nhưng migration chưa được áp dụng production. Vì vậy production hiện vẫn có thể đưa câu bỏ trống vào nút “Luyện lại câu sai”. Migration History lần trước liệt kê bảy migration, thời điểm ghi nhận `Unknown`. Production UI smoke trước đó chỉ đọc; chưa có tài khoản test được duyệt. Supabase Free không có project backups và chưa có restore point.

## Bằng chứng từ checkout

- `npm run lint` — PASS.
- `npm test -- --pool=threads --maxWorkers=1` — PASS trên nhánh feature sau rebase, 26 file / 116 test.
- `npm run build` — PASS.
- `npm audit` và `npm audit --omit=dev` — PASS, 0 vulnerabilities sau khi vá dependency.
- PR [#9](https://github.com/BaoAnh109/Qizzone/pull/9) đã tạo từ `review/production-v1` vào `main`; GitHub Actions và Vercel Preview thành công trên commit `eba0262`.
- Local setup: Supabase local đã áp dụng 4 migrations và seed; Vite local mở được trang đăng nhập. Bốn biến Firebase dev vẫn trống trong `.env.local`, nên chưa đăng nhập được.
- `vercel.json` parse được; kiểm tra source cho thấy SPA rewrite và asset cache giữ nguyên, bốn header mới có giá trị dự kiến.
- `git diff --check` — PASS.
- Secret-pattern scan trên diff — không phát hiện credential có vẻ thật; giá trị không được in ra.
- Cả 9 task, gồm `QZ-P0-02`, được đánh dấu xong trong `TASKS_PRODUCTION.md`.
- `GET https://qizzone.vercel.app/login` — HTTP 200, `text/html`; bốn header `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` hiện diện.
- `GET https://qizzone.vercel.app/robots.txt` — HTTP 200, `text/plain`; chặn crawl cho `/admin/`, `/student/`, `/teacher/` và `/unauthorized`.
- Sau deploy, Lighthouse desktop và mobile đều đạt Accessibility 100, Best Practices 100, SEO 100. Không có lỗi console trong lần smoke kiểm tra giao diện công khai.
- Cả năm Edge Function production trả lời preflight `OPTIONS` bằng HTTP 200, cho phép origin `https://qizzone.vercel.app` và `POST, OPTIONS`. Đây chỉ xác minh endpoint/CORS; không xác nhận secrets hoặc nghiệp vụ function.
- Supabase Auth `/auth/v1/health` trả HTTP 200. Thử đọc `public.quizzes` trực tiếp và gọi `rpc/list_quizzes` bằng client key anonymous đều bị từ chối `401 permission denied`, khớp ranh giới ACL trong migration; điều này chưa xác minh thao tác của tài khoản đã đăng nhập.
- Cả sáu biến public `VITE_*` trong `qizzone/.env` đều khớp chính xác với giá trị trong graph bundle production (58 asset); URL Supabase cũng khớp project ref được link trong `supabase/.temp/project-ref`. Giá trị không được in ra. Đây xác minh cấu hình hiệu lực của client, không phải metadata trong Vercel Dashboard.
- Quét toàn bộ graph JavaScript production: 58 asset, khoảng 2.3 MB; không thấy marker `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `sb_secret_*`, `FIREBASE_SERVICE_ACCOUNT`, private key PEM hoặc `GEMINI_API_KEY`. Giá trị Google API key duy nhất khớp `VITE_FIREBASE_API_KEY` client config; không ghi giá trị vào checklist.
- Lần xem Vercel Dashboard qua Edge trước đó xác nhận project `qizzone` nối repo `BaoAnh109/Qizzone`, domain production `qizzone.vercel.app`, source branch `main`; deployment PR #16 (`fb1116b`) khi ấy Ready tại [qizzone-ie38y9rl4-ba-nh.vercel.app](https://qizzone-ie38y9rl4-ba-nh.vercel.app/). Sáu biến browser `VITE_*` có scope `Production`; giá trị được giữ kín. Sau đó PR #18 đã merge; status Vercel của merge commit `b24753a` success và alias trả HTTP 200, nhưng deployment ID/Ready mới nhất chưa xác nhận trên dashboard.
- Qua Edge, xác nhận production project ref `iqojrgrljrttqjbhcogr`, branch `main PRODUCTION`, region `ap-southeast-2`. Ban đầu ledger có bốn migration đến `202609250001`; migration `202610260000_redact_assigned_emails` sau đó đã áp dụng nguyên tử qua SQL Editor cùng ledger. Sau khi chủ repo xác nhận, hai migration luyện tập cũng được chạy nguyên tử trong một transaction.
- Edge đã khôi phục phiên admin Qizzone và tải `/admin/teacher-approvals`, hiển thị không có yêu cầu đang chờ; chưa xác minh được luồng giáo viên/học sinh.
- SQL Editor xác nhận ledger có các migration `202609050001`, `202609090001`, `202609160001`, `202609250001`, `202610260000`, `202610260001` và `202610260002`. Truy vấn catalog xác nhận `practice_sessions` và `practice_answers` tồn tại với RLS bật; không có quyền bảng trực tiếp cho client roles; sáu RPC đều là `SECURITY DEFINER`, `anon` không thể gọi và `authenticated` có quyền gọi.
- Migration `202610260003_practice_retry_checked_only.sql` đã merge qua PR #18 để chỉ retry câu đã kiểm tra và sai; chưa được áp dụng vào production.
- Dashboard Supabase vẫn hiện banner điều tra sự cố, nhưng trang Migration History hiện liệt kê `202609050001` đến `202610260002` (7 phiên bản, mới nhất `practice_retry`; thời điểm hiển thị `Unknown`). Edge Functions liệt kê đủ 5 function đang triển khai. Trang Secrets có các mục `Gemini`, `FIREBASE_SERVICE_ACCOUNT`, `ALLOWED_ORIGINS` và `GEMINI_MODEL`; không mở hay sao chép giá trị. Source `extract-quiz-with-gemini` hỗ trợ secret `Gemini` làm fallback cho `GEMINI_API_KEY`. Trang Unified Logs: 22 bản ghi trong 60 phút, 0 cảnh báo, 0 lỗi; nhóm Edge Function có 0 bản ghi nên chưa chứng minh function được gọi thành công. Trang Backups xác nhận gói Free không bao gồm project backups. [Incident](https://status.supabase.com/incidents/01M5J8ZQ04EZXAYF10Q75MGC1T).
- Migration `202610260000_redact_assigned_emails.sql` từ PR #14 đã áp dụng. Read-only catalog checks xác nhận `jsonb_set`, so khớp email theo `current_uid()` và security definer còn nguyên; chưa có tài khoản học sinh để smoke test output thực tế.
- Chưa chạy luồng tạo đề, bắt đầu lượt, trả lời và nộp trên production vì chưa có tài khoản test được phê duyệt. Secret entries và log window đã được kiểm tra; giá trị credentials không được mở và chưa có invocation để kiểm tra nghiệp vụ Edge Function.

## Xác minh production còn mở

- [x] GitHub ghi Vercel check thành công cho merge commit PR #18 (`b24753a`); alias production trả HTTP 200 và security headers. Chưa xác nhận trạng thái Ready và deployment ID trên dashboard sau PR #18.
- [x] Xác minh Supabase production project ref trong Edge: `iqojrgrljrttqjbhcogr`, branch `main PRODUCTION`, region `ap-southeast-2`.
- [x] Hợp đồng v1 của `assignedClasses`/`assignedEmails` theo hành vi hiện có: phân phối/lọc dashboard; học sinh vẫn tham gia đề đã xuất bản bằng code/link. UI giáo viên mô tả đề tự hiện trên trang chủ học sinh được giao. Đây không phải ranh giới phân quyền; nếu sản phẩm cần chặn join thì phải bổ sung kiểm tra phía server ở bản sau.
- [x] Vercel Dashboard liệt kê sáu biến public `VITE_*` ở scope `Production`, không hiển thị giá trị; bundle production cũng khớp cấu hình client đã link.
- [x] Qua Edge xác nhận secret entries `FIREBASE_SERVICE_ACCOUNT`, `Gemini`, `GEMINI_MODEL`, `ALLOWED_ORIGINS` tồn tại mà không mở giá trị; source hỗ trợ alias `Gemini`. Unified Logs 60 phút: 0 cảnh báo/0 lỗi; chưa có invocation Edge Function nên không kết luận credential hoặc nghiệp vụ đã hoạt động.
- [ ] Nâng cấp Supabase khỏi Free hoặc thiết lập backup ngoài nền tảng, sau đó xác nhận restore point, retention và người có quyền khôi phục. Free Plan không có scheduled backups.
- [x] Migration History liệt kê đủ bảy phiên bản từ `202609050001` tới `202610260002`; thời điểm hiển thị `Unknown`. SQL Editor/catalog xác nhận migration mới nhất và các đối tượng luyện tập.
- [x] Áp dụng `202610260000_redact_assigned_emails.sql` trong transaction; catalog check xác nhận function lọc theo email của học sinh hiện tại. Chưa xác minh response bằng tài khoản học sinh.
- [x] Hai migration feature đã được áp dụng qua SQL Editor và đối chiếu với Migration History, ledger, catalog. `supabase db push --dry-run` chưa chạy vì thiếu CLI/auth; dùng lại dry-run trước lần push production tiếp theo.
- [ ] Migration `202610260003_practice_retry_checked_only.sql` đã merge qua PR #18; cần dry-run và áp dụng production. Supabase CLI/auth chưa sẵn có trong checkout để chạy dry-run, Edge dashboard chưa xác minh ở lượt này.
- [ ] Có tài khoản giáo viên/học sinh test được phê duyệt để chạy smoke test các luồng đăng nhập, tạo đề, tham gia, lưu/nộp bài và phân quyền.
- [x] PR [#15](https://github.com/BaoAnh109/Qizzone/pull/15) đã merge với 3/3 checks qua; PR [#18](https://github.com/BaoAnh109/Qizzone/pull/18) đã merge với CI/Vercel checks thành công. Merge commit `b24753a` có Vercel status success và alias production trả HTTP 200. `/student` đã tải danh sách luyện tập/lịch sử trong smoke test chỉ đọc trước đó. Còn mở: migration retry production, smoke test ghi bằng tài khoản test, xác nhận dashboard deployment, backup/restore và test nghiệp vụ Edge Function.

## Deploy staging / Preview

1. Đưa code vào branch đã được chủ repo xác nhận; chưa dùng branch hiện tại làm production branch tự động.
2. Trên Supabase staging: `supabase link --project-ref <STAGING_PROJECT_REF>`, kiểm tra `supabase db push --dry-run`, rồi mới `supabase db push`.
3. Đặt secrets staging và deploy năm Edge Functions theo danh sách trong [SETUP.md](SETUP.md).
4. Tạo Vercel Preview từ pull request hoặc chạy `vercel` ở repository root sau khi link đúng project.
5. Xác minh response HTML có `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`; kiểm tra SPA route và `/assets/*` vẫn trả đúng cache.
6. Chạy smoke test staging dưới đây. Ghi URL, commit, người kiểm tra và kết quả trước khi xin duyệt production.

### Smoke test khoảng 10 phút

- [ ] Tải trang đăng nhập; đăng nhập bằng tài khoản giáo viên test và xác nhận đồng bộ hồ sơ.
- [ ] Tạo đề thử nhỏ, xuất bản ở staging; học sinh test tham gia bằng mã.
- [ ] Chọn đáp án, refresh/reload khi cần, xác nhận bài vẫn thuộc đúng attempt; nộp và kiểm tra điểm server.
- [ ] Giáo viên xem chi tiết bài và thống kê theo câu; kiểm tra số đúng, bỏ trống, phân bố lựa chọn và CSV tiếng Việt.
- [ ] Xác nhận học sinh không vào được route giáo viên; đề draft/closed không thể bắt đầu.
- [ ] Thử import DOCX/PDF trong giới hạn và tệp vượt giới hạn; xác nhận lỗi trước khi đọc/gọi AI.
- [ ] Kiểm tra console/network, Vercel logs và Supabase Edge Function logs; xác nhận không có lỗi 4xx/5xx/CORS chưa giải thích.
- [ ] Kiểm tra header bảo mật thực tế trên Preview. Cấu hình local không thay thế kiểm tra response.

Người kiểm tra: ____________________  Ngày/giờ: ____________________  Kết quả: PASS / FAIL

## Production sign-off

- [ ] Preview/staging smoke test PASS và không còn lỗi chặn.
- [ ] Chủ repo xác nhận backup/restore point và cửa sổ triển khai.
- [ ] Đúng Supabase production project ref; xem lại `supabase db push --dry-run`; không dùng `--include-seed`. Migration `202610260003` chưa áp dụng.
- [x] Qua Edge đã kiểm tra danh sách Migration History, secret entries và Unified Logs khi banner sự cố còn hiển thị; không đọc/ghi giá trị secret vào checklist. Timestamp migration vẫn `Unknown`; log hiện không có invocation Edge Function.
- [ ] Backup/restore point và retention chưa được xác minh. Chủ repo đã cho phép áp dụng hai migration luyện tập dù mục này chưa hoàn tất; ghi nhận đây là rủi ro còn mở, không diễn đạt như sign-off hoàn chỉnh.
- [x] Áp dụng migration bảo mật `202610260000_redact_assigned_emails.sql` và xác minh function/ledger qua SQL Editor; còn thiếu smoke test dữ liệu phân quyền bằng tài khoản giáo viên/học sinh test được duyệt.
- [x] Quét bundle JavaScript production; không thấy marker của server secrets trong phạm vi mẫu đã kiểm tra.
- [x] Vercel Dashboard xác nhận sáu tên biến browser `VITE_*` có scope `Production`; giá trị không được ghi vào checklist.
- [x] Frontend production alias trả HTTP 200 với security headers; GitHub báo Vercel status success cho main commit PR #18 (`b24753a`). Dashboard deployment ID/Ready sau PR #18 chưa xác minh. Trang `/student` tải mục Luyện tập với danh sách đề và lịch sử 0 lượt ở lần smoke chỉ đọc sau PR #15.
- [ ] Hoàn tất smoke test ghi dữ liệu bằng tài khoản test được duyệt sau deploy; xác nhận start/check/finish và logs. Không ghi lượt luyện tập thử vào tài khoản production thật.
- [ ] Ghi commit/deployment URL, người deploy, người duyệt và kết quả cuối.

Người duyệt production: ____________________  Ngày/giờ: ____________________

## Rollback

- **Frontend:** dùng Vercel Dashboard → Deployments → Rollback hoặc `vercel rollback`; xác minh login, RPC và logs sau khi traffic quay về deployment trước. Giới hạn rollback CLI tùy plan Vercel.
- **Database:** repository không có migration rollback. Không chạy `supabase db reset --linked` trên production. Dừng deploy tiếp, rồi chủ hệ thống chọn forward migration hoặc restore theo quy trình backup đã xác nhận.
- **Secrets:** giữ giá trị staging và production riêng; nếu secret lộ, thay tại nơi lưu và rà log. Rollback frontend không tự khôi phục secret hay schema.

## Owner decisions và backlog sau v1

- Chốt baseline branch; `develop/v1` không được tìm thấy trong lần audit.
- Nếu sau này cần `assignedClasses`/`assignedEmails` làm ranh giới quyền, bổ sung enforcement phía server thay vì dựa vào lọc dashboard.
- Tùy kết quả staging, đánh giá kích thước chunk parser và kiểm thử trên điện thoại/mạng yếu.
- Thêm browser E2E và accessibility checks cho các luồng nhập đề, làm bài, nộp bài và xem thống kê.
- Ngân hàng câu hỏi tái sử dụng vẫn là hướng phát triển sau v1.
- Xác minh chạy thật của trigger GitHub Actions, header Vercel Preview, backup/restore và quy trình theo dõi logs.

## Bản nháp ghi chú phát hành

- Bảo vệ preview DOCX bằng DOMPurify.
- Cập nhật dependency có advisory bảo mật; audit toàn bộ và runtime đều sạch, không hạ major Firebase.
- Khôi phục câu trả lời chưa đồng bộ theo attempt và revision sau khi mất mạng/reload.
- Chạy CI trên branch `review/**` và mọi pull request.
- Giới hạn kích thước import: DOCX/PDF 25 MB; ảnh, TXT/MD và văn bản dán 5 MB.
- Thêm phân tích câu hỏi và CSV tổng hợp cho giáo viên.
- Bổ sung hướng dẫn cài đặt/vận hành, header bảo mật Vercel và service layer cho RPC phiên thi.
