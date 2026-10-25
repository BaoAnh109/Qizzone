# Qizzone — Review production / Vòng 1

## Hồ sơ baseline

- Ngày audit: 2026-10-23.
- Branch gốc theo prompt: `develop/v1` không tồn tại trong danh sách branch local hoặc remote.
- Branch làm việc: `review/production-v1`, tạo từ branch sạch `refactor/optimize-login-router` để giữ nguyên `main`/`master` và branch gốc; đây là sai khác cần nhớ khi so sánh.
- Commit xuất phát: `919dbfd fix(ai): resolve Gemini overload with adaptive batching and multi-model fallback`.
- Working tree trước audit: sạch.
- `npm run lint`: PASS.
- `npm test`: PASS — 19 test files, 93 tests.
- `npm run build`: PASS — Vite 8.2.1, 2,343 modules.
- `qizzone/dist`: 3,496,046 bytes (~3.50 MB); chunk JS lớn nhất `document-parser-*.js` 583.14 kB (569.5 KiB), tiếp theo PDF parser 430.88 kB.
- Baseline prompt nói 68 test; số thật ở branch này là 93. Không có `REVIEW.md` hoặc `develop/v1` để đối chiếu.

## Tóm tắt audit 9 mặt

1. **Kiến trúc & code:** lớp service được dùng cho quiz/auth/admin, component không gọi `supabase.from` trực tiếp; `examSessionStore.ts` vẫn gọi `rpc` từ `lib/cloud` thay vì qua `services/`. Số dòng hiện tại: `CreateQuiz.tsx` 1,181; `QuizRoom.tsx` 468; `QuizResultsView.tsx` 441; `ruleExtractor.ts` 522; `docxAstParser.ts` 669. Có một số `any` có chủ đích ở biên PDF.js; không thấy TODO/FIXME thật trong source.
2. **Bảo mật:** migration tách `question_answer_keys`, bật RLS, chỉ cho chủ quiz đọc đáp án; `list_quizzes()` ẩn đáp án với học sinh; chấm điểm nằm trong `private.finalize_attempt`; Edge Function xác minh Firebase token server-side và giữ Gemini key ở biến môi trường server. **P0:** HTML từ DOCX đi từ Mammoth/OpenXML tới `dangerouslySetInnerHTML` mà không sanitize; Mammoth cảnh báo rõ tài liệu đầu vào không được sanitize và link `javascript:` có thể thực thi mã khi nhấn. RLS cho phép học sinh đọc đề `published`; đáp án vẫn bị che. `assignedClasses`/`assignedEmails` hiện lọc dashboard phía client, còn join bằng code/link là luồng được hỗ trợ; cần chủ repo xác nhận đây là chủ ý nếu muốn dùng assignment làm ranh giới quyền.
3. **Đúng đắn / lỗi:** server kiểm tra lượt làm, trạng thái đề, deadline, revision và đáp án hợp lệ; `submit_attempt` trả kết quả cũ khi nộp trùng; hết giờ vẫn chấm dữ liệu đã lưu. `save_quiz` cấm đề rỗng. Thiếu test tích hợp cho nộp trùng và khôi phục sau reload khi câu trả lời chưa đồng bộ. Mất kết nối được báo trạng thái và retry khi mạng về, nhưng câu trả lời mới nhất chỉ còn trong Zustand memory khi chưa lưu server.
4. **Tính năng:** có tìm/lọc danh sách, nhân bản đề, lịch sử/làm lại có giới hạn, xuất kết quả CSV, xáo trộn câu và phương án. Chưa có phân tích chất lượng theo từng câu và ngân hàng câu hỏi tái sử dụng độc lập giữa các đề. Web research ủng hộ ưu tiên xuất bảng tính và báo cáo theo câu hỏi; tránh game hóa nặng, trả phí hoặc giám sát xâm lấn.
5. **Hiệu năng:** route đã lazy-load; store debounce lưu đáp án 450 ms; `useMemo` đang dùng ở một số màn hình. Không tìm thấy `content-visibility` hay debounce riêng cho KaTeX. Bundle parser PDF/DOCX lớn; chưa có benchmark thời gian render hoặc đo trên điện thoại/mạng yếu, vì vậy không tuyên bố đã đạt mục tiêu hiệu năng.
6. **Trải nghiệm & accessibility:** giao diện và lỗi chính bằng tiếng Việt, có trạng thái lưu và skeleton/loading; một số trang có trạng thái rỗng. Có responsive classes nhưng chưa có kiểm tra bàn phím, tương phản, screen reader hay E2E mobile tự động. Chưa có bằng chứng đủ để chấm PASS accessibility.
7. **Testing:** 19 file test, 93 test; có PGlite thực thi các migration thật và kiểm tra role/RLS/answer keys/chấm điểm, test debounce và hết giờ. Còn thiếu test UI upload lỗi, reload/offline, nộp trùng, đề rỗng ở DB và route role bằng trình duyệt thật. Không có Playwright/Cypress trong dependency.
8. **Production / vận hành:** CI chỉ chạy push/PR nhắm `main`, `master`, `develop`; không chạy khi push branch `review/*`. `vercel.json` có SPA rewrite và cache asset 1 năm nhưng chưa có header bảo mật. `.env.example` phía client chỉ có public `VITE_*`; Edge Functions có env example riêng cho secret server. Seed tự ghi rõ local/dev. Có 4 migration theo thứ tự ngày nhưng không kèm rollback; README chưa có hướng dẫn setup/deploy/backup theo bước. Chưa có quyền dashboard để xác minh backup, health check hoặc log cấu hình đang chạy.
9. **Tài liệu:** README mô tả khá đầy đủ sản phẩm và cấu trúc, nhưng phần cài đặt/deploy/rollback thiếu; `cloud.ts` hướng người dùng tới `SETUP.md` nhưng file này không có. Chưa có changelog hay release checklist.

