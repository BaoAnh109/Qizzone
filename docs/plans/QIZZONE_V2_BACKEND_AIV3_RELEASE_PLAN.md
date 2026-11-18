# Qizzone: kế hoạch backend V2, AIV3 và phát hành cho người dùng

**Ngày lập:** 2026-11-18

**Trạng thái:** kế hoạch thực thi; các gate bên dưới chưa được coi là đã đạt.

**Mục tiêu:** đưa Qizzone có backend ASP.NET Core/PostgreSQL và nhận diện tài liệu AIV3 tới người dùng bằng một lần chuyển đổi có kiểm soát, giữ dữ liệu bài thi và khả năng quay lại bản đang chạy.

**Nguồn code:** `main` tại `42830769097c85638cc2f2e8413df4e37e215aa4`. Bản AIV3 hiện có trên `devolop/AIV3` tại `3c5199581f72046e2595d865be18cc9567785657` cộng thay đổi chưa commit. Hai nguồn cần được đối soát theo tính năng, không gộp mù toàn bộ lịch sử.

## 1. Tình trạng và quyết định nền

- `main` là baseline sản phẩm. Tạo worktree riêng và nhánh mô tả theo loại việc, như `feat/qizzone-v2-backend-aiv3`, từ đúng SHA của `main`; không checkout đè lên worktree `D:\Qizzone` đang có nhiều thay đổi.
- `devolop/AIV3` hiện là nguồn của một Vercel production deployment theo [release readiness](../audit/RELEASE_READINESS.md). Giữ nhánh và bản deploy đó đến khi bản thay thế hoạt động ổn định và đã có điểm khôi phục. Đã xóa 21 nhánh remote cũ có commit nằm trong `main`, sau khi xác minh SHA và PR; xem [branch cleanup manifest](../audit/BRANCH_CLEANUP_2026-11-18.md).
- `ref/Repo` chỉ hơn `main` 5 commit scaffold/Autosave; dùng làm nguồn tham khảo và kiểm kê, không coi là backend V2 hoàn chỉnh.
- Frontend hiện ở Vercel; Firebase Auth hiện là hệ danh tính; Supabase chứa các luồng dữ liệu/Edge Function còn dùng. Backend V2 mới có API, EF migrations, worker Gemini và một phần adapter frontend. Chưa có bằng chứng đạt feature parity, migration rehearsal, restore, E2E và load trên bản release cuối.
- Nguồn AIV3 phải bao gồm parser PDF/DOCX/ảnh, xử lý 5 phương án, bảng đáp án, giữ hình/công thức, Gemini fallback có đối chiếu nguồn, màn hình giáo viên sửa và xác nhận. Kết quả 40/40 trên một PDF chỉ là regression fixture, chưa chứng minh độ chính xác chung; xem [AI evaluation](../audit/AI_EXTRACTION_EVALUATION.md).
- Hạn mức chi tiền ngoài gói miễn phí: **0 đồng**, trừ khi chủ dự án thay đổi. Không dùng chế độ trả theo sử dụng hoặc tài nguyên ngoài quota. Mục tiêu ở mức chi này là **public beta có giới hạn người dùng**, không hứa SLA hay thi chính thức với yêu cầu không gián đoạn tuyệt đối.

## 2. Kiến trúc đích và ranh giới chuyển đổi

`React/Vite trên Vercel` → `Firebase ID token` → `ASP.NET Core API` → `PostgreSQL`; `worker` đọc job bền vững trong PostgreSQL và gọi Gemini bằng secret server side. File đề và media ở object storage hoặc persistent volume được backup độc lập. API quyết định quyền, thời hạn bài thi, snapshot đề, đáp án đúng và điểm; browser chỉ giữ outbox để hồi phục khi mất mạng.

Giữ Supabase V1 phục vụ website đang chạy đến khi từng luồng đã có adapter V2 và dữ liệu được đối soát. Mỗi module chuyển theo cờ cấu hình có thể tắt: identity/profile, teacher/admin, quiz, room/attempt/autosave/submit/result, practice/report, import/media. Không để một phiên thi đổi backend giữa chừng. Bất kỳ luồng nào chưa đạt parity vẫn dùng hệ cũ trong giai đoạn chuyển tiếp.

