# AIV3 — Trạng thái triển khai

Nguồn kế hoạch: `Qizzone_Comprehensive_Document_Extraction_Implementation_Plan.md` (16/11/2026).

## Đã thực hiện (bước đầu P0)

- Tạo branch `devolop/AIV3` từ `main`, không thay đổi `main`.
- Bỏ hành vi tự tạo bốn phương án giả khi parser không nhận diện được lựa chọn.
- Chấp nhận câu có 2 hoặc 3 phương án mà không mặc định báo thiếu D.
- Thay prompt trích xuất AI: không suy luận/giải đáp án trong chế độ extraction.
- Chuyển đường trích xuất văn bản trong `aiExtractionService` sang parser-first, Gemini fallback khi câu bị thiếu lựa chọn hoặc không có câu.
- Thêm regression tests cho các trường hợp trên.

## Chưa hoàn thành — không được coi là production-ready

- Chưa có Document IR giữ vị trí/style/evidence chuẩn.
- Chưa triển khai Python FastAPI worker, OOXML/PyMuPDF/OCR/layout.
- Chưa có kiểm tra độ phủ trang, phát hiện câu bị bỏ sót hoặc lỗi thứ tự đọc.
- Chưa có answer-evidence conflict resolver, audit log, human review gate và quota AI.
- Chưa có benchmark end-to-end trên PDF/DOCX/scan thực tế.
- Chưa chạy `npm test`, `npm run lint`, `npm run build` trong môi trường CI.
- Đường parser-first hiện chỉ là tối ưu ban đầu: có thể bỏ sót câu dù các câu đã nhận diện đều hợp lệ; không sử dụng nó làm bằng chứng trích xuất hoàn chỉnh.

## Việc cần làm tiếp

1. Audit đầy đủ luồng upload và định dạng hiện tại, thêm test tài liệu mẫu.
2. Thiết kế IR + evidence, giữ nguyên số câu và vị trí nguồn.
3. Xây worker CPU cho DOCX/PDF, kiểm tra coverage.
4. Thêm OCR, region fallback, hàng đợi và giới hạn chi phí.
5. Kiểm thử tích hợp, benchmark và human-review gate trước khi release.

Không merge sang `main` nếu chưa được kiểm thử và phê duyệt.
