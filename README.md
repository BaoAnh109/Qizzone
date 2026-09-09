# Qizzone

## Hệ thống tạo đề và thi trắc nghiệm trực tuyến

Qizzone là đề tài xây dựng một nền tảng hỗ trợ giáo viên tổ chức thi trắc nghiệm và giúp học sinh làm bài trực tuyến trên cùng một hệ thống. Sản phẩm tập trung vào việc đơn giản hóa quá trình tạo đề, quản lý phòng thi, chấm điểm và theo dõi kết quả.

Ngoài cách soạn câu hỏi thủ công, Qizzone còn hỗ trợ nhập nội dung từ các tài liệu có sẵn như PDF, DOCX và hình ảnh. Các câu hỏi sau khi trích xuất được đưa vào màn hình kiểm tra để giáo viên chỉnh sửa trước khi tạo đề chính thức.

## Lý do chọn đề tài

Trong quá trình tổ chức kiểm tra, giáo viên thường phải thực hiện nhiều công việc riêng lẻ: soạn câu hỏi, tạo biểu mẫu, gửi đề, thu bài, chấm điểm và tổng hợp kết quả. Việc nhập lại câu hỏi từ tài liệu cũ cũng mất nhiều thời gian, đặc biệt với đề có công thức toán học.

Qizzone được xây dựng nhằm giải quyết các vấn đề đó bằng một quy trình thống nhất:

- Tạo và quản lý ngân hàng đề thi trên một nền tảng.
- Tận dụng tài liệu có sẵn để giảm thời gian nhập câu hỏi.
- Tổ chức phòng thi bằng mã truy cập ngắn gọn.
- Tự động lưu bài, nộp bài và chấm điểm.
- Cung cấp kết quả và thống kê ngay sau kỳ thi.
- Phân quyền rõ ràng giữa học sinh, giáo viên và quản trị viên.

## Mục tiêu

- Xây dựng hệ thống thi trắc nghiệm có thể sử dụng trên máy tính và thiết bị di động.
- Hỗ trợ đầy đủ quy trình từ tạo đề đến xem kết quả.
- Đảm bảo dữ liệu bài thi được lưu ổn định trong quá trình học sinh làm bài.
- Hạn chế việc lộ đáp án và thao tác trực tiếp vào dữ liệu quan trọng.
- Hỗ trợ công thức toán học và nội dung được nhập từ nhiều định dạng tài liệu.
- Tạo giao diện rõ ràng, dễ sử dụng trong môi trường giáo dục.

## Đối tượng sử dụng

### Học sinh

- Đăng ký và đăng nhập tài khoản.
- Tham gia phòng thi bằng mã do giáo viên cung cấp.
- Xem thông tin, quy định và thời gian của bài thi.
- Làm bài, đánh dấu câu hỏi và tiếp tục phiên thi còn thời hạn.
- Nhận kết quả và xem lại chi tiết theo cấu hình của giáo viên.
- Theo dõi lịch sử các bài đã hoàn thành.

### Giáo viên

- Đăng ký tài khoản và gửi yêu cầu phê duyệt.
- Tạo đề thi thủ công hoặc nhập câu hỏi từ tài liệu.
- Chỉnh sửa câu hỏi, đáp án, lời giải và công thức toán học.
- Cấu hình thời gian, điểm đạt, số lần làm và thứ tự câu hỏi.
- Xuất bản hoặc đóng phòng thi.
- Theo dõi danh sách bài nộp, điểm số và tỷ lệ hoàn thành.
- Xem chi tiết bài làm và xuất kết quả.

### Quản trị viên

- Xem danh sách tài khoản giáo viên đang chờ duyệt.
- Phê duyệt hoặc từ chối yêu cầu đăng ký giáo viên.
- Đảm bảo chỉ tài khoản hợp lệ được sử dụng chức năng quản lý đề thi.

## Chức năng chính

### Quản lý tài khoản và phân quyền

Hệ thống sử dụng ba vai trò: `student`, `teacher` và `admin`. Học sinh có thể sử dụng tài khoản ngay sau khi đăng ký, trong khi giáo viên cần được quản trị viên phê duyệt. Mỗi vai trò chỉ được truy cập các màn hình và dữ liệu phù hợp.

### Tạo và quản lý đề thi