## Web research (truy cập 2026-10-23)

### Tài liệu chính thức

- React `memo`: https://react.dev/reference/react/memo — tối ưu render là tối ưu hóa, không bảo đảm component không render lại.
- Vite build production: https://vite.dev/guide/build — bundle build phù hợp static hosting; cần đánh giá kích thước và browser target từ bundle thực tế.
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security — chính sách RLS là lớp bảo vệ truy cập hàng dữ liệu.
- Supabase database functions/RPC: https://supabase.com/docs/guides/database/functions — dùng database function cho nghiệp vụ phía Postgres.
- Supabase Edge Functions: https://supabase.com/docs/guides/functions — server-side TypeScript cho logic cần giữ secret.
- Firebase Authentication: https://firebase.google.com/docs/auth
- Firebase Admin verify ID tokens: https://firebase.google.com/docs/auth/admin/verify-id-tokens
- Vercel Deployments: https://vercel.com/docs/deployments
- Mammoth.js security: https://github.com/mwilliamson/mammoth.js/#security — upstream nói không sanitize nguồn và cảnh báo link `javascript:` trong HTML nhúng.

### Sản phẩm / chuẩn tính năng

- Wayground (Quizizz): báo cáo bảng dữ liệu có thể tìm/sắp xếp/xuất: https://help.wayground.com/support/solutions/articles/158000453034-reports-detailed-data-tables ; báo cáo theo câu hỏi/lớp: https://help.wayground.com/support/solutions/articles/158000432331-understanding-your-common-assessment-class-report-for-teachers
- Kahoot!: báo cáo spreadsheet XLSX/Google Drive với summary và sheet theo câu: https://support.kahoot.com/hc/en-us/articles/360035547493-How-to-download-and-use-spreadsheet-reports
- Google Forms: xem câu trả lời theo câu/người và xuất CSV/Sheets: https://support.google.com/docs/answer/139706?hl=en
- Microsoft Forms: summary, câu hỏi, từng người và xuất Excel: https://support.microsoft.com/en-us/forms/view-results-of-your-form
- Moodle Quiz: question bank tái sử dụng: https://docs.moodle.org/400/en/Using_question_bank ; thống kê câu hỏi: https://docs.moodle.org/402/en/Quiz_statistics_report
- Canvas New Quizzes: Quiz/Item Analysis và CSV: https://community.canvaslms.com/t5/Guia-do-Instrutor/Como-eu-vejo-os-relat%C3%B3rios-de-um-teste-em-Novos-Testes/ta-p/473184

