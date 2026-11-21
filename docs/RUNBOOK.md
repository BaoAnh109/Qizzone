# QIZZONE V3 — VẬN HÀNH LOCAL, STAGING & RUNBOOK (`RUNBOOK`)

> **Cảnh báo Production:** Tuyệt đối **KHÔNG** cấu hình hoặc deploy từ nhánh `main` hay trỏ vào project production V1 trong quá trình nghiệm thu V3. Toàn bộ thao tác dưới đây áp dụng cho **local** hoặc **project staging mới**.

---

## 1. Biến Môi trường (Names-Only)

### 1.1. Frontend (`apps/web/.env.local` & Vercel Preview/Staging)
| Tên biến | Mục đích | Ghi chú bảo mật |
|---|---|---|
| `VITE_SUPABASE_URL` | URL project Supabase Staging | Public |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/publishable key | Public (bị giới hạn bởi RLS) |

### 1.2. Supabase Edge Functions Secrets (`supabase/functions/.env` hoặc Dashboard Secrets)
| Tên biến | Mục đích | Bắt buộc cho |
|---|---|---|
| `GEMINI_API_KEY` | API key Gemini API | `extract-quiz`, `extract-quiz-with-gemini` |
| `GEMINI_MODEL` | Model chính (mặc định `gemini-3.8-flash`) | AI extraction |
| `GEMINI_FALLBACK_MODEL` | Model dự phòng (mặc định `gemini-3.5-flash-lite`) | AI extraction |
| `AI_DAILY_USER_LIMIT` | Giới hạn lượt AI/user/ngày (mặc định `100`) | Quota guard |
| `R2_ACCOUNT_ID` | Cloudflare Account ID | `create-upload-url`, `confirm-upload`, `extract-quiz` |
| `R2_BUCKET_NAME` | Tên private bucket R2 staging | R2 S3 |
| `R2_ACCESS_KEY_ID` | Access key R2 Token (Object Read & Write cho bucket đó) | R2 SigV4 |
| `R2_SECRET_ACCESS_KEY` | Secret key R2 Token | R2 SigV4 |
| `BREVO_API_KEY` | Brevo Transactional API v3 key (`xkeysib-...`) | `dispatch-email` |
| `BREVO_FROM_EMAIL` | Địa chỉ gửi thuộc tên miền đã xác thực trên Brevo | `dispatch-email` |
| `BREVO_FROM_NAME` | Tên hiển thị người gửi (mặc định `Qizzone`) | `dispatch-email` |
| `BREVO_DAILY_LIMIT` | Trần gửi ngày (Brevo Free tier: `300`, reset `00:00 UTC`) | `dispatch-email` |
| `CRON_SECRET` | Secret nội bộ để Supabase Cron gọi `dispatch-email` | `dispatch-email` |
| `ALLOWED_ORIGINS` | Danh sách origin hợp lệ (`http://localhost:5173,https://<preview-url>`) | CORS |

---

## 2. Chạy Phát triển & Kiểm thử Local

```powershell
# Tại thư mục gốc repo (D:\Qizzone_ANTI)
Copy-Item apps\web\.env.example apps\web\.env.local
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run dev
```

Chạy Supabase stack local (cần Docker Desktop & Supabase CLI):
```powershell
supabase start
supabase db reset
Copy-Item supabase\functions\.env.example supabase\functions\.env
supabase functions serve --env-file supabase\functions\.env
```

---

## 3. Cấu hình Staging Mới (Miễn phí trước)

### 3.1. Supabase Staging Project
1. Tạo project Supabase mới (Free plan, khu vực Singapore `ap-southeast-1` để tối ưu độ trễ từ Việt Nam).
2. Link và đẩy schema migrations (KHÔNG đẩy `seed.sql` nếu test dữ liệu thật):
   ```powershell
   supabase link --project-ref <STAGING_PROJECT_REF>
   supabase db push
   ```
3. **Google OAuth & Tự động liên kết email:**
   - Vào *Authentication → Providers → Google*, bật provider, điền Client ID/Secret từ Google Cloud Console, cấu hình Redirect URI `https://<PROJECT_REF>.supabase.co/auth/v1/callback`.
   - Trong *Authentication → URL Configuration*, thêm `http://localhost:5173/**` (và domain Vercel Preview/Prod) vào **Redirect URLs**.
   - Tài khoản Google dùng cùng email đã xác thực sẽ được Supabase Automatic Identity Linking gộp chung `auth.users` ID; nếu trùng email V1 cũ chưa chuyển UUID, `bootstrap-profile` sẽ tự động relink qua `relink_legacy_profile_v3` giữ nguyên dữ liệu/vai trò.
