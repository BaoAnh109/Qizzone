# Fixtures extraction — Qizzone AI Parser v2 (bước 02, PLAN_MAIN)

## Nguồn gốc

- **100% synthetic, nội dung tự viết.** Không copy từ file thật nào của
  user (kể cả file ATTT 147 câu — file đó chỉ dùng cục bộ để hiểu dạng
  đề, không đưa nội dung vào đây, không commit lên repo).
- Sinh lại bằng: `python generate-fixtures.py` (cần python-docx, Pillow,
  PyMuPDF; font DejaVuSans cho PDF tiếng Việt).

## Cấu trúc

Mỗi fixture gồm 1 file nguồn + 1 file `<id>.expected.json`:

| Trường expected | Ý nghĩa |
|---|---|
| `order` | Thứ tự xuất hiện trong file |
| `label` | Nhãn gốc trong file (vd `Câu 14` ở fixture số không liên tục) |
| `type` | `single_choice` / `true_false` / `multiple_choice` |
| `stem`, `options` | Nội dung câu hỏi và các lựa chọn |
| `correctAnswers` | Đáp án đúng; `[]` khi nguồn thực sự không có đáp án |
| `answerOrigin` | `highlight` / `bold` / `underline` / `answer_line` / `answer_table` / `none` |
| `page`, `evidence`, `hasImage` | Vị trí, bằng chứng, có ảnh đính kèm hay không |

## Danh sách (22 fixture, 80 câu)

> Bước 26 bổ sung f16–f22 (25 câu). Lưu ý: f16–f22 đã dùng để phát hiện
> và sửa heuristic strip header lặp (bước 26) nên KHÔNG được tính là
> unseen cho holdout bước 27 — holdout phải là template chưa từng xuất
> hiện trong quá trình phát triển.

| ID | Dạng | Điểm đo |
|---|---|---|
| f01 | DOCX tô vàng | đáp án bằng highlight |
| f02 | DOCX in đậm | đáp án bằng bold duy nhất |
| f03 | DOCX gạch chân | đáp án bằng underline |
| f04 | DOCX dòng đáp án | `Đáp án: X` cuối mỗi câu |
| f05 | DOCX bảng đáp án | bảng cuối file |
| f06 | DOCX đúng/sai | mệnh đề + Đúng/Sai (parser hiện chỉ biết A–D) |
| f07 | DOCX nhiều đáp án | 2 đáp án đúng/câu, cùng tô vàng |
| f08 | DOCX ảnh + công thức | ảnh đính kèm, phân số OMML |
| f09 | PDF 2 cột | thứ tự đọc theo cột |
| f10 | PDF scan | chỉ có ảnh, không text layer (parser chưa có OCR) |
| f11 | DOCX header lặp | header xen giữa các câu |
| f12 | DOCX số không liên tục | Câu 2, 5, 9, 14 |
| f13 | DOCX không đáp án | kỳ vọng `correctAnswers=[]` |
| f14 | TXT thuần không đáp án | kỳ vọng `correctAnswers=[]` |
| f15 | PDF text 1 cột | trường hợp PDF cơ bản |
| f16 | DOCX tiền đề chung | tiền đề lặp ở đầu thân 3 câu, stem phải GIỮ tiền đề (bước 26 sửa heuristic strip header lặp: chỉ xét cuối khối, không xét đầu thân câu) |
| f17 | DOCX bảng trong thân | bảng dữ liệu trong stem, không phải bảng đáp án cuối file |
| f18 | DOCX stem dài | stem 3 đoạn văn, đáp án cuối câu |
| f19 | DOCX ký tự đặc biệt | x^2, ℃, ≥, ≤, ≠ dạng text thuần + câu song ngữ Anh–Việt |
| f20 | DOCX 2 section | header/footer khác nhau theo section, không được lọt vào câu |
| f21 | PDF 2 cột không đều | cột trái rộng (x=40), cột phải hẹp (x=360) + tiêu đề toàn chiều rộng |
| f22 | PDF 2 trang | gắn page đúng trang cho câu ở trang 2 |

## Chạy runner

```sh
sh qizzone/tests/fixtures/extraction/run-fixtures.sh
# hoặc: cd qizzone && npx vitest run src/utils/__tests__/extractionFixtures.test.ts
```

Runner chạy parser luật hiện tại (không Gemini, không OCR), so theo
order: missing / extra / duplicate / stem mismatch / options mismatch /
answer mismatch, ghi `report.json` trong chính thư mục này.

**Runner cố tình không fail test khi parser lệch ground truth:**
bước 02 là đo, bước 03 mới đóng băng baseline từ `report.json`.

## Holdout bước 27 (thư mục riêng, không gộp vào bộ này)

Bộ holdout unseen nằm ở `../extraction-holdout/` (h01–h04, 13 câu) với
runner riêng `src/utils/__tests__/extractionHoldout.test.ts`, ghi
`holdout-report.json` riêng — không ghi vào `report.json` ở đây, không
sửa baseline đóng băng. Xem chi tiết lý do unseen, quyết định kỳ vọng
dòng giữa trang và kết quả đo trong `../extraction-holdout/README.md`
và PROGRESS.md (bước 27). Quy tắc sắt: chỉ đo holdout, không sửa code
theo holdout.
