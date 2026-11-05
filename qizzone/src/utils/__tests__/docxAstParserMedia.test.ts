import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseDocxDirectAst } from "@/utils/parsers/docxAstParser";
import {
  parseRawExamText,
  extractBlockImages,
} from "@/utils/parsers/ruleExtractor";

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml"';

async function buildDocx(bodyInner: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>` +
      `</Relationships>`
  );
  zip.file(
    "word/media/image1.png",
    Buffer.from(PNG_1X1_BASE64, "base64")
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document ${NS}><w:body>${bodyInner}</w:body></w:document>`
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

const FRAC_IN_RUN =
  `<m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num>` +
  `<m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath>`;

describe("Bước 14: OMML nằm trong w:r", () => {
  it("phân số trong run chuyển thành LaTeX, giữ văn bản xung quanh", async () => {
    const buf = await buildDocx(
      `<w:p><w:r><w:t>Câu 1. Tính </w:t></w:r>` +
        `<w:r>${FRAC_IN_RUN}</w:r>` +
        `<w:r><w:t> bằng bao nhiêu?</w:t></w:r></w:p>`
    );
    const ast = await parseDocxDirectAst(buf);
    expect(ast.paragraphs).toHaveLength(1);
    expect(ast.paragraphs[0].text).toBe(
      "Câu 1. Tính $\\frac{1}{2}$ bằng bao nhiêu?"
    );
  });

  it("run in đậm chứa công thức vẫn giữ định dạng bold quanh LaTeX", async () => {
    const buf = await buildDocx(
      `<w:p><w:r><w:rPr><w:b/></w:rPr>${FRAC_IN_RUN}</w:r></w:p>`
    );
    const ast = await parseDocxDirectAst(buf);
    expect(ast.paragraphs[0].runs[0].isMath).toBe(true);
    expect(ast.paragraphs[0].runs[0].style.isBold).toBe(true);
    expect(ast.paragraphs[0].html).toContain("$\\frac{1}{2}$");
    expect(ast.paragraphs[0].html).toContain("is-bold");
  });

  it("OMML trong ô bảng cũng chuyển thành LaTeX (không chỉ đoạn thường)", async () => {
    const buf = await buildDocx(
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Giá trị </w:t></w:r>` +
        `<w:r>${FRAC_IN_RUN}</w:r></w:p></w:tc></w:tr></w:tbl>`
    );
    const ast = await parseDocxDirectAst(buf);
    expect(ast.tables).toHaveLength(1);
    expect(ast.tables[0].rows[0].cells[0].text).toBe(
      "Giá trị $\\frac{1}{2}$"
    );
  });
});

describe("Bước 14: ảnh bọc AlternateContent / VML", () => {
  it("ảnh trong mc:AlternateContent của run được nhận + kèm marker rId", async () => {
    const buf = await buildDocx(
      `<w:p><w:r><mc:AlternateContent><mc:Choice>` +
        `<w:drawing><wp:inline><a:graphic><a:graphicData>` +
        `<pic:pic><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill></pic:pic>` +
        `</a:graphicData></a:graphic></wp:inline></w:drawing>` +
        `</mc:Choice></mc:AlternateContent></w:r></w:p>`
    );
    const ast = await parseDocxDirectAst(buf);
    expect(ast.paragraphs[0].images).toHaveLength(1);
    expect(ast.paragraphs[0].images[0]).toContain("data:image/png;base64,");
    expect(ast.paragraphs[0].html).toContain('data-image-id="rId5"');
  });

  it("ảnh VML w:pict (v:imagedata) được nhận như drawing thường", async () => {
    const buf = await buildDocx(
      `<w:p><w:r><w:pict><v:shape><v:imagedata r:id="rId5"/></v:shape></w:pict></w:r></w:p>`
    );
    const ast = await parseDocxDirectAst(buf);
    expect(ast.paragraphs[0].images).toHaveLength(1);
    expect(ast.paragraphs[0].html).toContain('data-image-id="rId5"');
  });
});

describe("Bước 14: gắn ảnh vào đúng câu hỏi", () => {
  const extractedImages = { rId5: "data:image/png;base64,AAA" };

  it("ảnh trong khối câu 1 gắn vào câu 1, không rò sang câu 2", () => {
    const html =
      `<p>Câu 1. Nhìn hình, có bao nhiêu cạnh?</p>` +
      `<p><img data-image-id="rId5" alt="Hình ảnh"></p>` +
      `<p>A. 2</p><p>B. 3</p>` +
      `<p>Câu 2. Không có hình?</p>` +
      `<p>A. Có</p><p>B. Không</p>`;
    const result = parseRawExamText(html, { extractedImages });
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].images).toEqual(["data:image/png;base64,AAA"]);
    expect(result.questions[1].images).toBeUndefined();
    // Marker không nhiễm vào nội dung chữ của câu 1.
    expect(result.questions[0].content).not.toContain("img");
    expect(result.questions[0].content).not.toContain("rId5");
  });

  it("marker không có trong map thì bỏ qua, không bịa URL", () => {
    const html =
      `<p>Câu 1. Hỏi?</p><p><img data-image-id="rId999" alt="Hình ảnh"></p>` +
      `<p>A. 1</p><p>B. 2</p>`;
    const result = parseRawExamText(html, { extractedImages });
    expect(result.questions[0].images).toBeUndefined();
  });

  it("extractBlockImages dedupe và giữ thứ tự xuất hiện", () => {
    const block =
      `<p><img data-image-id="rId5"></p><p><img data-image-id="rId5"></p>`;
    expect(extractBlockImages(block, extractedImages)).toEqual([
      "data:image/png;base64,AAA",
    ]);
    expect(extractBlockImages(block)).toEqual([]);
  });
});

describe("Bước 14: bảng lồng không làm trùng hàng/cột", () => {
  it("bảng ngoài 1 hàng 2 cột, bảng lồng trong ô không tạo thêm hàng", async () => {
    const buf = await buildDocx(
      `<w:tbl><w:tr>` +
        `<w:tc><w:p><w:r><w:t>Ngoài A</w:t></w:r></w:p>` +
        `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Trong X</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
        `</w:tc>` +
        `<w:tc><w:p><w:r><w:t>Ngoài B</w:t></w:r></w:p></w:tc>` +
        `</w:tr></w:tbl>`
    );
    const ast = await parseDocxDirectAst(buf);
    expect(ast.tables).toHaveLength(1);
    expect(ast.tables[0].rows).toHaveLength(1);
    expect(ast.tables[0].rows[0].cells).toHaveLength(2);
    // Nội dung bảng lồng vẫn flatten vào text của ô chứa nó.
    expect(ast.tables[0].rows[0].cells[0].text).toContain("Trong X");
  });

  it("bảng trong thân câu (giữa stem và options) không phá tách câu", () => {
    const html =
      `<p>Câu 1. Cho bảng số liệu sau, chọn đáp án đúng:</p>` +
      `<tr><td>x</td><td>1</td></tr>` +
      `<p>A. 1</p><p>B. 2</p><p>C. 3</p><p>D. 4</p>`;
    const result = parseRawExamText(html, {});
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].options).toHaveLength(4);
    expect(result.questions[0].content).toContain("Cho bảng số liệu");
  });
});
