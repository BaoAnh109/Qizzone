# Qizzone — tình trạng triển khai nhận diện đề

**Cập nhật:** 17/11/2026
**Branch:** `devolop/AIV3`
**Kế hoạch:** `Qizzone_Comprehensive_Document_Extraction_Implementation_Plan.md` (16/11/2026)
**Trạng thái:** Đã triển khai và kiểm thử trên local; chưa triển khai Vercel/Supabase production. `main` chưa thay đổi.

## Phần đã triển khai

- Nhập DOCX, PDF, PNG, JPG/JPEG và WebP; kiểm tra phần mở rộng/chữ ký tệp, giới hạn kích thước và bảo vệ DOCX trước archive có đường dẫn hoặc kích thước giải nén bất thường.
- DOCX được đọc trực tiếp từ OpenXML để giữ thứ tự đoạn/bảng, danh sách, công thức OMML và kiểu chữ bold/underline/highlight/màu. PDF giữ text, vị trí trang, style, highlight annotation, vùng highlight tô bằng vector và chữ đáp án tô đỏ.
- OCR chạy trong trình duyệt bằng Tesseract tiếng Việt/Anh cho ảnh, ảnh nhúng trong DOCX và tối đa 10 trang scan mỗi lượt. Trang ít text được cảnh báo; trang vượt giới hạn được đánh dấu chưa xử lý.
- Document IR có hash nguồn, block, thứ tự đọc, style và source reference. PDF có tọa độ trang; DOCX hiện giữ paragraph/run reference nhưng chưa có tọa độ trang. Trình xem nguồn có thể nhảy/tô block khớp câu.
- Parser nhận dạng phương án A–D, ①–④, cặp Đúng/Sai không có nhãn, cùng dòng/nhiều dòng; đáp án từ ký hiệu, gạch chân, highlight, bold, màu đỏ, đáp án cuối câu và bảng/cuối file gồm các nhãn `[A]`, `(A)`, `✓`, `→`, `★`, `Đáp án C`. Xung đột được để `ambiguous`; thiếu chứng cứ giữ `correctAnswers=[]`. Giới hạn nhập là 1.000 câu/tệp để không ghép câu 301+ vào câu 300.
- Gemini chỉ là fallback cấu trúc có giới hạn; đầu ra phải khớp nguyên văn nguồn và đúng nhãn phương án. Không nhận đáp án hoặc lời giải từ AI. Câu không có ít nhất hai nhãn phương án nguồn không được gửi fallback chỉ để AI tự tạo lựa chọn.
- Edge Function xác thực Firebase token và role teacher/admin, giới hạn body 8 MB, source 100.000 ký tự và ảnh, dùng quota theo user, timeout 40 giây mỗi model, tối đa hai model; không nhận API key/model do client chọn và không ghi nội dung đề/token vào log.
- Luồng tạo đề không còn tự gán A cho câu chưa rõ. Thiếu đáp án/phương án thì không lưu/xuất bản; đề chuyển từ trích xuất sang cấu hình phải được giáo viên xác nhận đã rà nguồn. Thay đổi câu sau khi xác nhận sẽ khóa xuất bản lại.
- Thêm unit, integration/security và benchmark opt-in đọc tài liệu thực từ thư mục bên ngoài repo. Tài liệu mẫu không được chép vào repo.

## Kết quả benchmark tài liệu thực

Chạy trên các mẫu trong `E:\Admin\Download`; thời gian là đo local, không phải SLO production.

| Tài liệu | Câu nhận diện | Phương án nhận diện | Đáp án có chứng cứ | Thời gian |
|---|---:|---:|---:|---:|
| `10_cau_trac_nghiem_triet_hoc_danh_dau_ngay_dap_an.docx` | 10/10 | 6 câu 4 lựa chọn; 2 câu có 2; 2 câu có 3 | 8/10; 2 câu không có đáp án rõ | 37 ms |
| `10_cau_trac_nghiem_triet_hoc.docx` | 10/10 | 10/10 A–D | 10/10 từ bảng đáp án đa định dạng | 24 ms |
| `60_cau_trac_nghiem_triet_hoc_4_kieu_danh_dau.docx` | 60/60 | 60/60 A–D | 59/60; một câu không có chứng cứ | 359 ms |
| `147_cau_ATTT_dap_an_to_vang.docx` | 147/147 | 101 câu A–D; 46 câu Đúng/Sai | 147/147 | 1,36 s |
| `147_cau_ATTT_dap_an_to_vang.pdf` | 147/147 | 101 câu A–D; 46 câu Đúng/Sai | 147/147 | 3,31 s |
| `TNChuong3.pdf` | 55/55 | 55/55 A–D | 0/55; nguồn không có đáp án đánh dấu | 0,60 s |

