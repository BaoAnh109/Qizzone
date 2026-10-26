# Qizzone — release checklist v1

- Ngày cập nhật: **2026-10-26**
- Production frontend: [https://qizzone.vercel.app](https://qizzone.vercel.app), đang phục vụ từ `main`.
- Commit production mới nhất đã kiểm tra trực tiếp trong Vercel: merge PR [#14](https://github.com/BaoAnh109/Qizzone/pull/14), `71db6f3`; deployment ở trạng thái Ready.
- PR [#9](https://github.com/BaoAnh109/Qizzone/pull/9), #10, #11, #12, #13 và #14 đã merge vào `main` qua pull request.
- PR [#5](https://github.com/BaoAnh109/Qizzone/pull/5) (`feat/V1`) đã merged vào `main`; head hiện tại của `feat/V1` cũng không còn chênh lệch với `main`. `develop/v1` không có trong danh sách branch. Nhánh luyện tập `feature/practice-azota` đã rebase lên `origin/main` (`71db6f3`) và đã push; chưa có PR.

## Trạng thái cổng

- **Cổng mã nguồn: ĐẠT tại checkout hiện tại.** Trên commit `dcdff9d`, `npm run lint`, `npm test -- --pool=threads --maxWorkers=1` (26 file / 116 test), `npm run build` và `git diff --check` đều đạt. CI/Vercel Preview của PR feature chưa chạy vì chưa có PR.
- **Frontend production: ĐÃ TRIỂN KHAI.** Domain công khai, `/login`, `/robots.txt` và các header đã được kiểm tra sau merge.
- **Toàn hệ thống production: CHƯA ký sign-off.** Edge xác nhận project Supabase `qizzone` / `main PRODUCTION` (ref `iqojrgrljrttqjbhcogr`, region `ap-southeast-2`). SQL Editor chỉ đọc xác nhận bốn migration hiện có khớp main; trang Migration History và Edge Functions không tải do sự cố Management API. Gói Free không có scheduled backups. PR #14 đã đưa migration bảo vệ `assignedEmails` vào `main`, nhưng chưa áp dụng nên email allowlist vẫn lộ qua `list_quizzes()`. Các bảng/RPC luyện tập Azota cũng chưa tồn tại trên production. Chưa có tài khoản giáo viên/học sinh test được duyệt.

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
- Vercel Dashboard qua Edge xác nhận project `qizzone` nối repo `BaoAnh109/Qizzone`, production domain `qizzone.vercel.app`, source branch `main` và deployment `71db6f3` ở trạng thái Ready. Dashboard liệt kê `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_FIREBASE_API_KEY` và `VITE_FIREBASE_AUTH_DOMAIN`, tất cả scope `Production`; giá trị được giữ kín. Trang Build and Deployment xác nhận các lệnh cài/build/output cùng header/rewrite được override từ `vercel.json`; không thay đổi cài đặt.
- Qua Edge, đã xác nhận production project ref `iqojrgrljrttqjbhcogr`, branch `main PRODUCTION`, region `ap-southeast-2`. Query catalog chỉ đọc xác nhận production đã có bốn migration đến `202609250001`; các bảng/RPC của luyện tập Azota chưa tồn tại.
- Edge đã khôi phục phiên admin Qizzone và tải `/admin/teacher-approvals`, hiển thị không có yêu cầu đang chờ; chưa xác minh được luồng giáo viên/học sinh.
- SQL Editor xác nhận ledger gồm `202609050001`, `202609090001`, `202609160001`, `202609250001`, khớp bốn migration trên `main`. `to_regclass`/`to_regprocedure` xác nhận `practice_sessions`, `practice_answers` và ba RPC luyện tập chưa có.
- Banner Supabase báo sự cố Management API; trang Migration History và Edge Functions không tải. Trang Backups xác nhận gói Free không có scheduled backups, chưa có restore point/retention xác minh. [Incident](https://status.supabase.com/incidents/01M5J8ZQ04EZXAYF10Q75MGC1T).
- `list_quizzes()` production đang lộ toàn bộ `settings.assignedEmails` cho học sinh. Migration `202610260000_redact_assigned_emails.sql` đã merge qua PR #14, nhưng chưa áp dụng lên database.
- Chưa chạy luồng giáo viên/học sinh, tạo đề, làm bài và nộp bài trên production vì chưa có tài khoản test được phê duyệt; secrets và logs vẫn chưa xác minh.

## Xác minh production còn mở

- [x] Vercel Dashboard xác nhận project `qizzone`, repo `BaoAnh109/Qizzone`, production domain `qizzone.vercel.app`, source branch `main` và deployment Ready.
- [x] Xác minh Supabase production project ref trong Edge: `iqojrgrljrttqjbhcogr`, branch `main PRODUCTION`, region `ap-southeast-2`.
- [ ] Chủ repo xác nhận `assignedClasses`/`assignedEmails` chỉ để phân phối/lọc dashboard hay phải chặn join tại RPC/RLS.
- [x] Vercel Dashboard liệt kê sáu biến public `VITE_*` ở scope `Production`, không hiển thị giá trị; bundle production cũng khớp cấu hình client đã link.
- [ ] Người có quyền xác minh Supabase Edge Function Secrets (`FIREBASE_SERVICE_ACCOUNT`, `GEMINI_API_KEY`, `GEMINI_MODEL` nếu dùng, `ALLOWED_ORIGINS`) và logs mà không sao chép giá trị secrets.
- [ ] Nâng cấp Supabase khỏi Free hoặc thiết lập backup ngoài nền tảng, sau đó xác nhận restore point, retention và người có quyền khôi phục. Free Plan không có scheduled backups.
- [x] Đối chiếu bốn migration production (`202609050001`, `202609090001`, `202609160001`, `202609250001`) với schema main bằng SQL Editor chỉ đọc; trang Migration History không tải. Chưa chạy migration nào lên production.
- [ ] Sau khi có phương án backup/restore, dry-run và áp dụng migration `202610260000_redact_assigned_emails.sql`; xác minh học sinh chỉ thấy email của chính mình.
- [ ] Chạy `supabase db push --dry-run` cho hai migration feature sau khi có CLI/auth phù hợp; chưa áp dụng lên production khi chưa có backup/restore point.
- [ ] Có tài khoản giáo viên/học sinh test được phê duyệt để chạy smoke test các luồng đăng nhập, tạo đề, tham gia, lưu/nộp bài và phân quyền.
- [ ] Nhánh `feature/practice-azota` có hai migration luyện tập chưa push/chưa áp dụng production; ledger và catalog đã xác nhận đây là hai migration/tables/RPC còn thiếu. Chỉ đưa vào PR phát hành sau khi `supabase db push --dry-run` và restore point được xác nhận. Migration chỉ thêm bảng/RPC/policy; không sửa hoặc xóa dữ liệu bảng hiện có.

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
- [ ] Đúng Supabase production project ref; xem lại `supabase db push --dry-run`; không dùng `--include-seed`.
- [ ] Trang Migration History, Edge Function secrets và logs cần kiểm tra lại sau khi Supabase Management API phục hồi; không đọc/ghi giá trị secret vào checklist.
- [ ] Có backup/restore point được xác minh trước khi áp dụng các migration production còn thiếu.
- [ ] Áp dụng migration bảo mật `202610260000_redact_assigned_emails.sql`, rồi smoke test dữ liệu phân quyền bằng tài khoản giáo viên/học sinh test được duyệt.
- [x] Quét bundle JavaScript production; không thấy marker của server secrets trong phạm vi mẫu đã kiểm tra.
- [x] Vercel Dashboard xác nhận sáu tên biến browser `VITE_*` có scope `Production`; giá trị không được ghi vào checklist.
- [x] Frontend đã được deploy qua Vercel production pipeline; deployment đang phục vụ `main` tại commit merge PR #14 (`71db6f3`), domain và response công khai đã kiểm tra.
- [ ] Hoàn tất smoke test bằng tài khoản test được duyệt sau deploy; xác nhận migrations/functions và logs.
- [ ] Ghi commit/deployment URL, người deploy, người duyệt và kết quả cuối.

Người duyệt production: ____________________  Ngày/giờ: ____________________

## Rollback

- **Frontend:** dùng Vercel Dashboard → Deployments → Rollback hoặc `vercel rollback`; xác minh login, RPC và logs sau khi traffic quay về deployment trước. Giới hạn rollback CLI tùy plan Vercel.
- **Database:** repository không có migration rollback. Không chạy `supabase db reset --linked` trên production. Dừng deploy tiếp, rồi chủ hệ thống chọn forward migration hoặc restore theo quy trình backup đã xác nhận.
- **Secrets:** giữ giá trị staging và production riêng; nếu secret lộ, thay tại nơi lưu và rà log. Rollback frontend không tự khôi phục secret hay schema.

## Owner decisions và backlog sau v1

- Chốt baseline branch; `develop/v1` không được tìm thấy trong lần audit.
- Chốt ý nghĩa enforce của `assignedClasses`/`assignedEmails`.
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