Giao thức autosave cần mutation ID ổn định, ACK sau commit, revision/409, xử lý nhiều tab, snapshot đề bất biến và submit idempotent. AIV3 chỉ tạo bản nháp; giáo viên xác nhận đáp án trước khi xuất bản. File upload giới hạn loại/dung lượng/trang, có retention và không đưa secret hoặc dữ liệu cá nhân không được phép vào Gemini.

## 3. Chọn nơi chạy miễn phí theo rủi ro thực tế

| Phương án | Phù hợp stack hiện tại | Giới hạn chính | Vai trò đề xuất |
|---|---|---|---|
| **Oracle Cloud Always Free A1 VM** | Chạy Docker Compose cho API, worker, PostgreSQL và Caddy trên ARM64; quota tài liệu tương đương 2 OCPU/12 GB RAM | Có thể không cấp được VM ở home region; VM ít hoạt động có thể bị thu hồi; một host là điểm hỏng chung; tự quản trị và backup | **Ưu tiên public beta** nếu có sẵn VM và qua load/restore/chi phí; cần backup offsite độc lập |
| **Northflank Developer Sandbox** | 2 services API + worker, 1 PostgreSQL addon; không ngủ; gần kiến trúc đích | Tổng tài nguyên Northflank Cloud miễn phí tối đa $20/tháng, hạn mức compute; ngưỡng thanh toán trong account không phải hard cap; nhà cung cấp nói không dùng cho production | **Không chọn hiện tại** dưới hạn mức chi tiêu $0 |
| **Cloud Run free usage + Neon Free Postgres** | API .NET chạy container, DB PostgreSQL riêng | Usage vượt ngưỡng có thể tính phí; cold start; worker polling không phù hợp scale-to-zero, cần thiết kế lại thành job/event; Neon free có hạn mức storage/compute | **Dự phòng nghiên cứu**, chỉ chọn sau khi có mô hình chi phí và worker mới |
| **Supabase Free + Vercel hiện tại** | Ít thay đổi với V1, giữ website sẵn có | Database 500 MB, có thể pause khi ít hoạt động, không có backup tự động trong Free | **Nguồn V1 và rollback tạm thời**, không phải đích backend V2 |
| **Render Free / Koyeb Free** | Có thể dựng API nhỏ | Render ngủ sau 15 phút, DB Free hết hạn sau 30 ngày; Koyeb Free 0.1 vCPU/512 MB, ngủ và không chạy worker/volume | **Loại khỏi đích phát hành** |

**Quyết định hiện tại:** Giữ Vercel production cho frontend và giữ Supabase V1 làm hệ ghi dữ liệu đến hết các gate. OCI tenancy, Free Trial/Free Tier/Promo status và home region Singapore đã xác nhận; chọn OCI Always Free A1 làm candidate duy nhất cho staging cô lập và public beta giới hạn, chỉ khi wizard xác nhận shape, labels, quota/capacity, DNS và backup ngoài host ở mức $0. Hiện tại wizard không liệt kê shape cho image mặc định và nêu service limits/capacity là khả năng gây lỗi. Không tạo Northflank resource vì ngưỡng thanh toán của account không phải hard cap. Nếu Always Free shape, quota/capacity hoặc backup miễn phí không đạt, giữ V1; không deploy V2 cho người dùng. Không có lựa chọn $0 nào đã được xác minh đáp ứng production SLA, phục hồi nhanh và 100 học sinh thi đồng thời.

Kế hoạch triển khai cụ thể cho phương án OCI đã được nghiên cứu lại ngày 2026-11-18: [Qizzone V2 trên OCI Always Free A1](QIZZONE_V2_OCI_ALWAYS_FREE_DEPLOY_PLAN.md). Các Compose, systemd và build files đã được chuẩn bị cục bộ; chưa có Docker Engine, OCI account, release SHA hoặc staging evidence. OCI Container Registry không nằm trong phương án $0 vì Oracle tính phí image lưu trữ; image được build native trên host ARM64 và đối chiếu bằng Git SHA cùng image ID khi có host.

**Kiểm soát chi phí:** lưu ảnh/chứng cứ quota trước khi tạo tài nguyên; kiểm tra hóa đơn/alert sau khi tạo và sau tải mẫu; không bật BYOC, PAYG, min instance tính phí, Cloud SQL, hoặc Gemini Paid Tier. Chính sách thanh toán Northflank cần đối chiếu trực tiếp dashboard vì trang pricing và billing docs công bố khác nhau. Gemini Free Tier phải kiểm tra model/quota và chính sách dữ liệu tại thời điểm bật; tắt worker nếu chưa có khóa hoặc vượt ngưỡng.

