# Qizzone API

ASP.NET Core API cho luồng identity/profile, duyệt giáo viên, quản lý quiz, thi và luyện tập. PostgreSQL là nguồn dữ liệu của các endpoint mới; frontend chỉ dùng API cho những service đã có adapter. Supabase vẫn cần cho các tính năng chưa chuyển và chưa có cutover dữ liệu.

## Yêu cầu

- .NET SDK `10.0.404` (runtime image trong Dockerfile là ASP.NET `10.0.15`).
- PostgreSQL tương thích với Npgsql 10.
- Firebase project dev/test và thông tin Firebase Admin cấp qua environment/ADC.

## Chạy local

Từ thư mục `backend/`, cung cấp cấu hình qua environment (không commit giá trị thật):

```powershell
$env:ConnectionStrings__Qizzone = 'Host=localhost;Database=qizzone;Username=qizzone;Password=<local-password>'
$env:Firebase__ProjectId = '<firebase-dev-project-id>'
$env:FIREBASE_SERVICE_ACCOUNT_JSON = '<service-account-json-from-local-secret-store>'
$env:Cors__AllowedOrigins__0 = 'http://localhost:5173'
$env:AllowedHosts = 'localhost;127.0.0.1'

dotnet tool restore
dotnet restore Qizzone.slnx --locked-mode
dotnet tool run dotnet-ef -- database update --project Qizzone.Api --startup-project Qizzone.Api
dotnet run --project Qizzone.Api
```

Nếu dùng `GOOGLE_APPLICATION_CREDENTIALS`, đặt biến thành đường dẫn tới file credential được bảo tồn bên ngoài repository và không thêm file đó vào image. Production yêu cầu cấu hình `Firebase:ProjectId`, credential, PostgreSQL, origin CORS cụ thể, `AllowedHosts` cụ thể và ít nhất một UID bootstrap admin đã xác minh. Không dùng wildcard, mật khẩu mặc định hoặc Firebase project production khi chạy local.

## Migrations

Migration hiện có trong `Qizzone.Api/Migrations`. Tạo SQL xem xét trước khi apply:

```powershell
dotnet tool run dotnet-ef -- migrations script --idempotent --project Qizzone.Api --startup-project Qizzone.Api --output .\migration-review.sql
```

Không chạy `database update` trên production. Trước khi chạy trên bất kỳ dữ liệu thật nào phải có staging rehearsal, snapshot/backup restore đã thử, SQL review và quy trình duyệt release.

## API và kiểm tra

- `GET /health/live`: process liveness.
- `GET /health/ready`: kết nối PostgreSQL.
- `/api/v1/me`, `/api/v1/teacher-requests`, `/api/v1/admin/*`.
- `/api/v1/quizzes/*`.
- `/api/v1/exam-attempts/*`.
- `/api/v1/practice-sessions/*`.
- `POST /api/v1/ai-import-jobs`, `GET /api/v1/ai-import-jobs/{id}` — teacher-only durable AI jobs with image signature/size validation, per-account quota, and owner-only status/results.
- OpenAPI chỉ bật trong môi trường Development.

```powershell
dotnet test Qizzone.slnx --configuration Release
dotnet build Qizzone.slnx --configuration Release
dotnet list Qizzone.slnx package --vulnerable --include-transitive
```

Tests hiện dùng EF InMemory/WebApplicationFactory để kiểm tra policy và endpoint contracts. Chúng không thay thế PostgreSQL integration tests, E2E, load/race tests, migration rehearsal, restore drill hay production smoke tests.

## Container

Build API image từ repository root bằng `docker build -f backend/Dockerfile backend`; build worker bằng `docker build -f backend/Qizzone.Worker/Dockerfile backend`. API listen trên port `8080`; cả hai chạy dưới UID non-root của .NET base image. Image chưa được kiểm tra bằng Docker trong môi trường phát triển này.

## Release status

Worker AI đã có hàng đợi PostgreSQL, quota, lease recovery, retries hữu hạn và Gemini REST integration. API vẫn chưa có uploads/object storage, teacher report parity đầy đủ hoặc công cụ import/reconcile dữ liệu Supabase. Worker giao nhận at-least-once; crash sau phản hồi Gemini có thể phát sinh lần gọi tốn phí lặp. Xem [`../docs/audit/RELEASE_READINESS.md`](../docs/audit/RELEASE_READINESS.md) trước khi cấu hình staging. Không coi việc build image thành công là bằng chứng production readiness.

### Gemini worker runtime

Chạy API và worker thành hai service riêng trên cùng private PostgreSQL. Worker cần `ConnectionStrings__Qizzone`, `Gemini__ApiKey`, `Gemini__Model`; truyền khóa qua secret store phía hosting, không dùng biến `VITE_*`. Job xóa prompt, ảnh và tên file khi hoàn tất/thất bại; job chưa chạy sẽ hết hạn và xóa nguồn sau 24 giờ. Worker cũng xóa bản ghi dedupe autosave cũ hơn 30 ngày theo lô. Không ghi nội dung AI vào logs. Gemini REST dùng `x-goog-api-key`, JSON response schema và inline image parts theo [tài liệu Google Gemini](https://ai.google.dev/gemini-api/docs/generate-content/text-generation).

```powershell
dotnet run --project Qizzone.Worker
```
