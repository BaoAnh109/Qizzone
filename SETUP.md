# Cài đặt và vận hành Qizzone

Tài liệu này được đối chiếu với cấu hình trong repository ngày **2026-10-26**. Tên biến và thứ tự migration được lấy từ các tệp hiện có; giá trị project, secrets, backup và quyền deploy cần chủ hệ thống điền hoặc xác nhận.

## Yêu cầu

- Node.js **20.19+** hoặc **22.12+** và npm. Vite 8 yêu cầu các phiên bản này.
- Supabase CLI và Docker Desktop nếu cần chạy database/Edge Functions local.
- Tài khoản Firebase, Supabase và Vercel của môi trường tương ứng.

Xem hướng dẫn chính thức về [yêu cầu Node.js của Vite](https://vite.dev/guide/) và [cài đặt/chạy Supabase CLI trên Windows](https://supabase.com/docs/guides/local-development/cli/getting-started). Ví dụ dưới đây gọi `supabase`; nếu cài CLI cục bộ bằng npm, thay lệnh bằng `npx supabase`.

## Cấu hình và nơi lưu biến môi trường

| Biến | Runtime | Nơi cấu hình |
| --- | --- | --- |
| `VITE_FIREBASE_API_KEY` | Trình duyệt | `qizzone/.env.local`; Vercel Development/Preview/Production |
| `VITE_FIREBASE_AUTH_DOMAIN` | Trình duyệt | `qizzone/.env.local`; Vercel Development/Preview/Production |
| `VITE_FIREBASE_PROJECT_ID` | Trình duyệt | `qizzone/.env.local`; Vercel Development/Preview/Production |
| `VITE_FIREBASE_APP_ID` | Trình duyệt | `qizzone/.env.local`; Vercel Development/Preview/Production |
| `VITE_SUPABASE_URL` | Trình duyệt | `qizzone/.env.local`; Vercel Development/Preview/Production |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Trình duyệt | `qizzone/.env.local`; Vercel Development/Preview/Production |
| `FIREBASE_SERVICE_ACCOUNT` | Supabase Edge Functions | `supabase/functions/.env` khi chạy local; Supabase Function Secrets trên remote |
| `GEMINI_API_KEY` | Supabase Edge Functions | `supabase/functions/.env` khi chạy local; Supabase Function Secrets trên remote |
| `GEMINI_MODEL` | Supabase Edge Functions | Có thể cấu hình trong cùng nơi với các secrets nếu cần chọn model |
| `ALLOWED_ORIGINS` | Supabase Edge Functions | `supabase/functions/.env` khi chạy local; Supabase Function Secrets trên remote |

Mẫu browser config nằm ở [`qizzone/.env.example`](qizzone/.env.example); mẫu Edge Function nằm ở [`supabase/functions/.env.example`](supabase/functions/.env.example). Chỉ thay placeholder trong bản local hoặc dashboard. Không commit `.env.local`, `.env` hay giá trị secret. Các biến `VITE_*` được nhúng vào bundle trình duyệt nên chỉ chứa cấu hình public; tuyệt đối không đặt Gemini key, Firebase service account hay Supabase secret/service-role key vào các biến này. Edge Functions xác minh Firebase ID token; Supabase cấp các biến hệ thống riêng cho runtime function.

`ALLOWED_ORIGINS` là danh sách origin, phân tách bằng dấu phẩy và phải khớp chính xác scheme + hostname, ví dụ `http://localhost:5173,https://preview.example.com,https://app.example.com`. Không thêm đường dẫn URL vào danh sách.

Các mục `[functions.*]` trong `supabase/config.toml` đặt `verify_jwt = false` vì gateway không xác minh token Firebase. Mỗi handler dùng `identity()` trong `_shared/server.ts` để kiểm tra Firebase ID token với Firebase Admin. Giữ bước xác minh này trong mọi Edge Function; không xem cờ trên là endpoint công khai.

## Chạy frontend local

Trong PowerShell tại thư mục repository:

```powershell
Set-Location .\qizzone
Copy-Item .env.example .env.local
# Điền cấu hình Firebase và Supabase của môi trường dev vào qizzone/.env.local.
npm ci
npm run dev
```

Mở URL local do Vite in ra. Khi thiếu một trong sáu biến `VITE_*`, ứng dụng báo tên biến cần cấu hình. Dùng project dev/staging và tài khoản kiểm thử, không dùng tài khoản học sinh thật để phát triển.

## Chạy Supabase local (tùy chọn)

Tại repository root, khởi động Docker Desktop rồi chạy:

```powershell
supabase start
supabase status
```

Lệnh khởi tạo stack local và áp dụng migrations cùng `supabase/seed.sql`. Lấy URL và publishable/anon key local từ kết quả CLI, sau đó điền vào `qizzone/.env.local`. Seed có UID và đề mẫu dành cho local/dev; các UID đó không đại diện cho tài khoản Firebase thật. Đăng nhập thật local còn cần Firebase dev project và service account tương ứng.

Để chạy các Edge Functions local, sao chép mẫu và điền giá trị dev:

```powershell
Copy-Item .\supabase\functions\.env.example .\supabase\functions\.env
supabase functions serve --env-file .\supabase\functions\.env
```

`FIREBASE_SERVICE_ACCOUNT` là JSON service account của Firebase Admin; `GEMINI_API_KEY` chỉ cần khi kiểm thử tính năng AI; `ALLOWED_ORIGINS` cần có origin Vite local. Tệp `.env` đã được ignore. Không đưa nội dung thật vào issue, log hoặc Git. Dừng stack local bằng `supabase stop`.

## Migrations và dữ liệu mẫu

CLI áp dụng các tệp trong `supabase/migrations/` theo thứ tự tên timestamp. Thứ tự hiện tại:

| Thứ tự | Migration | Nội dung |
| ---: | --- | --- |
| 1 | `202609050001_cloud.sql` | Bảng cốt lõi, RLS, RPC, phiên thi và chấm điểm |
| 2 | `202609090001_teacher_approval.sql` | Trạng thái phê duyệt giáo viên |
| 3 | `202609160001_student_teacher_switch.sql` | Yêu cầu và chuyển vai trò tài khoản |
| 4 | `202609250001_quiz_assignments.sql` | Phân công đề theo lớp/email |

`supabase/config.toml` bật seed local qua `supabase/seed.sql`. Dữ liệu seed chỉ dành cho local/dev. Không dùng `supabase db push --include-seed` với production. Để kiểm tra migration trên local, chạy `supabase db reset`; lệnh này xóa và tạo lại database **local** rồi áp dụng migrations và seed. Không chạy `supabase db reset --linked` với project production.

Repository chưa có migration rollback. Khi schema đã lên remote, sửa lỗi bằng migration tiến mới và có kế hoạch tương thích frontend cũ. Trước khi apply production, chủ hệ thống phải xác nhận đúng project, xem trước danh sách migration và xác nhận có backup/restore point phù hợp. CLI hỗ trợ xem trước bằng `supabase db push --dry-run`; sau khi duyệt mới chạy `supabase db push`. Hai lệnh này tác động vào project đã link khi bỏ cờ local.

## Deploy Supabase

Thử migrations và Edge Functions trên project staging trước. Đăng nhập, link đúng project ref staging, xem trước migration rồi áp dụng:

```powershell
supabase login
supabase link --project-ref <STAGING_PROJECT_REF>
supabase db push --dry-run
supabase db push
```

Đặt `FIREBASE_SERVICE_ACCOUNT`, `GEMINI_API_KEY`, `GEMINI_MODEL` nếu cần và `ALLOWED_ORIGINS` trong Supabase Dashboard → Edge Function Secrets. Có thể dùng `supabase secrets set` nếu người vận hành được cấp quyền. Không đặt các secret này vào Vercel hoặc frontend. Đổi mật khẩu dùng mẫu email đặt lại mật khẩu mặc định tại Firebase Console → Authentication → Templates → Password reset; Firebase tự xử lý liên kết, không cần Resend, API gửi mail hay tên miền riêng. Sau khi secrets sẵn sàng, deploy các function:

```powershell
supabase functions deploy bootstrap-profile
supabase functions deploy extract-quiz-with-gemini
supabase functions deploy manage-teacher-approvals
supabase functions deploy request-teacher-role
supabase functions deploy switch-account-role
supabase functions deploy upload-account-avatar
```

Khi chuẩn bị production, xác nhận lại project ref bằng `supabase projects list`, backup/restore point với chủ hệ thống, và kết quả `supabase db push --dry-run`. Không chạy `db push` nếu project hoặc migration list không đúng.

Tài liệu tham khảo: [Supabase migrations](https://supabase.com/docs/guides/deployment/database-migrations), [lệnh db push](https://supabase.com/docs/reference/cli/global-flags#supabase-db-push), [phát triển Edge Functions local](https://supabase.com/docs/guides/functions/development-environment), [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets), [deploy Edge Functions](https://supabase.com/docs/guides/functions/deploy).

## Deploy frontend lên Vercel

`vercel.json` nằm ở repository root và đặt `qizzone/` làm thư mục cài/build, đầu ra `qizzone/dist`. Khi kết nối Git, để Vercel dùng cấu hình này. Trong Vercel Project Settings, đặt sáu biến `VITE_*` ở từng môi trường cần dùng; giá trị Preview nên trỏ tới Firebase/Supabase staging.

Quy trình CLI (chạy tại repository root sau khi project được link):

```powershell
vercel link
vercel env pull .\qizzone\.env.local --environment=preview
vercel
```

Kiểm tra URL Preview bằng tài khoản kiểm thử. Chỉ khi checklist staging qua mới nạp biến Production và deploy:

```powershell
vercel env pull .\qizzone\.env.local --environment=production
vercel --prod
```

Nếu Vercel được nối với Git, push branch không phải production branch hoặc mở pull request sẽ tạo Preview theo cấu hình project. Production branch được xác định trong Vercel Dashboard, không suy luận từ tên branch hiện tại. Xem [deploy từ CLI](https://vercel.com/docs/projects/deploy-from-cli) và [biến môi trường Vercel](https://vercel.com/docs/environment-variables).

## Checklist smoke test sau deploy

Chạy trước trên Preview/staging với tài khoản kiểm thử và một đề thử riêng:

1. Trang đăng nhập tải được; đăng nhập Firebase và đồng bộ hồ sơ thành công.
2. Giáo viên tạo/mở đề thử, học sinh vào bằng mã phòng và lưu được đáp án.
3. Học sinh nộp bài; điểm được tính phía server; chế độ xem lại tuân theo cấu hình đề.
4. Giáo viên xem danh sách kết quả, chi tiết bài và phân tích từng câu; CSV mở được với tiếng Việt.
5. Học sinh không vào được màn hình giáo viên; đề nháp/đóng không được tham gia như đề đang mở.
6. Kiểm tra DevTools console/network, Vercel deployment logs và Supabase Edge Function logs cho lỗi 4xx/5xx hoặc CORS.

Sau Preview mới lặp lại kiểm tra tối thiểu trên production bằng tài khoản test được phê duyệt; xóa dữ liệu test theo chính sách của hệ thống.

## Backup và rollback

- Repository không xác nhận cấu hình backup, retention hay khả năng restore của Supabase production. Trước lần deploy schema đầu tiên, chủ hệ thống phải xác nhận backup/restore point và người có quyền khôi phục trong Supabase Dashboard. Không coi backup là đã bật chỉ vì có Supabase project.
- Với lỗi frontend, dùng Vercel Dashboard → Deployments → Rollback hoặc `vercel rollback` để trỏ traffic về deployment production trước đó; sau đó xác minh lại login, RPC và logs. Trên Hobby, rollback CLI chỉ hỗ trợ deployment production ngay trước đó. Rollback frontend không hoàn tác migration database, secrets hay dữ liệu đã ghi.
- Với lỗi database, dừng deploy tiếp theo và nhờ chủ hệ thống đánh giá forward-fix hoặc restore theo quy trình/backup đã xác nhận. Không tự chạy SQL xóa dữ liệu, không chạy `db reset --linked`, và không khẳng định có rollback SQL trong repository.
- Khi migration được thiết kế, giữ tương thích với frontend đang chạy trong giai đoạn deploy/rollback; nếu không thể, cần kế hoạch phối hợp frontend + database và cửa sổ bảo trì được chủ hệ thống duyệt.

Tham khảo: [Vercel rollback CLI](https://vercel.com/docs/cli/rollback), [rollback production deployment](https://vercel.com/docs/deployments/rollback-production-deployment).

## Kiểm tra mã nguồn trước khi gửi thay đổi

CI hiện cài Node.js 20 và chạy trong `qizzone/`:

```powershell
Set-Location .\qizzone
npm ci
npm run lint
npm test
npm run build
```
