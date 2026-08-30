import { describe, it, expect } from "vitest";
import { convertOmmlToLatex, parseXmlString } from "@/utils/parsers/docxAstParser";
import { parseRawExamText } from "@/utils/parsers/ruleExtractor";

describe("Direct OpenXML OMML Math Converter Tests", () => {
  it("Chuyển đổi phân số OMML <m:f> sang LaTeX \\frac{num}{den}", () => {
    const xml = `
      <m:f xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:num><m:r><m:t>2x + 1</m:t></m:r></m:num>
        <m:den><m:r><m:t>x - 3</m:t></m:r></m:den>
      </m:f>
    `;
    const doc = parseXmlString(xml);
    const elem = doc.documentElement;
    const latex = convertOmmlToLatex(elem);

    expect(latex).toBe("\\frac{2x + 1}{x - 3}");
  });

  it("Chuyển đổi căn thức OMML <m:rad> bậc 2 và bậc n sang LaTeX \\sqrt", () => {
    const sqrt2Xml = `
      <m:rad xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:deg></m:deg>
        <m:e><m:r><m:t>x^2 + 1</m:t></m:r></m:e>
      </m:rad>
    `;
    const doc = parseXmlString(sqrt2Xml);
    const latexSqrt2 = convertOmmlToLatex(doc.documentElement);
    expect(latexSqrt2).toBe("\\sqrt{x^2 + 1}");

    const sqrt3Xml = `
      <m:rad xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:deg><m:r><m:t>3</m:t></m:r></m:deg>
        <m:e><m:r><m:t>x + 8</m:t></m:r></m:e>
      </m:rad>
    `;
    const doc3 = parseXmlString(sqrt3Xml);
    const latexSqrt3 = convertOmmlToLatex(doc3.documentElement);
    expect(latexSqrt3).toBe("\\sqrt[3]{x + 8}");
  });

  it("Chuyển đổi số mũ <m:sSup> và chỉ số dưới <m:sSub> sang LaTeX", () => {
    const supXml = `
      <m:sSup xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:e><m:r><m:t>e</m:t></m:r></m:e>
        <m:sup><m:r><m:t>2x</m:t></m:r></m:sup>
      </m:sSup>
    `;
    const docSup = parseXmlString(supXml);
    expect(convertOmmlToLatex(docSup.documentElement)).toBe("{e}^{2x}");

    const subXml = `
      <m:sSub xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:e><m:r><m:t>u</m:t></m:r></m:e>
        <m:sub><m:r><m:t>n+1</m:t></m:r></m:sub>
      </m:sSub>
    `;
    const docSub = parseXmlString(subXml);
    expect(convertOmmlToLatex(docSub.documentElement)).toBe("{u}_{n+1}");
  });

  it("Chuyển đổi dấu ngoặc <m:d> sang \\left( ... \\right)", () => {
    const dXml = `
      <m:d xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr>
        <m:e><m:r><m:t>x - 1</m:t></m:r></m:e>
      </m:d>
    `;
    const doc = parseXmlString(dXml);
    expect(convertOmmlToLatex(doc.documentElement)).toBe("\\left(x - 1\\right)");
  });

  it("Chuyển đổi ký hiệu toán học Unicode (alpha, pi, int, sum, leq, geq, delta)", () => {
    const mathXml = `
      <m:r xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:t>α + β ≤ π ± Δ</m:t>
      </m:r>
    `;
    const doc = parseXmlString(mathXml);
    const res = convertOmmlToLatex(doc.documentElement);
    expect(res).toContain("\\alpha");
    expect(res).toContain("\\beta");
    expect(res).toContain("\\le");
    expect(res).toContain("\\pi");
    expect(res).toContain("\\pm");
    expect(res).toContain("\\Delta");
  });
});