Giáo viên có thể tạo đề mới, cập nhật đề hiện có, nhân bản đề, xem trước câu hỏi và thay đổi trạng thái phòng thi. Mỗi đề có mã phòng riêng để học sinh tham gia.

Một đề thi có thể cấu hình:

- Tên đề và môn học.
- Mô tả hoặc lưu ý dành cho học sinh.
- Thời gian làm bài.
- Số lần được phép thực hiện.
- Điểm hoặc tỷ lệ đạt.
- Đảo thứ tự câu hỏi.
- Quyền xem đáp án và lời giải sau khi nộp.

### Nhập câu hỏi từ tài liệu

Qizzone hỗ trợ đọc nội dung từ:

- Tệp PDF.
- Tệp Microsoft Word (`.docx`).
- Ảnh chụp hoặc ảnh scan đề thi.

Sau khi xử lý, giáo viên có thể kiểm tra từng câu hỏi, sửa nội dung, chọn lại đáp án đúng và bổ sung lời giải trước khi lưu vào đề thi.

### Hỗ trợ công thức toán học

Nội dung câu hỏi, đáp án và lời giải có thể chứa biểu thức LaTeX. Hệ thống hiển thị công thức bằng KaTeX, giúp các đề Toán và môn học có ký hiệu chuyên ngành được trình bày rõ ràng.

### Tổ chức phòng thi

Học sinh có thể nhập mã phòng hoặc chọn một phòng thi đang mở. Trước khi bắt đầu, hệ thống hiển thị thông tin đề, thời gian, số câu hỏi, số lần làm và các quy định liên quan.

Trong phòng thi, học sinh có thể:

- Chọn và thay đổi đáp án.
- Di chuyển giữa các câu hỏi.
- Đánh dấu câu cần xem lại.
- Theo dõi thời gian còn lại.
- Tiếp tục bài đang làm nếu phiên thi vẫn hợp lệ.
- Xác nhận trước khi nộp bài.

### Tự động lưu và chấm điểm

Đáp án được lưu trong quá trình làm bài để hạn chế mất dữ liệu khi tải lại trang hoặc gián đoạn kết nối. Khi hết giờ, hệ thống có thể tự động kết thúc phiên thi. Điểm số được tính phía server dựa trên đáp án chính thức thay vì tin tưởng dữ liệu từ trình duyệt.

### Kết quả và thống kê

Học sinh có thể xem điểm, số câu đúng, tỷ lệ hoàn thành và nội dung chi tiết nếu giáo viên cho phép. Giáo viên có thể theo dõi toàn bộ lượt nộp, điểm trung bình, tỷ lệ đạt và kết quả của từng học sinh.

## Quy trình hoạt động

```text
Quản trị viên duyệt giáo viên
              ↓
Giáo viên tạo hoặc nhập đề thi
              ↓
Giáo viên kiểm tra và xuất bản đề
              ↓
Học sinh tham gia bằng mã phòng
              ↓
Hệ thống lưu đáp án trong lúc làm bài
              ↓
Học sinh nộp bài hoặc hệ thống tự nộp khi hết giờ
              ↓
Server chấm điểm và lưu kết quả
              ↓
Học sinh xem kết quả · Giáo viên xem thống kê
```

## Kiến trúc hệ thống

Qizzone được tổ chức theo mô hình ứng dụng web kết hợp nhiều dịch vụ:

```text
React + TypeScript
        │
        ├── Firebase Authentication
        │       └── Đăng nhập và xác định danh tính người dùng
        │
        ├── Supabase Postgres
        │       ├── Hồ sơ người dùng
        │       ├── Đề thi và câu hỏi
        │       ├── Phiên làm bài và đáp án
        │       └── Kết quả và lịch sử
        │
        └── Supabase Edge Functions
                ├── Khởi tạo hồ sơ
                ├── Duyệt tài khoản giáo viên
                └── Trích xuất câu hỏi từ tài liệu
```

Frontend chịu trách nhiệm hiển thị giao diện và điều phối thao tác người dùng. Các nghiệp vụ nhạy cảm như chấm điểm, cấp quyền và sử dụng khóa dịch vụ được xử lý phía server.

## Bảo mật và toàn vẹn dữ liệu