Đối chiếu cặp DOCX/PDF 147 câu: nội dung câu **147/147**, cả câu và lựa chọn **147/147**, nhãn đáp án đánh dấu trùng nhau **147/147**. Trong đó có 46 câu Đúng/Sai vốn đã có sẵn trong tài liệu. Đây là độ đồng thuận giữa hai bản cùng nguồn, không phải độ chính xác trên bộ đáp án vàng độc lập.

PDF `CNXHKH 2024 HUIT.docx.pdf`: kiểm tra trang 1 xác nhận màu chữ đỏ được giữ làm chứng cứ; các lựa chọn đỏ gồm `C. Tuyên ngôn của Đảng Cộng sản` ở câu 1 và `A. Là những quy luật...` ở câu 2. Ca này kiểm tra lớp màu trang nguồn, không chạy trích xuất toàn bộ 62 trang.

OCR: ảnh raster trang 2 của `TNChuong3.pdf` trả 1.330 ký tự, confidence 94%, nhận 4/4 câu của trang. Đây là trang PDF có text gốc được render thành ảnh để đo OCR, **không phải kiểm thử end-to-end bằng PDF scan-only**. Các tài liệu benchmark không cần Gemini fallback.

## Kiểm tra chạy được

- `npm test`: 29 test file qua, 139 test qua; 2 file/10 test opt-in bị bỏ qua khi không đặt đường dẫn tài liệu.
- Benchmark opt-in: **10/10 qua**; gồm 6 tài liệu, đối chiếu DOCX/PDF, OCR, màu chữ đỏ trang 1 và kiểm tra đủ **353 ranh giới câu**, tách riêng câu 301–302 trong PDF `CNXHKH 2024 HUIT.docx.pdf`. Đặt `QIZZONE_REAL_DOCS_DIR=E:\Admin\Download`, `QIZZONE_REAL_OCR_IMAGE_PATH` trỏ tới ảnh raster trang 2, rồi chạy `npx vitest run --reporter=verbose src/utils/__tests__/realDocumentBenchmark.test.ts src/utils/__tests__/pdfRedTextAnswer.test.ts`.
- `npm run build`: qua; chunk parser lớn nhất 583 kB (156 kB gzip), PDF parser 429 kB (129 kB gzip).
- `npm run lint`: qua, không warning.
- `npm audit` và `npm audit --omit=dev`: 0 lỗ hổng sau khi ghim `minimatch` ở bản đã vá.

## Giới hạn và việc còn lại

- Chưa có tập tài liệu scan-only được gán nhãn độc lập, nên chưa thể công bố question recall/option exact match/answer precision theo KPI trong kế hoạch. Benchmark hiện chứng minh kết quả của những mẫu cụ thể ở trên.
- OCR và tạo ảnh PDF chạy trên CPU trình duyệt; model tiếng Việt/Anh tải lần đầu khoảng 6,9 MB. Chưa có worker/queue nền. Tối đa 10 trang scan/ảnh nhúng được OCR mỗi lượt.
- Chưa kiểm thử layout nhiều cột, câu kéo qua trang, hình/bảng phức tạp hoặc tọa độ trang DOCX. DOCX chỉ có vị trí theo paragraph/run.
- Chưa đo tỉ lệ gọi fallback, latency/chi phí Gemini thực tế hoặc thử Gemini với bộ prompt-injection tài liệu riêng; chưa có regional fallback, cache hay xử lý job nền.
- `sourceHash`/reference hiện thuộc phiên trích xuất trên client; provenance chưa được lưu cùng đề thi sau khi tạo.
- Cần deploy Edge Function và chạy smoke test trên staging trước production. Chưa có xác nhận production về secret, quota, CORS, Vercel build hoặc luồng đăng nhập thực.

## Hướng dẫn triển khai sau khi kiểm tra staging

1. Cấu hình secret trên Supabase Functions: `FIREBASE_SERVICE_ACCOUNT`, `GEMINI_API_KEY`, `ALLOWED_ORIGINS`; có thể đặt `GEMINI_MODEL=gemini-3.8-flash` và `GEMINI_FALLBACK_MODEL=gemini-3.5-flash-lite`. URL và service-role key lấy từ môi trường Supabase Function.
2. Deploy `extract-quiz-with-gemini` lên project staging; kiểm tra role teacher/admin, quota `consume_ai_quota`, CORS, timeout, lỗi upstream và giới hạn input.
3. Deploy branch này lên preview Vercel và thử DOCX/PDF/ảnh, PDF scan-only, câu không có đáp án, câu bị thiếu phương án, đáp án mâu thuẫn và nút xác nhận review.
4. Chỉ sau khi smoke test pass mới lên production theo quy trình release của repo. Lượt làm việc này chưa deploy hay chạy migration production.
