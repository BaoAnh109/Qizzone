#!/bin/sh
# Runner fixtures extraction (bước 02, PLAN_MAIN).
# Chạy từ bất kỳ đâu; tự cd về thư mục qizzone/ rồi chạy vitest cho file
# extractionFixtures.test.ts, sau đó in tóm tắt từ report.json.
# Không gọi Gemini, không OCR, không tốn API.
set -e
cd "$(dirname "$0")/../../.."
npx vitest run src/utils/__tests__/extractionFixtures.test.ts
node -e "
const r = require('./tests/fixtures/extraction/report.json');
console.log('--- FIXTURE REPORT ---');
console.log(JSON.stringify(r.totals, null, 2));
for (const f of r.fixtures) {
  console.log(f.id + ': expected=' + f.expected + ' got=' + f.got +
    ' missing=[' + f.missing.join(',') + '] extra=[' + f.extra.join(',') + ']' +
    ' stemX=' + f.stemMismatch + ' optX=' + f.optionsMismatch +
    ' ansX=' + f.answerMismatch + (f.error ? ' ERROR=' + f.error : ''));
}
"