### Kết luận áp dụng cho Qizzone

Ưu tiên bảo vệ nội dung DOCX nhập vào, tránh mất câu trả lời khi mạng trường chập chờn, giữ export CSV hiện có và bổ sung thống kê theo câu khi phù hợp. Ngân hàng câu hỏi có thể tái sử dụng đáng cân nhắc sau v1. Không đề xuất phụ thuộc trả phí, game hóa bắt buộc hay theo dõi xâm lấn.

## Task đã giao

## QZ-P0-01 — Làm sạch HTML xem trước từ DOCX
- Mức: P0 (chặn production)
- Vấn đề / bằng chứng: `qizzone/src/utils/parsers/docxParser.ts:36,63-79` đưa HTML AST/Mammoth vào `rawHtml`; `qizzone/src/components/teacher/extraction/DocumentViewer.tsx:225-228` render bằng `dangerouslySetInnerHTML` không sanitize. Tài liệu bảo mật Mammoth.js nêu link `javascript:` trong nguồn có thể thực thi mã khi nhấn: https://github.com/mwilliamson/mammoth.js/#security
- Phạm vi: chỉ sửa `qizzone/src/components/teacher/extraction/DocumentViewer.tsx` và test/helper sanitization cần thiết. KHÔNG làm: đổi parser, DB/RLS, kiến trúc auth.
- Tiêu chí nghiệm thu (đo được): preview loại bỏ script/event handler và URL `javascript:`; nội dung đề, bảng, định dạng an toàn vẫn hiển thị; test khóa sink vào HTML đã sanitize.
- Test cần chạy / thêm: test payload DOCX độc hại cho nhánh HTML xem trước; `npm run lint`, `npm test`, `npm run build`; kiểm tay preview DOCX hợp lệ.
- Rủi ro / rollback: DOMPurify đã là dependency; cấu hình mặc định có thể loại một số markup lạ, cần kiểm tra bảng/ảnh/định dạng Word. Rollback bằng cách giữ sink dưới helper sanitize đã kiểm chứng, không khôi phục raw HTML.
- Trạng thái: [x] Xong — Vòng 2; `npm run lint` PASS, `npm test` PASS (19 file / 94 test), `npm run build` PASS. Chrome probe với `<script>`, `onerror` và `javascript:` cho `scriptCount=0`, `eventHandler=false`, `unsafeHref=false`, `executed=false`.

