import { describe, it, expect } from "vitest";
import {
  extractAnswerKeyTable,
  extractTrailingAnswer,
  parseSingleQuestionBlock,
  parseRawExamText,
  cleanMathAndHtml,
} from "@/utils/parsers/ruleExtractor";

describe("Rule-Based Multi-Strategy Answer Detection Unit Tests", () => {
  it("Bóc tách đầy đủ tất cả các câu hỏi đơn giản (3 câu liên tiếp)", () => {
    const rawExam = `
Câu 1: 1 + 1 bằng mấy?
A. 1
<u>B. 2</u>
C. 3
D. 4

Câu 2: 2 + 2 bằng mấy?
*A. 4
B. 5
C. 6
D. 7

Câu 3: 3 + 3 bằng mấy?
A. 5
<mark>B. 6</mark>
C. 7
D. 8
`;
    const result = parseRawExamText(rawExam);

    expect(result.questions.length).toBe(3);
    expect(result.questions[0].order).toBe(1);
    expect(result.questions[0].correctAnswers).toEqual(["B"]);
    expect(result.questions[0].detectionStrategy).toBe("underline");

    expect(result.questions[1].order).toBe(2);
    expect(result.questions[1].correctAnswers).toEqual(["A"]);
    expect(result.questions[1].detectionStrategy).toBe("special_marker");

    expect(result.questions[2].order).toBe(3);
    expect(result.questions[2].correctAnswers).toEqual(["B"]);
    expect(result.questions[2].detectionStrategy).toBe("highlight_color");
  });

  it("keeps OCR option labels when the scanner removes the space after A./B./C./D.", () => {
    const result = parseRawExamText([
      "Câu 1. Đạo hàm của hàm số f(x) = x° là gì?",
      "A.2x",
      "B.x",
      "C. x?",
      "D.0",
    ].join("\n"), { fileType: "image" });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].content).toContain("Đạo hàm");
    expect(result.questions[0].options.map(option => option.id)).toEqual(["A", "B", "C", "D"]);
    expect(result.questions[0].correctAnswers).toEqual([]);

    const strictPdfResult = parseRawExamText([
      "Câu 1. Đạo hàm của hàm số f(x) = x° là gì?",
      "A.2x",
      "B.x",
      "C. x?",
      "D.0",
    ].join("\n"), { fileType: "pdf" });
    expect(strictPdfResult.questions[0].options.map(option => option.id)).not.toEqual(["A", "B", "C", "D"]);
  });

  it("keeps sequential lowercase option labels when PDF text extraction joins them to their content", () => {
    const rawText = [
      "Câu 1. Chọn đáp án đúng?",
      "A. A",
      "b.F",
      "c.H",
      "d.G",
    ].join("\n");
    const result = parseRawExamText(rawText, { fileType: "pdf" });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].options.map(option => option.id)).toEqual(["A", "B", "C", "D"]);
    expect(result.questions[0].options.map(option => option.content)).toEqual(["A", "F", "H", "G"]);
  });

  it("Bóc tách câu hỏi đánh số tự nhiên không có chữ 'Câu' (1. 2. 3.)", () => {
    const rawExam = `
1. Thủ đô của Việt Nam là:
*A. Hà Nội
B. TP. Hồ Chí Minh
C. Đà Nẵng
D. Hải Phòng

2. Đâu là một ngôn ngữ lập trình?
A. HTML
B. CSS
<u>C. TypeScript</u>
D. JPEG
`;
    const result = parseRawExamText(rawExam);

    expect(result.questions.length).toBe(2);
    expect(result.questions[0].correctAnswers).toEqual(["A"]);
    expect(result.questions[1].correctAnswers).toEqual(["C"]);
  });

  it("Câu hỏi không có dấu hiệu đáp án thì để rỗng correctAnswers: [] (Không tự ý gán A)", () => {
    const rawExam = `
Câu 1: Câu hỏi không chọn đáp án sẵn trong tài liệu:
A. Phương án 1
B. Phương án 2
C. Phương án 3
D. Phương án 4
`;
    const result = parseRawExamText(rawExam);

    expect(result.questions.length).toBe(1);
    expect(result.questions[0].correctAnswers).toEqual([]);
    expect(result.questions[0].warningFlags).toBeDefined();
    expect(result.questions[0].warningFlags?.[0]).toContain("Chưa có đáp án");
  });

  it("Chiến lược 1 (Bảng đáp án cuối đề): Nhận diện chính xác 100% từ ma trận bảng đáp án", () => {
    const rawExam = `
Câu 1: Cho hàm số $y = x^2$. Đạo hàm là:
A. $2x$
B. $x$
C. 1
D. 0

Câu 2: Tích phân $\\int dx$ bằng:
A. $x$
B. $x + C$
C. $0$
D. $C$

BẢNG ĐÁP ÁN:
1.A  2.B
`;
    const result = parseRawExamText(rawExam);

    expect(result.questions.length).toBe(2);
    expect(result.questions[0].correctAnswers).toEqual(["A"]);
    expect(result.questions[0].detectionStrategy).toBe("answer_table");
    expect(result.questions[0].confidenceScore).toBe(0.99);

    expect(result.questions[1].correctAnswers).toEqual(["B"]);
    expect(result.questions[1].detectionStrategy).toBe("answer_table");
  });

  it("Nhận diện tiêu đề ĐÁP ÁN đứng riêng và không phân tích phần giải thích thành câu hỏi", () => {
    const rawExam = `Câu 1. Vật chất được hiểu là gì?
A. Những gì nhìn thấy trực tiếp.
B. Thực tại khách quan tồn tại độc lập với ý thức.
C. Cảm giác chủ quan.
D. Vật có khối lượng.

ĐÁP ÁN
Câu 1: B
Giải thích ngắn:
1. Vật chất tồn tại khách quan.
`;

    const result = parseRawExamText(rawExam);

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].correctAnswers).toEqual(["B"]);
    expect(result.questions[0].detectionStrategy).toBe("answer_table");
    expect(result.hasAnswerKeyTable).toBe(true);
    expect(result.coverage?.sourceQuestionNumbers).toEqual([1]);
  });

  it("does not silently choose one of two conflicting answer-key entries", () => {
    const raw = `Câu 1: Chọn đáp án đúng?
A. Một
B. Hai
C. Ba
D. Bốn

BẢNG ĐÁP ÁN:
1.A 1.B`;
    const result = parseRawExamText(raw);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].correctAnswers).toEqual([]);
    expect(result.questions[0].answerStatus).toBe("ambiguous");
    expect(result.questions[0].answerEvidence?.some(evidence => evidence.ruleId === "conflicting_answer_key_entries_v1")).toBe(true);
    expect(result.qualityFlags).toContain("answer_key_table_conflict");
  });

  it("Chiến lược 2 (Ký hiệu tiền tố): Nhận diện dấu sao *A, ✓A hoặc [x]", () => {
    const rawBlock = `
Câu 1: Giá trị của $\\log_2 8$ là:
*A. 3
B. 2
C. 4
D. 8
`;
    const parsed = parseSingleQuestionBlock(rawBlock, 1);
    expect(parsed).not.toBeNull();
    expect(parsed?.correctAnswers).toEqual(["A"]);
    expect(parsed?.detectionStrategy).toBe("special_marker");
    expect(parsed?.confidenceScore).toBe(0.98);
  });

  it("Nhận diện đáp án ghi ở cuối câu và không dính vào lựa chọn cuối", () => {
    const rawBlock = `
Câu 1: Tổ chức nào lãnh đạo cách mạng Việt Nam?
A. Đảng Cộng sản Việt Nam
B. Nhà nước
C. Mặt trận
D. Chính phủ
Đáp án: A
`;

    const parsed = parseSingleQuestionBlock(rawBlock, 1);

    expect(extractTrailingAnswer(rawBlock)).toBe("A");
    expect(parsed).not.toBeNull();
    expect(parsed?.correctAnswers).toEqual(["A"]);
    expect(parsed?.detectionStrategy).toBe("answer_at_end");
    expect(parsed?.confidenceScore).toBe(0.99);
    expect(parsed?.options[3].content).toBe("Chính phủ");
    expect(parsed?.warningFlags).toBeUndefined();
  });

  it("Nhận diện đáp án cuối câu trong HTML theo đoạn và hỗ trợ chữ thường", () => {
    const htmlBlock = `
<p>Câu hỏi kiểm tra:</p>
<p>A. Phương án A</p>
<p>B. Phương án B</p>
<p>C. Phương án C</p>
<p>D. Phương án D</p>
<p><strong>ĐÁP ÁN: c</strong></p>
`;

    const parsed = parseSingleQuestionBlock(htmlBlock, 1);

    expect(extractTrailingAnswer(htmlBlock)).toBe("C");
    expect(parsed?.correctAnswers).toEqual(["C"]);
    expect(parsed?.detectionStrategy).toBe("answer_at_end");
    expect(parsed?.options[3].content).toBe("Phương án D");
  });

  it("Chiến lược 3 (Gạch chân): Nhận diện thẻ gạch chân <u>A.</u> hoặc class is-underline", () => {
    const rawBlock = `
Câu 1: Nghiệm của phương trình $x - 3 = 0$ là:
A. $x = -3$
<u class="is-underline">B. $x = 3$</u>
C. $x = 0$
D. $x = 1$
`;
    const parsed = parseSingleQuestionBlock(rawBlock, 1);
    expect(parsed).not.toBeNull();
    expect(parsed?.correctAnswers).toEqual(["B"]);
    expect(parsed?.detectionStrategy).toBe("underline");
    expect(parsed?.confidenceScore).toBe(0.95);
  });

  it("Chiến lược 4 (Tô màu / Chữ đỏ): Nhận diện thẻ <mark> highlight hoặc màu chữ đỏ", () => {
    const rawBlock = `
Câu 1: Thể tích hình lập phương cạnh $a$ bằng:
A. $a^2$
B. $2a^3$
<mark class="is-highlighted">C. $a^3$</mark>
D. $4a^3$
`;
    const parsed = parseSingleQuestionBlock(rawBlock, 1);
    expect(parsed).not.toBeNull();
    expect(parsed?.correctAnswers).toEqual(["C"]);
    expect(parsed?.detectionStrategy).toBe("highlight_color");
    expect(parsed?.confidenceScore).toBe(0.95);
  });

  it("Chiến lược 5 (In đậm duy nhất): Nhận diện khi chỉ có 1 đáp án in đậm <b>D.</b>", () => {
    const rawBlock = `
Câu 1: Số nào sau đây là số nguyên tố?
A. 4
B. 6
C. 8
<b>D. 7</b>
`;
    const parsed = parseSingleQuestionBlock(rawBlock, 1);
    expect(parsed).not.toBeNull();
    expect(parsed?.correctAnswers).toEqual(["D"]);
    expect(parsed?.detectionStrategy).toBe("distinct_bold");
    expect(parsed?.confidenceScore).toBe(0.9);
  });

  it("Chiến lược 6 (Trích từ lời giải): Nhận diện câu 'Chọn B vì...' trong phần lời giải", () => {
    const rawBlock = `
Câu 1: Đạo hàm của hàm hằng $f(x) = 5$ là:
A. 5
B. 0
C. 1
D. Không xác định
Lời giải: Đạo hàm của hàm hằng luôn bằng 0. Chọn B.
`;
    const parsed = parseSingleQuestionBlock(rawBlock, 1);
    expect(parsed).not.toBeNull();
    expect(parsed?.correctAnswers).toEqual(["B"]);
    expect(parsed?.detectionStrategy).toBe("explanation_text");
    expect(parsed?.confidenceScore).toBe(0.88);
    expect(parsed?.explanation).toContain("Đạo hàm của hàm hằng luôn bằng 0");
  });

  it("Nhận diện các dạng tiêu đề đề thi Việt Nam (NB, TH, điểm số, mức độ)", () => {
    const rawExam = `
Câu 1 [NB] (1.0 điểm): Phương trình $x^2 = 4$ có nghiệm:
A. $x = 2$
<u>B. $x = \\pm 2$</u>
C. $x = -2$
D. Vô nghiệm

Câu 2 (Mức độ 2): Giá trị nhỏ nhất của $y = x^2 + 1$ là:
*A. 1
B. 0
C. 2
D. -1
`;
    const result = parseRawExamText(rawExam);
    expect(result.questions.length).toBe(2);
    expect(result.questions[0].correctAnswers).toEqual(["B"]);
    expect(result.questions[1].correctAnswers).toEqual(["A"]);
  });

  it("Nhận diện đáp án bố trí trên cùng 1 dòng và trong bảng table", () => {
    const rawBlock = `
Câu 1: Cho hàm số f(x). Giá trị cực đại là:
A. 10    B. 20    *C. 30    D. 40
`;
    const parsed = parseSingleQuestionBlock(rawBlock, 1);
    expect(parsed).not.toBeNull();
    expect(parsed?.options.length).toBe(4);
    expect(parsed?.correctAnswers).toEqual(["C"]);
  });

  it("Dùng chữ màu đỏ trong PDF làm bằng chứng đáp án", () => {
    const result = parseRawExamText(`Câu 1: Tác phẩm nào đánh dấu sự ra đời của chủ nghĩa xã hội khoa học?
a. Hệ tư tưởng Đức
b. Tình cảnh giai cấp lao động ở Anh
<span class="text-color-red">c. Tuyên ngôn của Đảng Cộng sản</span>
d. Những nguyên lý của chủ nghĩa cộng sản`, { fileType: "pdf" });

    expect(result.questions[0].options.map(option => option.content)).toEqual([
      "Hệ tư tưởng Đức",
      "Tình cảnh giai cấp lao động ở Anh",
      "Tuyên ngôn của Đảng Cộng sản",
      "Những nguyên lý của chủ nghĩa cộng sản",
    ]);
    expect(result.questions[0].correctAnswers).toEqual(["C"]);
    expect(result.questions[0].answerEvidence).toContainEqual({
      kind: "highlight_color",
      optionIds: ["C"],
      ruleId: "option_highlight_or_color_v1",
    });
  });

  it("Nhận diện lựa chọn Đúng/Sai không nhãn và nối các dòng xuống hàng của câu PDF", () => {
    const rawBlock = `[CLO2-TF-006] Rootkit là mã độc dùng để che giấu tiến trình, tập tin,
khóa
registry nhằm tránh bị phát hiện.
Đúng
Sai`;

    const result = parseRawExamText(`Câu 3: ${rawBlock}`, { fileType: "pdf" });
    const parsed = result.questions[0];

    expect(result.questions).toHaveLength(1);
    expect(parsed?.content).toBe("[CLO2-TF-006] Rootkit là mã độc dùng để che giấu tiến trình, tập tin, khóa registry nhằm tránh bị phát hiện.");
    expect(parsed?.options.map(option => ({ id: option.id, content: option.content }))).toEqual([
      { id: "A", content: "Đúng" },
      { id: "B", content: "Sai" },
    ]);
    expect(parsed?.correctAnswers).toEqual([]);
    expect(parsed?.warningFlags?.some(flag => flag.includes("Không xác định đủ 2 phương án"))).toBe(false);
  });

  it("Tách riêng câu 301+ và áp dụng bảng đáp án sau mốc 300", () => {
    const questionBlocks = [299, 300, 301, 302].map(number => `
${number}. Nội dung kiểm thử câu ${number}?
A. Lựa chọn A câu ${number}
B. Lựa chọn B câu ${number}
C. Lựa chọn C câu ${number}
D. Lựa chọn D câu ${number}`);
    const rawExam = `${questionBlocks.join("\n")}\n\nBẢNG ĐÁP ÁN: 299.A 300.B 301.C 302.D`;

    const result = parseRawExamText(rawExam, { fileType: "pdf" });

    expect(result.questions).toHaveLength(4);
    expect(result.coverage?.sourceQuestionNumbers).toEqual([299, 300, 301, 302]);
    expect(result.questions[1].content).toBe("Nội dung kiểm thử câu 300?");
    expect(result.questions[2].content).toBe("Nội dung kiểm thử câu 301?");
    expect(result.questions[2].content).not.toContain("Nội dung kiểm thử câu 302?");
    expect(result.questions[2].correctAnswers).toEqual(["C"]);
    expect(result.questions[3].correctAnswers).toEqual(["D"]);
  });

  it("Làm sạch HTML và chuyển đổi chuẩn LaTeX \\( ... \\) sang $...$", () => {
    const raw = "<p>Giải phương trình \\(x^2 - 4 = 0\\) có nghiệm \\(x = \\pm 2\\)</p>";
    const cleaned = cleanMathAndHtml(raw);
    expect(cleaned).toBe("Giải phương trình $x^2 - 4 = 0$ có nghiệm $x = \\pm 2$");
  });

  it("Hàm extractAnswerKeyTable quét chính xác bảng đáp án đa định dạng", () => {
    const text1 = "BẢNG ĐÁP ÁN: 1.A 2.B 3.C 4.D 5.A";
    const map1 = extractAnswerKeyTable(text1);
    expect(map1[1]).toBe("A");
    expect(map1[2]).toBe("B");
    expect(map1[3]).toBe("C");
    expect(map1[4]).toBe("D");
    expect(map1[5]).toBe("A");

    const text2 = "ĐÁP ÁN: 1-C, 2-D, 3-A";
    const map2 = extractAnswerKeyTable(text2);
    expect(map2[1]).toBe("C");
    expect(map2[2]).toBe("D");
    expect(map2[3]).toBe("A");
  });
});
