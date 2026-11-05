import { describe, it, expect } from "vitest";
import {
  extractAnswerKeyTable,
  extractTrailingAnswer,
  parseSingleQuestionBlock,
  parseRawExamText,
  cleanMathAndHtml,
  romanToInt,
} from "@/utils/parsers/ruleExtractor";
import { validateExtractedQuestions } from "@/utils/extractedQuestionMapper";

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

  it("Làm sạch HTML và chuyển đổi chuẩn LaTeX \\( ... \\) sang $...$", () => {
    const raw = "<p>Giải phương trình \\(x^2 - 4 = 0\\) có nghiệm \\(x = \\pm 2\\)</p>";
    const cleaned = cleanMathAndHtml(raw);
    expect(cleaned).toBe("Giải phương trình $x^2 - 4 = 0$ có nghiệm $x = \\pm 2$");
  });

  it("Bước 06: câu không tách được option nào thì giữ options [] — không chèn option giả", () => {
    const rawBlock = `
Câu 1: Giải thích vì sao nước sôi ở 100 độ C trong điều kiện áp suất thường?
`;

    const parsed = parseSingleQuestionBlock(rawBlock, 1);
    expect(parsed).not.toBeNull();
    expect(parsed?.options).toEqual([]);
    expect(
      parsed?.options.some((opt) => opt.content.includes("Lựa chọn"))
    ).toBe(false);
    expect(parsed?.correctAnswers).toEqual([]);
    expect(parsed?.warningFlags?.join(" ")).toContain(
      "Chưa bóc tách được đầy đủ các lựa chọn"
    );
  });

  it("Bước 06: câu chỉ tách được 1 option thì giữ đúng 1 option thật, không chèn thêm 3 option mẫu", () => {
    const rawBlock = `
Câu 1: Chọn đáp án đúng:
A. Phương án duy nhất tìm được
`;

    const parsed = parseSingleQuestionBlock(rawBlock, 1);
    expect(parsed).not.toBeNull();
    expect(parsed?.options.length).toBe(1);
    expect(parsed?.options[0].content).toBe("Phương án duy nhất tìm được");
    expect(
      parsed?.options.some((opt) => opt.content.includes("Lựa chọn"))
    ).toBe(false);
    expect(parsed?.warningFlags?.join(" ")).toContain(
      "Chưa bóc tách được đầy đủ các lựa chọn"
    );
  });

  it("Bước 06: câu Đúng/Sai không có header A–D thì không bị nhét option giả (kiểu Đúng/Sai thật thuộc bước 12)", () => {
    const rawBlock = `
Câu 1: Trái Đất quay quanh Mặt Trời.
Đúng
Sai
`;

    const parsed = parseSingleQuestionBlock(rawBlock, 1);
    expect(parsed).not.toBeNull();
    expect(parsed?.options).toEqual([]);
    expect(
      parsed?.options.some((opt) => opt.content.includes("Lựa chọn"))
    ).toBe(false);
    // Chưa triển khai type true_false ở bước này — chỉ khẳng định không
    // bịa option; việc nhận diện Đúng/Sai thành options thuộc bước 12.
    expect(parsed?.warningFlags?.join(" ")).toContain(
      "Chưa bóc tách được đầy đủ các lựa chọn"
    );
  });

  it("Bước 06: câu thiếu option đi qua mapper thì bị chặn xuất bản ở insufficient_options", () => {
    const rawBlock = `
Câu 1: Giải thích vì sao nước sôi ở 100 độ C trong điều kiện áp suất thường?
`;

    const parsed = parseSingleQuestionBlock(rawBlock, 1);
    expect(parsed).not.toBeNull();
    const diagnostics = validateExtractedQuestions(parsed ? [parsed] : []);
    const blocker = diagnostics.find(
      (d) => d.code === "insufficient_options"
    );
    expect(blocker).toBeDefined();
    expect(blocker?.blocksPublish).toBe(true);
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

describe("Sửa parser luật theo file thật + holdout (sau MVP)", () => {
  it("Marker thường a–d ở đầu dòng, đủ chuỗi a→b→c→d: tách đủ 4 option (file ATTT)", () => {
    const rawExam = `
Câu 1: Virus có khả năng viết lại toàn bộ mã được gọi là:
a. Stealth
b. Metamorphic
c. Polymorphic
d. Encrypted

Câu 2: Một hệ thống có 100 người dùng thì cần:
a. 4.950 khóa
b. 200 khóa
c. 10.000 khóa
d. 100 khóa
`;
    const result = parseRawExamText(rawExam);
    expect(result.questions.length).toBe(2);
    for (const q of result.questions) {
      expect(q.options.map((o) => o.id)).toEqual(["A", "B", "C", "D"]);
    }
    expect(result.questions[0].options[1].content).toBe("Metamorphic");
    expect(result.questions[1].options[0].content).toBe("4.950 khóa");
  });

  it("Marker thường KHÔNG đủ chuỗi a→b→c→d thì không nhận (guard chống nhận nhầm từ thường)", () => {
    const rawExam = `
Câu 1: Tìm a. b. c. trong đoạn văn này?
a. Phương án một
b. Phương án hai
`;
    const result = parseRawExamText(rawExam);
    expect(result.questions.length).toBe(1);
    // Chỉ có a,b thường, không đủ chuỗi 4 → lượt nới lỏng bị từ chối,
    // fallback nghiêm ngặt cũng không thấy marker hoa → 0 option.
    expect(result.questions[0].options.length).toBe(0);
  });

  it("Câu 3 phương án chữ thường (a→b→c) vẫn tách đủ 3 option — đối xứng với chữ hoa", () => {
    const rawExam = `
Câu 1: Đâu là màu cơ bản?
a. Đỏ
b. Xanh
c. Vàng
`;
    const result = parseRawExamText(rawExam);
    expect(result.questions.length).toBe(1);
    expect(result.questions[0].options.map((o) => o.id)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(result.questions[0].options[2].content).toBe("Vàng");
  });

  it("Inline option h01: 4 phương án chung 1 dòng, cách nhau 1 space sau từ thường", () => {
    const rawExam = `
Câu 1: Thủ đô của nước Pháp là gì? A. Berlin B. Paris C. Madrid D. Roma
`;
    const result = parseRawExamText(rawExam);
    expect(result.questions.length).toBe(1);
    expect(result.questions[0].options.map((o) => o.id)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(result.questions[0].options.map((o) => o.content)).toEqual([
      "Berlin",
      "Paris",
      "Madrid",
      "Roma",
    ]);
  });

  it("Inline option KHÔNG đủ chuỗi 4 thì không nhận (guard)", () => {
    const rawExam = `
Câu 1: Thủ đô của nước Pháp là gì? A. Berlin B. Paris
`;
    const result = parseRawExamText(rawExam);
    expect(result.questions.length).toBe(1);
    // Lượt nghiêm ngặt chỉ thấy A (sau "?"), lượt inline chỉ đủ A,B
    // → không đủ chuỗi 4 nên bị từ chối, fallback giữ đúng 1 option A.
    expect(result.questions[0].options.map((o) => o.id)).toEqual(["A"]);
  });

  it("extractTrailingAnswer nhận đáp án sau TAB (h02) và sau thẻ <td> (hàng bảng AST)", () => {
    expect(extractTrailingAnswer("Napoli.\tĐáp án: B")).toBe("B");
    expect(
      extractTrailingAnswer("Napoli.</td><td>Đáp án: B</td></tr>")
    ).toBe("B");
    expect(extractTrailingAnswer("Đáp án: b")).toBe("B");
  });

  it("extractTrailingAnswer nhận đáp án khi có dòng ghi chú sau nó (h03), và đáp án không dính vào option cuối", () => {
    expect(extractTrailingAnswer("54\nĐáp án: B\nChú ý: đây là ghi chú")).toBe(
      "B"
    );
    const block = `Thủ đô của nước Pháp là gì?
A. Berlin
B. Paris
C. Madrid
D. 54
Đáp án: B
Chú ý: đây chỉ là ghi chú`;
    const parsed = parseSingleQuestionBlock(block, 1);
    expect(parsed).not.toBeNull();
    expect(parsed?.correctAnswers).toEqual(["B"]);
    expect(parsed?.options[3].content).toBe("54");
  });

  it("Nhãn La Mã Câu I/II/III tách thành 3 câu, giữ số gốc 1/2/3 (h04)", () => {
    const rawExam = `
Câu I. Thủ đô của Việt Nam là?
A. Hà Nội
B. Huế
C. Đà Nẵng
D. Hải Phòng

Câu II. Đâu là một ngôn ngữ lập trình?
A. HTML
B. CSS
C. TypeScript
D. JPEG

Câu III. 1 + 1 bằng mấy?
A. 1
B. 2
C. 3
D. 4
`;
    const result = parseRawExamText(rawExam);
    expect(result.questions.length).toBe(3);
    expect(result.questions.map((q) => q.sourceNumber)).toEqual([1, 2, 3]);
    expect(result.questions[1].options[2].content).toBe("TypeScript");
  });

  it("Số La Mã viết sai chuẩn (IIII) không tạo header giả — fallback gộp 1 câu", () => {
    const rawExam = `
Câu IIII. Hỏi gì?
A. 1
B. 2
C. 3
D. 4
`;
    const result = parseRawExamText(rawExam);
    expect(result.questions.length).toBe(1);
  });

  it("Số La Mã trần không nhãn (I.) không tạo header — chỉ nhận khi có nhãn Câu/Bài", () => {
    const rawExam = `
I. Hỏi gì?
A. 1
B. 2
C. 3
D. 4
`;
    const result = parseRawExamText(rawExam);
    expect(result.questions.length).toBe(1);
  });

  it("romanToInt: đúng chuẩn thì đổi, sai chuẩn/vượt giới hạn thì undefined", () => {
    expect(romanToInt("I")).toBe(1);
    expect(romanToInt("iv")).toBe(4);
    expect(romanToInt("XIV")).toBe(14);
    expect(romanToInt("XCIX")).toBe(99);
    expect(romanToInt("IIII")).toBeUndefined();
    expect(romanToInt("VV")).toBeUndefined();
    expect(romanToInt("IL")).toBeUndefined();
    expect(romanToInt("MMMD")).toBeUndefined();
    expect(romanToInt("ABC")).toBeUndefined();
  });
});