## QZ-P0-02 — Vá các dependency có cảnh báo bảo mật
- Mức: P0 (chặn production)
- Vấn đề / bằng chứng: sau `npm ci`, `npm audit --omit=dev` báo 10 lỗ hổng runtime (9 high, 1 critical), gồm DOMPurify `3.4.14` có advisory XSS [GHSA-p98j-92pf-mc4p](https://github.com/advisories/GHSA-p98j-92pf-mc4p). Audit còn báo `@grpc/grpc-js` `1.9.16` qua `@firebase/firestore`.
- Phạm vi: chỉ sửa `qizzone/package.json` và `qizzone/package-lock.json`. KHÔNG hạ major Firebase hoặc dùng `npm audit fix --force`.
- Tiêu chí nghiệm thu (đo được): cài sạch; `npm audit` và `npm audit --omit=dev` đều 0 vulnerability; lint, test, build pass.
- Test cần chạy / thêm: `npm ci --ignore-scripts`, `npm audit`, `npm audit --omit=dev`, `npm run lint`, `npm test`, `npm run build`.
- Rủi ro / rollback: bản vá theo semver, Vitest lên patch `4.1.12`; override `@grpc/grpc-js` lên `1.13.6` để sửa dependency range hẹp `~1.9.0` của Firestore. Qizzone chỉ import Firebase App/Auth, không import Firestore; nếu thêm Firestore phía server thì phải kiểm tra lại tương thích. Rollback các thay đổi package ở commit này nếu kiểm thử Firestore mới thất bại.
- Trạng thái: [x] Xong — cập nhật dependency không force; cài sạch báo 0 vulnerabilities; `npm audit` / `npm audit --omit=dev` sạch; `npm run lint` PASS, `npm test` PASS (22 file / 105 test), `npm run build` PASS.

## QZ-P1-01 — Khôi phục câu trả lời chưa đồng bộ sau mất mạng
- Mức: P1 (thiếu quan trọng)
- Vấn đề / bằng chứng: `qizzone/src/store/examSessionStore.ts:14-18,99-116` giữ phiên trong Zustand memory và gửi save sau 450 ms; `qizzone/src/pages/student/QuizRoom.tsx:83-94,216-232` retry khi mạng về nhưng không lưu bản nháp cục bộ. Reload khi offline trước lần save thành công làm mất những thay đổi chưa tới server.
- Phạm vi: chỉ sửa `qizzone/src/store/examSessionStore.ts`, `qizzone/src/pages/student/QuizRoom.tsx` nếu cần, và `qizzone/src/store/__tests__/examSessionStore.test.ts`. KHÔNG làm: đổi schema, quyền chấm điểm, lưu đáp án đúng ở client.
- Tiêu chí nghiệm thu (đo được): một câu trả lời chưa đồng bộ vẫn phục hồi sau reset/reload mô phỏng, chỉ đồng bộ vào đúng attempt khi có mạng, và bản nháp bị xóa sau khi server xác nhận hoặc bài nộp; xung đột revision không ghi đè dữ liệu server.
- Test cần chạy / thêm: mô phỏng offline → thay đáp án → reload → online; mô phỏng revision conflict; `npm run lint`, `npm test`, `npm run build`.
- Rủi ro / rollback: local storage giữ lựa chọn của chính học sinh trên thiết bị dùng chung; khóa dữ liệu theo attempt và xóa khi kết thúc. Rollback riêng cơ chế local draft, giữ autosave server hiện tại.
- Trạng thái: [x] Xong — Vòng 2; `npm run lint` PASS, `npm test` PASS (19 file / 96 test), `npm run build` PASS. Test mới mô phỏng offline → reload → đồng bộ; test revision conflict xác nhận giữ local draft và không gọi RPC ghi đè.

## QZ-P1-02 — Chạy CI trên branch review và mọi pull request
- Mức: P1 (thiếu quan trọng)
- Vấn đề / bằng chứng: `.github/workflows/ci.yml:3-13` chỉ giới hạn push/PR vào `main`, `master`, `develop`; không có trigger push trên `review/production-v1` hoặc PR nhắm nhánh khác.
- Phạm vi: chỉ sửa `.github/workflows/ci.yml`. KHÔNG làm: thêm service, secret, hoặc thay pipeline lint/test/build hiện có.
- Tiêu chí nghiệm thu (đo được): push trên `review/*` chạy workflow; PR từ branch bất kỳ cũng chạy đủ lint, test và build; workflow YAML hợp lệ.
- Test cần chạy / thêm: kiểm tra cấu hình workflow và chạy lại ba lệnh ở app; xác nhận trigger qua GitHub Actions khi có push/PR (chưa thể xác minh từ checkout local).
- Rủi ro / rollback: chạy CI nhiều hơn trên các nhánh. Rollback bằng cách khôi phục branch filter cũ nếu vượt quota Actions của repo.
- Trạng thái: [x] Xong — Vòng 2; `npm run lint` PASS, `npm test` PASS (19 file / 96 test), `npm run build` PASS; workflow đã kiểm tra bằng cấu hình source: push bao gồm `review/**`, pull request không lọc branch đích. Chạy trigger trên GitHub cần push/PR và chưa xác minh từ checkout local.

## QZ-P2-01 — Giới hạn kích thước tệp nhập đề
- Mức: P2 (UX/hiệu năng)
- Vấn đề / bằng chứng: `qizzone/src/components/teacher/extraction/FileDropzone.tsx:45-55` kiểm tra phần mở rộng nhưng không chặn kích thước; parser đọc toàn bộ file vào `arrayBuffer` (`qizzone/src/utils/parsers/docxParser.ts:23`, `pdfParser.ts:26`). Mammoth cảnh báo tài liệu tạo pathological CPU/memory: https://github.com/mwilliamson/mammoth.js/#security . Edge Function từ chối request JSON lớn hơn 8 MB (`supabase/functions/_shared/server.ts:49-57`), nhưng UI không báo giới hạn tương ứng.
- Phạm vi: chỉ sửa `qizzone/src/components/teacher/extraction/FileDropzone.tsx`, giới hạn dùng chung nếu cần và test import. KHÔNG làm: upload tệp lên server, thêm dịch vụ hoặc dependency.
- Tiêu chí nghiệm thu (đo được): tệp vượt giới hạn bị từ chối trước `arrayBuffer()`/AI request; lỗi tiếng Việt cho biết giới hạn; tên đuôi DOCX/PDF không phân biệt hoa thường.
- Test cần chạy / thêm: kiểm tra file quá giới hạn, hợp lệ, sai định dạng và phần mở rộng viết hoa; `npm run lint`, `npm test`, `npm run build`.
- Rủi ro / rollback: giới hạn có thể từ chối tài liệu giáo viên lớn; chọn và hiển thị ngưỡng rõ ràng theo giới hạn Edge Function. Rollback bằng thay đổi hằng số, không bỏ kiểm tra MIME/đuôi.
- Trạng thái: [x] Xong — Vòng 2; DOCX/PDF tối đa 25 MB; ảnh/TXT/MD và văn bản dán tối đa 5 MB, kiểm tra trước khi đọc hoặc gọi AI. `npm run lint` PASS, `npm test` PASS (20 file / 101 test), `npm run build` PASS.

## QZ-P2-02 — Thêm báo cáo hiệu quả theo từng câu hỏi
- Mức: P2 (UX/hiệu năng)
- Vấn đề / bằng chứng: `qizzone/src/pages/teacher/QuizResultsView.tsx:78-100` hiện tính trung bình/cao nhất/thấp nhất/tỷ lệ đạt; chưa có độ khó/tần suất chọn đáp án theo câu. Đây là dạng phân tích có trong Moodle, Canvas, Wayground và Kahoot (nguồn ở phần web research).
- Phạm vi: chỉ sửa `qizzone/src/pages/teacher/QuizResultsView.tsx`, helper/service cần thiết và test; không đổi DB schema nếu các `details` hiện có đủ dữ liệu.
- Tiêu chí nghiệm thu (đo được): giáo viên xem số lượt đúng, bỏ trống và phân bố chọn phương án theo từng câu; export CSV; kết quả không chứa đáp án nếu role không sở hữu quiz.
- Test cần chạy / thêm: test tính toán với bài làm đúng/sai/bỏ trống và CSV; `npm run lint`, `npm test`, `npm run build`.
- Rủi ro / rollback: quiz có ít lượt làm cho tỷ lệ chưa đại diện; hiển thị mẫu số và không gắn nhãn thống kê như kết luận chắc chắn. Rollback UI/helper, giữ dữ liệu kết quả hiện tại.
- Trạng thái: [x] Xong — Vòng 2; trang giáo viên có số lượt đúng/bỏ trống, tỷ lệ và phân bố lựa chọn theo câu; CSV không xuất khóa đáp án, lọc dữ liệu dựa trên `list_results`/quyền quiz hiện hành. `npm run lint` PASS, `npm test` PASS (21 file / 104 test), `npm run build` PASS.

## QZ-P2-03 — Hoàn thiện hướng dẫn setup và vận hành
- Mức: P2 (UX/hiệu năng)
- Vấn đề / bằng chứng: README hiện không có bước setup/deploy/rollback/backup; `qizzone/src/lib/cloud.ts:21` hướng tới `SETUP.md` nhưng file không tồn tại; migrations chỉ có chiều tiến và `supabase/seed.sql` tự giới hạn local/dev.
- Phạm vi: chỉ sửa `README.md` và tạo `SETUP.md` nếu cần. KHÔNG ghi giá trị secret, thông tin dự án thật, hoặc tuyên bố đã bật backup/health check khi chưa xác minh.
- Tiêu chí nghiệm thu (đo được): người mới biết biến `VITE_*` public, biến server-only, thứ tự chạy migrations, deploy preview rồi production, rollback app và lưu ý migration không có rollback tự động; seed chỉ dùng local/dev.
- Test cần chạy / thêm: đối chiếu từng biến với `qizzone/.env.example` và `supabase/functions/.env.example`; kiểm tra link nội bộ trong Markdown.
- Rủi ro / rollback: hướng dẫn có thể lệch cấu hình dashboard; ghi rõ phần cần chủ hệ thống điền và ngày xác minh.
- Trạng thái: [x] Xong — Vòng 2; tạo `SETUP.md`, thêm liên kết trong README, đối chiếu đủ biến môi trường và migration, kiểm tra link local. `npm run lint` PASS, `npm test` PASS (21 file / 104 test), `npm run build` PASS.

## QZ-P2-04 — Bổ sung header bảo mật cho Vercel
- Mức: P2 (UX/hiệu năng)
- Vấn đề / bằng chứng: `vercel.json:1-22` có SPA rewrite và cache asset nhưng không có header phòng vệ trình duyệt.
- Phạm vi: chỉ sửa root `vercel.json`. KHÔNG thêm CSP quá rộng/chặn Firebase hoặc Supabase khi chưa kiểm chứng; không sửa schema.
- Tiêu chí nghiệm thu (đo được): phản hồi HTML có `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` hoặc CSP tương thích; cache asset và SPA rewrite không đổi.
- Test cần chạy / thêm: validate JSON; kiểm tra header qua preview deployment nếu quyền deploy có; `npm run build`.
- Rủi ro / rollback: header CSP sai có thể chặn Firebase/Supabase; ưu tiên header không phá kết nối và xác minh ở preview. Rollback riêng header.
- Trạng thái: [x] Xong — Vòng 2; đã thêm `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`; JSON kiểm tra hợp lệ, rewrite/cache asset giữ nguyên. `npm run lint` PASS, `npm test` PASS (21 file / 104 test), `npm run build` PASS. Chưa xác minh response trên Vercel Preview vì chưa deploy remote.

## QZ-P2-05 — Đưa RPC của phiên thi qua service layer
- Mức: P2 (UX/hiệu năng)
- Vấn đề / bằng chứng: `qizzone/src/store/examSessionStore.ts:4,66,129-232` gọi `rpc` trực tiếp từ `lib/cloud`; prompt yêu cầu mọi truy cập dữ liệu đi qua `services/`.
- Phạm vi: chỉ thêm/sửa service phiên thi, store và test store liên quan. KHÔNG chuyển xác thực Firebase, không đổi RPC/schema.
- Tiêu chí nghiệm thu (đo được): store không import `rpc`/Supabase; toàn bộ thao tác phiên thi đi qua service; hành vi lưu/nộp/khôi phục giữ nguyên.
- Test cần chạy / thêm: test store hiện có và test service RPC; `npm run lint`, `npm test`, `npm run build`.
- Rủi ro / rollback: dễ đổi kiểu lỗi hoặc thứ tự retry; rollback chỉ service/store nếu test hành vi sai.
- Trạng thái: [x] Xong — Vòng 2; store không còn gọi `rpc` hoặc import `lib/cloud` cho truy cập dữ liệu; toàn bộ 6 RPC phiên thi đi qua `examSessionService` và có test ánh xạ. `npm run lint` PASS, `npm test` PASS (22 file / 105 test), `npm run build` PASS.

## CẦN CHỦ REPO QUYẾT

- **Nhánh baseline:** `develop/v1` không có ở local/remote. Audit này lấy `refactor/optimize-login-router` làm proxy sạch; trước khi so diff với develop/v1 cần xác nhận branch/commit gốc đúng.
- **Ý nghĩa của giao đề:** hiện `assignedClasses`/`assignedEmails` chỉ ảnh hưởng danh sách dashboard; học sinh vẫn có thể vào đề `published` nếu biết link/code. Xác nhận đây là cơ chế gợi ý/phân phối hay ranh giới quyền cần enforce ở RPC/RLS. Không tự thay đổi vì luồng join bằng code/link đang được hỗ trợ.
- **Ba thay đổi kiến trúc lớn (không triển khai trong vòng lặp):** chuyển Firebase Auth sang Supabase Auth; dỡ cấu trúc lồng `qizzone/qizzone`; đổi schema phá migration cũ. Hiện không đề xuất dịch vụ/dependency trả phí.

## Tổng số task theo mức và thứ tự làm

| Mức | Số task |
| --- | ---: |
| P0 | 2 |
| P1 | 2 |
| P2 | 5 |
| P3 | 0 |

Thứ tự: `QZ-P0-01` → `QZ-P0-02` → `QZ-P1-01` → `QZ-P1-02` → `QZ-P2-01` → `QZ-P2-02` → `QZ-P2-03` → `QZ-P2-04` → `QZ-P2-05`.

## Review độc lập V3 — 2026-10-26

### Điểm sẵn sàng theo 9 mặt

| Mặt đánh giá | Điểm | Lý do |
| --- | ---: | --- |
| Kiến trúc và chất lượng code | 8/10 | RPC phiên thi đã qua `examSessionService`; các store và service còn lại giữ phân lớp. Cấu trúc repo lồng `qizzone/qizzone` vẫn là quyết định lớn để sau. |
| Bảo mật | 8/10 | Preview DOCX được sanitize, RLS/RPC vẫn xử lý quyền và chấm điểm phía server, header trình duyệt đã có; `npm audit` và `npm audit --omit=dev` đều 0 vulnerability. Chưa xác minh Vercel Preview; không thêm CSP khi chưa kiểm tra tài nguyên ngoài; ý nghĩa quyền của assignments còn chờ chủ repo. |
| Đúng đắn và xử lý lỗi | 8/10 | Bản nháp offline phục hồi theo attempt/revision; xung đột không ghi đè server; dữ liệu lớn bị chặn trước khi đọc/gửi. Chưa chạy kiểm thử nhiều trình duyệt trên môi trường thật. |
| Tính năng | 8/10 | Có thống kê đúng/bỏ trống/phân bố đáp án theo câu và CSV; ngân hàng câu hỏi tái sử dụng vẫn ở backlog. |
| Hiệu năng | 7/10 | Route lazy-load và giới hạn import có sẵn; parser DOCX/PDF vẫn tạo chunk khoảng 583 kB/431 kB, chưa có đo trên điện thoại hoặc mạng yếu. |
| Trải nghiệm và accessibility | 7/10 | Thông báo giới hạn tiếng Việt và mẫu số phân tích rõ; chưa có kiểm tra bàn phím, screen reader, tương phản hoặc E2E trình duyệt tự động. |
| Kiểm thử | 8/10 | 22 file / 105 test, có PGlite kiểm tra migration/RLS và test offline/service. Chưa xác minh trigger GitHub Actions từ push/PR thật; thiếu E2E/a11y suite. |
| Production và vận hành | 7/10 | CI config, header, hướng dẫn deploy và rollback đã có. Chưa xác minh Preview, backup/restore, health/logs hoặc quyền truy cập dashboard production. |
| Tài liệu | 9/10 | README dẫn tới SETUP; biến môi trường, thứ tự migrations, seed, deploy, smoke và rollback đã được ghi. Branch đích và một quyết định về assignments còn cần chủ repo xác nhận. |

Không mặt nào được 10/10 vì còn các xác minh môi trường thật chưa thực hiện.

### Kết quả cổng cuối

- Backlog code: P0 còn mở **0**, P1 còn mở **0**, P2 còn mở **0**; cả 9 task đã hoàn tất.
- Trên branch `review/production-v1`, `npm run lint`: PASS; `npm test`: PASS (22 file / 105 test); `npm run build`: PASS; `npm audit` và `npm audit --omit=dev`: PASS (0 vulnerabilities).
- `git diff --check`: PASS; kiểm tra pattern secret trên diff không phát hiện credential có vẻ thật.
- `develop/v1` không tồn tại trong danh sách branch đã kiểm tra. Code dựa trên `refactor/optimize-login-router` tại `919dbfd`; chưa thể xác nhận tương đương với baseline trong prompt.
- Chưa push hoặc deploy remote. Cần chủ repo xác nhận branch/base; trigger GitHub Actions, response header ở Preview, backup/restore point và smoke test staging/production vẫn là việc kiểm tra bên ngoài.

**Quyết định:** cổng mã nguồn đạt để tạo release candidate và bắt đầu xác minh trên staging. Chưa tuyên bố production đã sẵn sàng hoặc đã phát hành. Checklist thao tác và các mục cần chủ repo ký xác nhận nằm trong `RELEASE_CHECKLIST.md`.
