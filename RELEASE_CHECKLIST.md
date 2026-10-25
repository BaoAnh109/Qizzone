# Qizzone — release checklist v1

- Ngày lập: **2026-10-26**
- Branch: `review/production-v1`
- Commit code đã qua các cổng local: `561a1e8`
- Baseline theo prompt: `develop/v1` không có trong danh sách branch đã kiểm tra; code được rà soát trên proxy sạch `refactor/optimize-login-router` từ `919dbfd`.

## Trạng thái cổng

- **Cổng mã nguồn: ĐẠT.** Không còn P0/P1/P2 trong danh sách task; lint, test, build, diff whitespace và secret-pattern scan đều đạt.
- **Release candidate/staging: SẴN SÀNG để chủ repo bắt đầu xác minh.**
- **Production: CHƯA ký duyệt/chưa triển khai.** Chưa có push, Vercel Preview, quyền dashboard Supabase/Vercel, xác nhận backup hoặc smoke test trên hệ thống thật.

## Bằng chứng từ checkout

- `npm run lint` — PASS.
- `npm test` — PASS, 22 file / 105 test.
- `npm run build` — PASS.
- `npm audit` và `npm audit --omit=dev` — PASS, 0 vulnerabilities sau khi vá dependency.
- `vercel.json` parse được; kiểm tra source cho thấy SPA rewrite và asset cache giữ nguyên, bốn header mới có giá trị dự kiến.
- `git diff --check` — PASS.
- Secret-pattern scan trên diff — không phát hiện credential có vẻ thật; giá trị không được in ra.
- Mọi task `QZ-P0-01` đến `QZ-P2-05` được đánh dấu xong trong `TASKS_PRODUCTION.md`.

## Trước khi deploy

- [ ] Chủ repo chỉ định branch/commit thay thế `develop/v1` hoặc xác nhận proxy `refactor/optimize-login-router` là baseline mong muốn.
- [ ] Chủ repo xác nhận `assignedClasses`/`assignedEmails` chỉ để phân phối/lọc dashboard hay phải chặn join tại RPC/RLS.
- [ ] Xác nhận Vercel project, production branch, domain và project ref Supabase đúng với môi trường đích.
- [ ] Đặt sáu biến `VITE_*` trong Vercel cho đúng môi trường; Preview dùng project Firebase/Supabase staging.
- [ ] Đặt Supabase Edge Function Secrets: `FIREBASE_SERVICE_ACCOUNT`, `GEMINI_API_KEY`, `GEMINI_MODEL` (nếu chọn model riêng), `ALLOWED_ORIGINS`. Không ghi giá trị vào repo hoặc checklist.
- [ ] Chủ hệ thống xác nhận backup/restore point, retention và người có quyền khôi phục trên Supabase production. Repository không chứng minh backup đã bật.
- [ ] Đọc [SETUP.md](SETUP.md), xác nhận migration list trước khi áp dụng. Không chạy seed trên production.

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
- [ ] Deploy migrations/functions theo [SETUP.md](SETUP.md), rồi xác nhận Edge Function logs.
- [ ] Đúng sáu biến browser `VITE_*` trong Vercel Production; không có secret server trong bundle.
- [ ] Deploy frontend bằng Vercel production pipeline đã duyệt; smoke test tài khoản test sau deploy.
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