- Firebase Authentication quản lý danh tính và phiên đăng nhập.
- Firebase custom claims kết hợp với hồ sơ người dùng để xác định vai trò.
- Supabase Row Level Security giới hạn dữ liệu theo người dùng và quyền sở hữu.
- Học sinh không được phép đọc trực tiếp đáp án của đề đang thi.
- Quá trình chấm điểm được thực hiện phía server.
- Gemini API key, Firebase Admin credentials và Supabase secret key không được đưa xuống trình duyệt.
- Giáo viên chưa được phê duyệt không thể truy cập dữ liệu quản lý đề thi.

## Công nghệ sử dụng

| Thành phần | Công nghệ |
| --- | --- |
| Giao diện | React 19, TypeScript, Tailwind CSS |
| Công cụ phát triển | Vite |
| Điều hướng | React Router |
| Quản lý trạng thái | Zustand |
| Form và kiểm tra dữ liệu | React Hook Form, Zod |
| Xác thực | Firebase Authentication |
| Cơ sở dữ liệu | Supabase Postgres |
| Phân quyền dữ liệu | Supabase RLS, RPC |
| Xử lý phía server | Supabase Edge Functions |
| Xử lý PDF và DOCX | PDF.js, Mammoth, JSZip |
| Công thức toán học | KaTeX |
| Trích xuất nội dung | Gemini API |
| Kiểm thử | Vitest, ESLint |

## Cấu trúc mã nguồn

```text
Qizzone/
├── qizzone/
│   ├── public/                 # Tài nguyên tĩnh
│   └── src/
│       ├── components/         # Component dùng chung và theo nghiệp vụ
│       ├── layouts/            # Bố cục xác thực, dashboard và phòng thi
│       ├── pages/              # Màn hình học sinh, giáo viên, quản trị viên
│       ├── routes/             # Điều hướng và bảo vệ route
│       ├── services/           # Kết nối dịch vụ và lớp truy cập dữ liệu
│       ├── store/              # Quản lý trạng thái ứng dụng
│       ├── types/              # Kiểu dữ liệu TypeScript
│       └── utils/              # Parser, chấm điểm và tiện ích
├── supabase/
│   ├── functions/              # Edge Functions
│   ├── migrations/             # Cấu trúc và chính sách database
│   ├── scripts/                # Công cụ quản trị
│   └── seed.sql                # Dữ liệu phục vụ local/dev
├── .github/workflows/           # Kiểm tra tự động bằng CI
└── vercel.json                  # Cấu hình triển khai frontend
```

## Điểm nổi bật của đề tài

- Kết hợp quy trình tạo đề, tổ chức thi và thống kê trong một sản phẩm thống nhất.
- Hỗ trợ tận dụng lại đề thi từ nhiều loại tài liệu.
- Xử lý tốt nội dung có công thức toán học.
- Có cơ chế tự động lưu và khôi phục phiên làm bài.
- Chấm điểm và kiểm soát quyền truy cập phía server.
- Có quy trình phê duyệt giáo viên thay vì cho phép mọi tài khoản tự nhận quyền.
- Giao diện responsive, phù hợp cho cả giáo viên và học sinh.
- Có bộ kiểm thử cho các nghiệp vụ quan trọng và quy tắc bảo mật.

## Hướng phát triển

- Bổ sung ngân hàng câu hỏi dùng chung theo môn học và chủ đề.
- Hỗ trợ thêm nhiều dạng câu hỏi ngoài lựa chọn một đáp án.
- Tạo ma trận đề và sinh nhiều mã đề từ cùng một ngân hàng câu hỏi.
- Thêm biểu đồ phân tích độ khó và chất lượng từng câu hỏi.
- Bổ sung lịch thi, thông báo và giới hạn thời gian mở phòng.
- Hỗ trợ xuất đề, đáp án và báo cáo sang nhiều định dạng hơn.
- Hoàn thiện cơ chế giám sát và chống gian lận trong phòng thi.

## Kết luận

Qizzone hướng đến việc số hóa toàn bộ quy trình tổ chức một bài thi trắc nghiệm, từ khâu chuẩn bị nội dung đến chấm điểm và phân tích kết quả. Đề tài thể hiện khả năng kết hợp giao diện web hiện đại, xác thực người dùng, phân quyền dữ liệu, xử lý tài liệu và nghiệp vụ thi trực tuyến trong một hệ thống hoàn chỉnh.
