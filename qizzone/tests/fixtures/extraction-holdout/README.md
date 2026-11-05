# Fixtures HOLDOUT — Qizzone AI Parser v2 (bước 27, PLAN_MAIN)

## Nguồn gốc và quy tắc sắt

- **100% synthetic, nội dung tự viết.** Không copy từ file thật nào của
  user (kể cả file ATTT 147 câu).
- Sinh lại bằng: `python3 generate-holdout.py h01 h02 h04` (cần
  python-docx) và `<venv có PyMuPDF> generate-holdout.py h03`.
- **HOLDOUT = chỉ đo, không sửa code theo nó.** Template ở đây CHƯA TỪNG
  xuất hiện trong quá trình phát triển (không có trong f01–f22, không
  dùng để sửa code trước bước 27). Sửa code theo holdout sẽ làm nó không
  còn unseen — phân tích và đề xuất sửa ghi trong PROGRESS.md (bước 27),
  để bước sau quyết định. Bộ chính vẫn là `../extraction/` (22 fixture,
  80 câu) với baseline đóng băng `baseline-rule-2026-11-05.json`.

## Vì sao mỗi fixture được tính là unseen

| ID | Dạng | Điểm khác template phát triển |
|---|---|---|
| h01 | DOCX inline options | 4 phương án chung 1 đoạn với stem, cách nhau 1 space, không dấu câu cuối phương án. Mọi fixture f01–f22 đều để mỗi phương án 1 đoạn riêng. |
| h02 | DOCX bảng-mỗi-câu | Mỗi câu là 1 hàng bảng 3 ô (stem, phương án, đáp án). f05 chỉ là bảng đáp án cuối file, f17 chỉ là bảng dữ liệu trong thân câu. |
| h03 | PDF 2 cột + chú thích giữa trang | Dòng toàn chiều rộng Ở GIỮA trang. f09/f21 chỉ có tiêu đề toàn chiều rộng ở ĐẦU trang. |
| h04 | DOCX nhãn La Mã | "Câu I.", "Câu II.", "Câu III.". Header regex của parser chỉ nhận số Ả Rập. |

## Quyết định kỳ vọng: dòng toàn chiều rộng ở giữa trang PDF 2 cột

Ghi TRƯỚC khi đo (giải quyết gap bước 26 để lại):

- **Thứ tự đọc:** khối cột trên (trái rồi phải), rồi dòng chú thích đúng
  vị trí Y của nó, rồi khối cột dưới. Đúng rule bước 15 ("dòng toàn
  chiều rộng phát đúng vị trí Y"), áp dụng cho đường kẻ giữa trang chứ
  không chỉ tiêu đề đầu trang.
- **Phân đoạn:** dòng chú thích là chú thích cấp trang, KHÔNG thuộc về
  bất kỳ câu nào — stem/options của câu ngay trước nó phải giữ nguyên.
- Dạng này thuộc HOLDOUT, không thuộc bộ chính, vì thứ tự đọc
  cột-trước/sau đường kẻ giữa trang chưa từng được đo hay dùng để sửa
  code trước bước 27.

## Kết quả đo bước 27 (không sửa code)

Bộ chính 22 fixture/80 câu (V1): 76/80 trích được, 73/80 khớp hoàn toàn
(91.25%), lệch stem 0, options 0, đáp án 3 (chỉ f07); sau reconcile
76/76 câu matched khớp hoàn toàn.

Holdout 4 fixture/13 câu (V1): 11/13 trích được (recall 84.6%,
precision 100%), 3/13 khớp hoàn toàn (23.1%), lệch stem 1, options 8,
đáp án 5, thiếu 2, extra 0, duplicate 0, lỗi 0, hallucination proxy 0%;
gate 3 complete / 1 needs_review / 0 failed; evidence 8 valid / 3
invalid / 7 unchecked; sourceNumber 10/11; page 4/4; chunks 4 complete.
Sau reconcile: lệch đáp án 8 (tệ hơn V1 vì pruned 3 ở h01), khớp hoàn
toàn 3, pruned 3.

Generalization gap: fullyOkRate 91.25% → 23.1% (−68 điểm), recall
95.0% → 84.6%, options match trên câu matched 100% → 27.3%, answer
match trên câu matched 96.1% → 54.5%.

Nguyên nhân theo fixture (chi tiết đầy đủ trong PROGRESS.md, bước 27):

- **h01** (stem 3/3, options 0/3, đáp án V1 3/3): chỉ option A tách
  được (stem kết thúc bằng "?" nên A qua được biên dấu câu + space);
  B/C/D sau từ thường + 1 space thì không; text A nuốt cả dòng. Đáp
  án V1 đúng cả 3 nhưng reconcile lược cả 3 về [] vì đáp án nằm ngoài
  options đã tìm được — cascade từ lỗi tách option.
- **h02** (stem 3/3, options 0/3, đáp án 0/3): tách option THÀNH CÔNG
  nhờ dấu chấm cuối mỗi phương án, nhưng ô đáp án bị dính vào text
  option D vì pattern đáp án cuối câu không chấp nhận đáp án sau TAB
  (flatten hàng bảng nối các ô bằng tab).
- **h03** (Q1/Q3/Q4 ok, Q2 lệch options + đáp án): thứ tự đọc ĐÚNG
  thiết kế (Q1, Q2, chú thích, Q3, Q4 — đã kiểm chứng bằng test debug
  tạm, xóa sau khi đo); rule cắt ghi chú cuối option đã gỡ chú thích
  khỏi text D; nhưng pattern đáp án cuối câu bắt buộc `$` cuối block
  nên đáp án Q2 (đứng trước chú thích) không tách được và dòng đáp án
  dính vào text D.
- **h04** (1/3 trích được, 2 missing): không header số Ả Rập nào nên
  fallback gộp toàn bộ tài liệu thành 1 câu; gate complete ở đây là
  false-complete (không tín hiệu nào phát hiện số câu thiếu khi header
  detection thất bại hoàn toàn).

## Chạy runner holdout

```sh
cd qizzone
npx vitest run src/utils/__tests__/extractionHoldout.test.ts
```

Ghi `holdout-report.json` + `holdout-benchmark.csv` trong thư mục này.
Runner không fail khi parser lệch ground truth (chỉ đo); chỉ fail khi
runner không chạy được.