Nguồn nhà cung cấp: [Northflank pricing](https://northflank.com/pricing), [Northflank Sandbox](https://northflank.com/docs/v1/application/billing/pricing-on-northflank), [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Cloud Run pricing](https://cloud.google.com/run/pricing), [Neon Free update](https://neon.com/blog/neon-free-plan-1-gb-per-project), [Supabase pricing](https://supabase.com/pricing), [Render Free](https://render.com/docs/free), [Koyeb instances](https://www.koyeb.com/docs/reference/instances).

## 4. Tám bước thực thi và exit gate

### Trạng thái triển khai tại worktree ngày 2026-11-18

| Bước | Trạng thái | Bằng chứng và phần còn lại |
|---|---|---|
| 1. Khóa nguồn và kiểm kê repo | **Hoàn tất** | Tạo worktree/nhánh riêng, giữ nguyên checkout nguồn, lưu inventory và manifest dọn nhánh; không port hoặc xóa thư mục lồng một cách mù quáng. |
| 2. Khóa contract và tiêu chí sản phẩm | **Đang làm** | Có feature-parity, inventory dữ liệu và migration plan; RPO/RTO, tải beta, AI accuracy target và một số hành vi vận hành vẫn cần chủ dự án chốt. |
| 3. Backend V2 | **Đang làm** | API, worker, migrations và adapters đã tích hợp; local build pass. Parity, luồng staging, kiểm tra PostgreSQL trên clean CI và browser E2E còn mở. |
| 4. AIV3 | **Đang làm** | Parser/editor và hỗ trợ A–E có trong nguồn hiện tại; frontend đã nối trạng thái `cancelled` với nút hủy job V2. Cần corpus có nhãn và đo accuracy/latency/chi phí, browser E2E và staging rehearsal. |
| 5. Data và backup | **Đang làm** | Có migration/import tooling và rehearsal tổng hợp trước đó; chưa có backup/restore từ dữ liệu thật, đối soát live hay chứng cứ target. |
| 6. Staging và chọn host | **Chặn bởi hạ tầng/chi phí** | Pilot Compose đã chuẩn bị, nhưng không có Docker trong máy làm việc và chưa xác minh được host có thể giữ chi phí thực trả ở 0 đồng. Không tạo cloud resource. |
| 7. Xác minh release | **Đang làm** | Local frontend checks và backend build pass; backend suite có 7 test bị skip vì thiếu Docker/PostgreSQL. Clean CI trên SHA cuối, load/failure/security và staging E2E chưa chạy. |
| 8. Phát hành không gián đoạn | **Chưa bắt đầu** | Không push/promote, không đổi Vercel/DNS/API URL; production đang tiếp tục trên hệ V1. Chỉ mở gate sau khi có release SHA, canary và rollback đã chứng minh. |

Kết quả lệnh và ranh giới xác minh mới nhất được ghi ở [release readiness review](../audit/RELEASE_READINESS.md). Trạng thái này không chuyển gate production sang đạt.

### Bước 1 — Khóa nguồn và kiểm kê repo

Tạo worktree từ `main`; ghi SHA, lockfile, route/API/function/schema inventory. Lưu diff và danh sách file chưa commit của `devolop/AIV3`, đặc biệt `Qizzone/` lồng bên trong, migrations mới, media và AIV3. Đối chiếu từng tính năng trước khi chọn commit hoặc file để port. Kiểm kê nhánh remote, PR đang mở, deployment source và branch protection; đánh dấu `main`, `devolop/AIV3`, nhánh refactor mới, `ref/Repo` là **giữ tạm**. Chỉ xóa nhánh cũ khi commit đã nằm trong nhánh giữ lại hoặc có tag/archive khôi phục, không có PR/deployment/webhook phụ thuộc và xác minh remote SHA ngay trước thao tác. Không xóa file chưa commit hoặc thư mục lồng khi chưa chứng minh là bản sao không chứa dữ liệu riêng.

**Gate:** inventory nguồn, bảng chuyển tính năng, danh sách nhánh giữ/xóa kèm lý do; không mất thay đổi AIV3.

### Bước 2 — Khóa contract và tiêu chí sản phẩm

Lập feature parity matrix từ `main` cho student/teacher/admin/import. Chốt API DTO, quyền/ownership, quiz version, attempt snapshot, deadline, autosave/submit, media, import job và dữ liệu Supabase cần chuyển. Chốt RPO/RTO của public beta, số người dùng đồng thời dự kiến, chính sách offline/hết giờ, ngưỡng độ chính xác từng loại tài liệu và hành vi khi Gemini không sẵn sàng. Thiết kế schema migration dạng expand → migrate → contract và rollback dữ liệu mới.

**Gate:** contract và decision record được đối chiếu với UI/DB V1; không còn quyết định mơ hồ ảnh hưởng migration hay điểm thi.

### Bước 3 — Hoàn thiện backend V2 theo luồng người dùng

Port có chọn lọc API/worker/EF migrations từ AIV3 vào nhánh mới; kiểm tra build context và ARM64. Hoàn thiện Firebase Admin validation, roles, quiz, room, exam, autosave, submit, result, practice, report, upload/media và adapter frontend. Dùng PostgreSQL thật cho integration tests có transaction, RLS/ownership, race, idempotency và migrations. Giữ API health và worker riêng; giới hạn worker để không làm chậm autosave.

**Gate:** feature parity cho 3 vai trò, không lộ answer key; cùng một attempt qua reload, nhiều tab và mất mạng vẫn có kết quả xác định.

### Bước 4 — Hoàn thiện nhận diện AIV3

Port parser hiện có và fix 5 phương án E, bảng đáp án cuối file, PDF nhiều cột, highlight/bold/underline, scan, DOCX và ảnh. Giữ source span/page và hình/công thức trong bản nháp; không gộp footer/header vào câu hỏi. Gemini fallback chỉ xử lý vùng mơ hồ, kiểm tra câu trả về dựa trên nguồn và không tự gán đáp án đúng. Nối UI với job `cancelled`, retry, review/publish. Tạo corpus không nhạy cảm gán nhãn và đo question/option/answer accuracy, tỷ lệ giáo viên phải sửa, latency, số lần gọi và chi phí.

**Gate:** bộ fixture chạy lại được; ngưỡng do Bước 2 chốt đạt cho từng định dạng bắt buộc; giáo viên luôn có bước duyệt cuối.

### Bước 5 — Di chuyển dữ liệu và backup

Kiểm kê Supabase DB, Storage, Edge Functions và Firebase UID; xuất backup V1, thử restore riêng. Chạy migration rehearsal trên bản sao; giữ khóa/quan hệ, đề, 5 lựa chọn, media, attempt, answer revision, kết quả, role/audit. Đối soát số bản ghi, digest và bất biến điểm/bài làm. Viết runbook freeze writes và reverse reconciliation; không chỉ đổi DNS ngược nếu V2 đã nhận ghi mới. Backup PostgreSQL và media ra nơi ngoài host, mã hóa, thử restore và đo RPO/RTO thực.

**Gate:** sai lệch dữ liệu bắt buộc bằng 0 hoặc có biên bản xử lý; restore sử dụng được; rollback có đường đi cho cả dữ liệu mới.

### Bước 6 — Staging và lựa chọn host

Deploy backend/worker/DB staging tách dữ liệu V1; Vercel Preview chỉ dùng staging URL/credentials. Kiểm tra CORS, Firebase authorized domains, HTTPS, health, queue, backup, giới hạn quota. Song song kiểm tra OCI capacity; nếu có VM, build image AMD64/ARM64 đúng kiến trúc và chạy pilot bằng dữ liệu giả. Chọn host theo tải đo được, quota thực và khả năng restore; không tự chuyển gói trả phí.

**Gate:** staging E2E và hạ tầng pilot chạy được, hóa đơn trong miễn phí; có host dự kiến và phương án khi host mất.

### Bước 7 — Xác minh release

Chạy CI sạch từ SHA nhánh mới: lint/typecheck/build, unit, PostgreSQL integration, migration apply/rollback rehearsal, contract, Playwright E2E 3 vai trò, security/IDOR, AI corpus, upload abuse, autosave/submit race, load đúng cấu hình host. Kiểm tra logs không lộ token/đề/PII; đo p95/p99 và 5xx. Đóng băng release SHA, ghi rõ giới hạn người dùng beta và báo cáo NO-GO nếu host, backup, dữ liệu hoặc AI chưa đạt.

**Gate:** toàn bộ acceptance criteria có bằng chứng gắn SHA; không dùng kết quả CI của commit cũ thay cho mã chưa commit.

### Bước 8 — Phát hành không làm gián đoạn web và dọn repo

Giữ V1 phục vụ người dùng trong khi V2 chạy trên URL riêng. Tắt tự động deploy production của Vercel/host; chỉ promote một release SHA đã kiểm định. Dùng migration tương thích hai phiên bản, tập trung kiểm tra dữ liệu và theo dõi trên nhóm canary. Với dữ liệu thi đang mở, chờ attempt kết thúc rồi mới cutover; không đổi backend giữa phiên. Chuyển frontend/API theo feature flag hoặc traffic switch có thể đảo lại; kiểm tra login, join, autosave, submit, result, AI import ngay sau chuyển. Giữ V1 và backup cho đến hết cửa sổ rollback. Nếu không thể bảo đảm không gián đoạn dữ liệu khi cutover, công bố và chốt maintenance window trước khi thực hiện.

Sau khi ổn định, cập nhật default/deploy branch nếu cần, archive/tag các nhánh còn chứng cứ lịch sử, rồi xóa nhánh đã nhập hoặc được thay thế theo inventory Bước 1. Dọn file build/cache/duplicate chỉ sau khi so sánh nội dung và bảo tồn thay đổi chưa commit. Kiểm tra clone sạch vẫn build/deploy/restore theo runbook.

**Gate:** người dùng dùng được bản mới, có số liệu theo dõi và đường rollback; repo chỉ giữ nhánh hoạt động, release và các nhánh còn cần để khôi phục.

## 5. Danh mục nhánh và file cần bảo tồn lúc lập kế hoạch

| Mục | Trạng thái hiện thấy | Xử lý |
|---|---|---|
| `main` | baseline, remote SHA `4283076…`; PR #6 đang mở với `master` | Giữ |
| `devolop/AIV3` | current checkout và nguồn bản Vercel production đã ghi nhận; nhiều thay đổi chưa commit | Giữ cho đến khi port/đối soát/deploy hoàn tất |
| `ref/Repo` | hơn `main` 5 commit scaffold | Giữ tạm để đối chiếu; xét archive/xóa sau khi port |
| `master` | base của PR #6 đang mở | Giữ cho đến khi PR được xử lý |
| Các nhánh `codex/*`, `feat/*`, `feature/*`, `refactor/*`, `review/*` cũ | Nhiều nhánh đã nằm trong `main`; vài nhánh còn commit riêng | Chỉ xóa theo chứng cứ merge/PR/deployment/archive ở Bước 1 |
| `Qizzone/` lồng trong checkout hiện tại | Git checkout riêng ở `main` SHA `4283076…`, có thay đổi chưa commit và `.env` cục bộ | Đã ignore ở repo cha để tránh commit nhầm; giữ nguyên và so sánh trước khi chuyển ra ngoài hoặc dọn |
| `backend/**/obj`, `bin`, `node_modules`, output build | phát sinh từ công cụ, cần ignore đúng | Chỉ dọn cache đã xác định; giữ lockfile, migrations, source và fixture |

Kiểm kê Git ngày 2026-11-18 đã xác minh và xóa **21 nhánh remote có tip là tổ tiên của `main`**; SHA từng nhánh nằm trong [manifest](../audit/BRANCH_CLEANUP_2026-11-18.md). **Bảy nhánh chưa nhập `main`** cần giữ/đối chiếu: `codex/practice-option-labels-ordered`, `codex/shared-practice-question-frame`, `develop/AI`, `devolop/AIV3`, `devolop/AI_V1`, `master`, `ref/Repo`. Nhánh `main` cũng được giữ. Việc dọn file và các nhánh còn lại chỉ diễn ra khi dữ liệu AIV3 đã được chuyển và release đã ổn định.

## 6. Điều kiện dừng phát hành

Không chuyển traffic hoặc xóa V1 khi còn sai lệch bài thi/đáp án, thiếu quyền server side, thiếu backup restore đã thử, AIV3 chưa có corpus đại diện, CI không kiểm tra đúng SHA, worker gây ảnh hưởng autosave, hosting vượt ngân sách 0 đồng, hoặc host free không chịu được tải beta dự kiến. Khi gặp giới hạn của host miễn phí, giảm phạm vi beta có ghi rõ hoặc giữ V1 phục vụ; không đổi tên một bản staging thành production để vượt gate.