describe("Comprehensive Question & Answer Recognition Tests", () => {
  it("Bóc tách 100% chính xác đề thi có 4 phong cách đánh dấu đáp án khác nhau trong cùng 1 file", () => {
    const examDoc = `
Câu 1: Nguyên hàm của hàm số $f(x) = 2x$ là:
<strong class="is-bold">A. $x^2 + C$</strong>
B. $2x^2 + C$
C. $x^2$
D. $2 + C$

Câu 2: Nghiệm của phương trình $\\log_3(x) = 2$ là:
A. $x = 6$
*B. $x = 9$
C. $x = 8$
D. $x = 5$

Câu 3: Đạo hàm của hàm số $y = e^x$ là:
A. $y' = x e^{x-1}$
B. $y' = e^x + 1$
<mark class="is-highlighted">C. $y' = e^x$</mark>
D. $y' = \\ln x$

Câu 4: Thể tích khối lập phương cạnh bằng 3 là:
A. 9
B. 18
<u class="is-underline">C. 27</u>
D. 81

Câu 5: Số nào sau đây là số chẵn?
A. 1
B. 3
<span class="text-color-red" style="color:#e11d48">C. 4</span>
D. 5
    `;

    const result = parseRawExamText(examDoc);

    expect(result.questions.length).toBe(5);

    // Câu 1: In đậm
    expect(result.questions[0].order).toBe(1);
    expect(result.questions[0].correctAnswers).toEqual(["A"]);
    expect(result.questions[0].detectionStrategy).toBe("distinct_bold");

    // Câu 2: Dấu sao *
    expect(result.questions[1].order).toBe(2);
    expect(result.questions[1].correctAnswers).toEqual(["B"]);
    expect(result.questions[1].detectionStrategy).toBe("special_marker");

    // Câu 3: Highlight màu
    expect(result.questions[2].order).toBe(3);
    expect(result.questions[2].correctAnswers).toEqual(["C"]);
    expect(result.questions[2].detectionStrategy).toBe("highlight_color");

    // Câu 4: Gạch chân Underline
    expect(result.questions[3].order).toBe(4);
    expect(result.questions[3].correctAnswers).toEqual(["C"]);
    expect(result.questions[3].detectionStrategy).toBe("underline");

    // Câu 5: Chữ đỏ Font color
    expect(result.questions[4].order).toBe(5);
    expect(result.questions[4].correctAnswers).toEqual(["C"]);
    expect(result.questions[4].detectionStrategy).toBe("highlight_color");
  });

  it("Bóc tách chuẩn xác đề thi có Bảng đáp án HTML ma trận ở cuối đề", () => {
    const htmlExam = `
<p><b>Câu 1:</b> Phương trình sin x = 0 có nghiệm là:</p>
<p>A. x = pi/2 + kpi</p>
<p>B. x = kpi</p>
<p>C. x = k2pi</p>
<p>D. x = pi + kpi</p>

<p><b>Câu 2:</b> Hàm số nào sau đây đồng biến trên R?</p>
<p>A. y = -x + 1</p>
<p>B. y = x^3 + x</p>
<p>C. y = x^2</p>
<p>D. y = 1/x</p>

<p><b>BẢNG ĐÁP ÁN:</b></p>
<table>
  <tr><td>Câu</td><td>1</td><td>2</td></tr>
  <tr><td>Đáp án</td><td>B</td><td>B</td></tr>
</table>
    `;

    const result = parseRawExamText(htmlExam);

    expect(result.questions.length).toBe(2);
    expect(result.questions[0].correctAnswers).toEqual(["B"]);
    expect(result.questions[0].detectionStrategy).toBe("answer_table");
    expect(result.questions[1].correctAnswers).toEqual(["B"]);
    expect(result.questions[1].detectionStrategy).toBe("answer_table");
  });

  it("Bóc tách chính xác 100% file thực tế 10_cau_trac_nghiem_triet_hoc_4_kieu_danh_dau.docx", async () => {
    const fs = await import("fs");
    const filePath = "d:/Qizzone/documents/doc_test/10_cau_trac_nghiem_triet_hoc_4_kieu_danh_dau.docx";
    if (fs.existsSync(filePath)) {
      const { parseDocxDirectAst } = await import("@/utils/parsers/docxAstParser");
      const buffer = fs.readFileSync(filePath);
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      const ast = await parseDocxDirectAst(arrayBuffer);
      const result = parseRawExamText(ast.fullHtml || ast.fullText, {
        fileName: "10_cau_trac_nghiem_triet_hoc_4_kieu_danh_dau.docx",
        fileType: "docx",
      });

      expect(result.questions.length).toBe(10);
      expect(result.questions[0].correctAnswers).toEqual(["B"]); // Câu 1: Dấu *
      expect(result.questions[0].detectionStrategy).toBe("special_marker");

      expect(result.questions[1].correctAnswers).toEqual(["C"]); // Câu 2: Gạch chân
      expect(result.questions[1].detectionStrategy).toBe("underline");

      expect(result.questions[2].correctAnswers).toEqual(["A"]); // Câu 3: In đậm
      expect(result.questions[2].detectionStrategy).toBe("distinct_bold");

      expect(result.questions[3].correctAnswers).toEqual(["D"]); // Câu 4: Highlight
      expect(result.questions[3].detectionStrategy).toBe("highlight_color");

      expect(result.questions[4].correctAnswers).toEqual(["B"]); // Câu 5: Dấu *
      expect(result.questions[4].detectionStrategy).toBe("special_marker");

      expect(result.questions[5].correctAnswers).toEqual(["A"]); // Câu 6: Gạch chân
      expect(result.questions[5].detectionStrategy).toBe("underline");

      expect(result.questions[6].correctAnswers).toEqual(["C"]); // Câu 7: In đậm
      expect(result.questions[6].detectionStrategy).toBe("distinct_bold");

      expect(result.questions[7].correctAnswers).toEqual(["D"]); // Câu 8: Highlight
      expect(result.questions[7].detectionStrategy).toBe("highlight_color");

      expect(result.questions[8].correctAnswers).toEqual(["A"]); // Câu 9: Dấu *
      expect(result.questions[8].detectionStrategy).toBe("special_marker");

      expect(result.questions[9].correctAnswers).toEqual(["C"]); // Câu 10: In đậm
      expect(result.questions[9].detectionStrategy).toBe("distinct_bold");
    }
  });
});