4. **Brevo Custom SMTP + OTP Đăng ký bắt buộc (Dùng tên miền riêng):**
   - Lưu ý chính sách Supabase Free từ `2026-06-03`: SMTP mặc định không cho tùy chỉnh template auth email và chỉ gửi tới team project.
   - Bật **Confirm email** (`mailer_autoconfirm = false`) trong *Authentication → Sign In / Providers → Email* để buộc xác thực OTP khi đăng ký tài khoản mới (đăng nhập chỉ dùng Email/Mật khẩu hoặc Google).
   - Trên Brevo (*Senders, Domains & Dedicated IPs → Domains*), thêm và xác thực tên miền riêng bằng bản ghi DNS **DKIM, DMARC, Brevo code/SPF**, sau đó tạo Sender (`no-reply@yourdomain.com`).
   - Vào Brevo *SMTP & API → SMTP tab* để lấy **SMTP Server** (`smtp-relay.brevo.com`), **Port** (`587`), **Login** (email/SMTP login của Brevo, dạng `...@smtp-brevo.com`), và tạo **SMTP Key** (`xsmtpsib-...`).
   - Trên Supabase *Authentication → SMTP Settings*, bật Custom SMTP trỏ tới `smtp-relay.brevo.com`, cổng `587`, username = Brevo SMTP Login, password = **SMTP Key (`xsmtpsib-...`)**, **Sender email** = `no-reply@yourdomain.com`, **Sender name** = `Qizzone`.
   - Tại *Authentication → Email Templates → Confirm signup*, dán mẫu hiển thị mã OTP `{{ .Token }}`:
     ```html
     <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
       <h2 style="margin:0 0 12px;color:#1d4ed8">Xác thực đăng ký Qizzone</h2>
       <p>Xin chào,</p>
       <p>Nhập mã OTP dưới đây để hoàn tất kích hoạt tài khoản Qizzone của bạn:</p>
       <div style="margin:20px 0;padding:16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;text-align:center;font-size:28px;font-weight:700;letter-spacing:6px;color:#1e3a8a">
         {{ .Token }}
       </div>
       <p style="font-size:13px;color:#475569">Mã có hiệu lực ngắn hạn. Nếu bạn không yêu cầu đăng ký tài khoản này, vui lòng bỏ qua email.</p>
     </div>
     ```

### 3.2. Cloudflare R2 Private Bucket
1. Tạo bucket private `qizzone-materials-staging` (không bật Public Access / r2.dev).
2. Cấu hình **CORS Policy** cho bucket:
   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:5173", "https://your-staging-vercel.vercel.app"],
       "AllowedMethods": ["PUT", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 300
     }
   ]
   ```
3. Cấu hình **Lifecycle Rule**: tự động xóa các tệp mồ côi chưa xác nhận hoặc tệp tạm quá hạn retention (ví dụ sau 7 ngày) để giữ dung lượng dưới hạn mức miễn phí 10 GB/tháng.

### 3.3. Supabase Cron cho `dispatch-email` (`Asia/Ho_Chi_Minh`)
Tạo pg_cron job (qua SQL Editor trên staging sau khi kích hoạt `pg_cron` + `pg_net`) chạy mỗi 5 phút gọi POST tới Edge Function `dispatch-email` kèm header `x-cron-secret: <CRON_SECRET>`.

### 3.4. Vercel Preview / Staging
- Kết nối repo tới nhánh `fix/devolopV3` trên Vercel (không đụng project/domain production của `main`).
- Đặt Root Directory = `.` (Vercel sẽ đọc `vercel.json` tại root: `installCommand: npm ci`, `buildCommand: npm --workspace=@qizzone/web run build`, `outputDirectory: apps/web/dist`).

---

## 4. Backup, Restore & Xử lý Sự cố

- **Export/Backup định kỳ:**
  ```powershell
  supabase db dump --linked > backup_$(Get-Date -Format yyyyMMdd).sql
  ```
- **Khôi phục thử (Restore Drill):** Chạy trên local database trống:
  ```powershell
  psql "$LOCAL_DB_URL" -f backup_YYYYMMDD.sql
  ```
- **Rollback khẩn cấp:**
  - Frontend: Rollback Deployment trên Vercel Preview về bản trước đó (< 30 giây).
  - Edge Function: Deploy lại phiên bản tag trước từ Git.
  - Database: Khôi phục từ dump trước migration; do V3 chỉ bổ sung bảng mới tách biệt nên các bảng lõi đề thi/lượt thi không bị phá cấu trúc.
