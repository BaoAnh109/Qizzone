import JSZip from "jszip";
import { DOMParser as XmldomParser } from "@xmldom/xmldom";
import type { OptionId } from "@/types/quiz";

export function parseXmlString(xmlString: string): Document {
  if (typeof DOMParser !== "undefined") {
    return new DOMParser().parseFromString(xmlString, "application/xml");
  }
  return new XmldomParser().parseFromString(xmlString, "text/xml") as unknown as Document;
}

export interface DocxRunStyle {
  isBold?: boolean;
  isUnderline?: boolean;
  isItalic?: boolean;
  isHighlighted?: boolean;
  isRedColor?: boolean;
  textColor?: string;
  backgroundColor?: string;
  isStrike?: boolean;
}

export interface DocxRun {
  text: string;
  style: DocxRunStyle;
  isMath?: boolean;
  imageId?: string;
}

export interface DocxParagraph {
  runs: DocxRun[];
  text: string; // Plain text representation with LaTeX & marker tags
  html: string; // Styled HTML representation preserving bold, underline, mark, color
  images: string[]; // Base64 data URLs of images in this paragraph
}

export interface DocxTableCell {
  paragraphs: DocxParagraph[];
  text: string;
  html: string;
}

export interface DocxTableRow {
  cells: DocxTableCell[];
}

export interface DocxTable {
  rows: DocxTableRow[];
  isAnswerTable?: boolean;
  answerMap?: Record<number, OptionId>;
}

export interface ParsedDocxAst {
  paragraphs: DocxParagraph[];
  tables: DocxTable[];
  fullHtml: string;
  fullText: string;
  extractedImages: Record<string, string>; // rId -> base64 data URL
  answerKeyMap: Record<number, OptionId>;
}

/**
 * Phân tích trực tiếp tệp DOCX từ ArrayBuffer bằng OpenXML AST Parser
 */
export async function parseDocxDirectAst(arrayBuffer: ArrayBuffer): Promise<ParsedDocxAst> {
  const zip = await JSZip.loadAsync(arrayBuffer);

  // 1. Đọc relationships để trích xuất hình ảnh (word/_rels/document.xml.rels)
  const relsFile = zip.file("word/_rels/document.xml.rels");
  const relsXml = relsFile ? await relsFile.async("text") : "";
  const relationships = parseRelationships(relsXml);

  // 2. Trích xuất tất cả các tệp hình ảnh trong word/media/
  const extractedImages: Record<string, string> = {};
  for (const [rId, target] of Object.entries(relationships)) {
    if (target.startsWith("media/") || target.includes("media/")) {
      const mediaPath = target.startsWith("word/") ? target : `word/${target.replace(/^(\.\.\/)+/, "")}`;
      const imageZipEntry = zip.file(mediaPath);
      if (imageZipEntry) {
        const mime = getMimeTypeFromFilename(mediaPath);
        const base64Data = await imageZipEntry.async("base64");
        extractedImages[rId] = `data:${mime};base64,${base64Data}`;
      }
    }
  }

  // 3. Đọc nội dung chính: word/document.xml
  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    throw new Error("Tệp không phải là tài liệu Word (.docx) hợp lệ!");
  }
  const documentXml = await docFile.async("text");

  // 4. Parse XML bằng DOMParser / xmldom
  const xmlDoc = parseXmlString(documentXml);

  const paragraphs: DocxParagraph[] = [];
  const tables: DocxTable[] = [];
  const globalAnswerKeyMap: Record<number, OptionId> = {};

  const body = xmlDoc.getElementsByTagName("w:body")[0];
  if (!body) {
    return {
      paragraphs: [],
      tables: [],
      fullHtml: "",
      fullText: "",
      extractedImages,
      answerKeyMap: {},
    };
  }

  // Duyệt qua các phần tử con trực tiếp của w:body (paragraph hoặc table)
  const bodyChildren = Array.from(body.childNodes);

  for (const node of bodyChildren) {
    if (node.nodeType !== 1) continue;
    const elem = node as Element;
    const nodeName = elem.nodeName.toLowerCase();

    if (nodeName === "w:p") {
      const p = parseParagraphElement(elem, extractedImages);
      if (p.text.trim().length > 0 || p.images.length > 0) {
        paragraphs.push(p);
      }
    } else if (nodeName === "w:tbl") {
      const table = parseTableElement(elem, extractedImages);
      tables.push(table);

      // Nếu bảng này là bảng đáp án, gộp vào globalAnswerKeyMap
      if (table.answerMap) {
        Object.assign(globalAnswerKeyMap, table.answerMap);
      }

      // Đẩy nội dung bảng vào paragraphs để regex có thể quét theo luồng
      for (const row of table.rows) {
        const rowCellsHtml = row.cells.map((c) => `<td>${c.html}</td>`).join("");
        const rowCellsText = row.cells.map((c) => c.text).join("\t");
        paragraphs.push({
          runs: row.cells.flatMap((c) => c.paragraphs.flatMap((p) => p.runs)),
          text: rowCellsText,
          html: `<tr>${rowCellsHtml}</tr>`,
          images: row.cells.flatMap((c) => c.paragraphs.flatMap((p) => p.images)),
        });
      }
    }
  }

  const fullHtml = paragraphs.map((p) => `<p>${p.html}</p>`).join("\n");
  const fullText = paragraphs.map((p) => p.text).join("\n");

  return {
    paragraphs,
    tables,
    fullHtml,
    fullText,
    extractedImages,
    answerKeyMap: globalAnswerKeyMap,
  };
}

/**
 * Phân tích 1 phần tử w:p thành DocxParagraph
 */
function parseParagraphElement(
  pElem: Element,
  imagesMap: Record<string, string>
): DocxParagraph {
  const runs: DocxRun[] = [];
  const paragraphImages: string[] = [];

  const children = Array.from(pElem.childNodes);

  for (const child of children) {
    if (child.nodeType !== 1) continue;
    const elem = child as Element;
    const nodeName = elem.nodeName.toLowerCase();

    if (nodeName === "w:r") {
      // Phân tích Run thông thường
      const r = parseRunElement(elem, imagesMap);
      if (r.text.length > 0 || r.imageId) {
        runs.push(r);
        if (r.imageId && imagesMap[r.imageId]) {
          paragraphImages.push(imagesMap[r.imageId]);
        }
      }
    } else if (nodeName === "m:omath" || nodeName === "m:omathpara") {
      // Phân tích công thức toán học OMML và chuyển sang LaTeX $...$
      const latex = convertOmmlToLatex(elem);
      if (latex.trim().length > 0) {
        runs.push({
          text: `$${latex.trim()}$`,
          style: {},
          isMath: true,
        });
      }
    } else if (nodeName === "w:drawing") {
      // Hình ảnh trực tiếp trong paragraph
      const rId = extractImageIdFromDrawing(elem);
      if (rId && imagesMap[rId]) {
        runs.push({
          text: ` [Hình ảnh] `,
          style: {},
          imageId: rId,
        });
        paragraphImages.push(imagesMap[rId]);
      }
    }
  }

  // Tạo text và html đại diện
  let text = "";
  let html = "";

  for (const r of runs) {
    text += r.text;

    let segmentHtml = escapeHtml(r.text);

    if (r.style.isUnderline) {
      segmentHtml = `<u class="is-underline">${segmentHtml}</u>`;
    }
    if (r.style.isBold) {
      segmentHtml = `<strong class="is-bold">${segmentHtml}</strong>`;
    }
    if (r.style.isHighlighted) {
      segmentHtml = `<mark class="is-highlighted">${segmentHtml}</mark>`;
    }
    if (r.style.isRedColor) {
      segmentHtml = `<span class="text-color-red" style="color:#e11d48">${segmentHtml}</span>`;
    }

    html += segmentHtml;
  }

  return {
    runs,
    text,
    html,
    images: paragraphImages,
  };
}

/**
 * Phân tích phần tử w:r (Text Run) và trích xuất phong cách (bold, underline, highlight, font color)
 */
function parseRunElement(
  rElem: Element,
  imagesMap: Record<string, string>
): DocxRun {
  const style: DocxRunStyle = {};
  let text = "";
  let imageId: string | undefined = undefined;

  const rPr = rElem.getElementsByTagName("w:rPr")[0];
  if (rPr) {
    // 1. In đậm (Bold)
    const bElem = rPr.getElementsByTagName("w:b")[0];
    const bCsElem = rPr.getElementsByTagName("w:bCs")[0];
    if (bElem || bCsElem) {
      const val = bElem?.getAttribute("w:val");
      if (val !== "0" && val !== "false" && val !== "off") {
        style.isBold = true;
      }
    }

    // 2. Gạch chân (Underline)
    const uElem = rPr.getElementsByTagName("w:u")[0];
    if (uElem) {
      const val = uElem.getAttribute("w:val");
      if (val && val !== "none") {
        style.isUnderline = true;
      }
    }

    // 3. In nghiêng (Italic)
    const iElem = rPr.getElementsByTagName("w:i")[0];
    if (iElem) {
      const val = iElem.getAttribute("w:val");
      if (val !== "0" && val !== "false" && val !== "off") {
        style.isItalic = true;
      }
    }

    // 4. Highlight (Tô nền màu)
    const hlElem = rPr.getElementsByTagName("w:highlight")[0];
    if (hlElem) {
      const val = hlElem.getAttribute("w:val");
      if (val && val !== "none") {
        style.isHighlighted = true;
      }
    }

    // 5. Shading (Nền màu)
    const shdElem = rPr.getElementsByTagName("w:shd")[0];
    if (shdElem) {
      const fill = shdElem.getAttribute("w:fill");
      if (fill && fill !== "auto" && fill !== "none" && fill !== "FFFFFF") {
        style.isHighlighted = true;
        style.backgroundColor = `#${fill}`;
      }
    }

    // 6. Màu chữ (Font Color)
    const colorElem = rPr.getElementsByTagName("w:color")[0];
    if (colorElem) {
      const colorVal = (colorElem.getAttribute("w:val") || "").toUpperCase();
      if (colorVal && colorVal !== "AUTO" && colorVal !== "000000") {
        style.textColor = `#${colorVal}`;
        // Kiểm tra các gam màu đỏ / cam đậm thường dùng làm đáp án
        if (
          colorVal.startsWith("FF") ||
          colorVal.startsWith("ED") ||
          colorVal.startsWith("C0") ||
          colorVal.startsWith("E1") ||
          colorVal === "RED"
        ) {
          style.isRedColor = true;
        }
      }
    }
  }

  // Trích xuất văn bản trong thẻ w:t hoặc w:tab
  for (const child of Array.from(rElem.childNodes)) {
    if (child.nodeType !== 1) continue;
    const childElem = child as Element;
    const name = childElem.nodeName.toLowerCase();

    if (name === "w:t") {
      text += childElem.textContent || "";
    } else if (name === "w:tab") {
      text += "\t";
    } else if (name === "w:br") {
      text += "\n";
    } else if (name === "w:drawing") {
      const rId = extractImageIdFromDrawing(childElem);
      if (rId && imagesMap[rId]) {
        imageId = rId;
        text += " [Hình ảnh] ";
      }
    }
  }

  return {
    text,
    style,
    imageId,
  };
}

/**
 * Trích xuất rId hình ảnh từ thẻ w:drawing hoặc v:imagedata
 */
function extractImageIdFromDrawing(drawingElem: Element): string | null {
  const blip = drawingElem.getElementsByTagName("a:blip")[0];
  if (blip) {
    const embedId = blip.getAttribute("r:embed");
    if (embedId) return embedId;
  }

  const vImageData = drawingElem.getElementsByTagName("v:imagedata")[0];
  if (vImageData) {
    const rId = vImageData.getAttribute("r:id");
    if (rId) return rId;
  }

  return null;
}

/**
 * Phân tích phần tử w:tbl (Bảng)
 */
function parseTableElement(
  tblElem: Element,
  imagesMap: Record<string, string>
): DocxTable {
  const rows: DocxTableRow[] = [];
  const trElems = Array.from(tblElem.getElementsByTagName("w:tr"));

  for (const tr of trElems) {
    const cells: DocxTableCell[] = [];
    const tcElems = Array.from(tr.getElementsByTagName("w:tc"));

    for (const tc of tcElems) {
      const pElems = Array.from(tc.getElementsByTagName("w:p"));
      const cellParagraphs: DocxParagraph[] = [];

      for (const p of pElems) {
        const parsedP = parseParagraphElement(p, imagesMap);
        if (parsedP.text.trim().length > 0 || parsedP.images.length > 0) {
          cellParagraphs.push(parsedP);
        }
      }

      const cellText = cellParagraphs.map((p) => p.text).join(" ").trim();
      const cellHtml = cellParagraphs.map((p) => p.html).join(" ").trim();

      cells.push({
        paragraphs: cellParagraphs,
        text: cellText,
        html: cellHtml,
      });
    }

    if (cells.length > 0) {
      rows.push({ cells });
    }
  }

  // Kiểm tra xem bảng này có phải là Bảng đáp án ma trận không
  const answerMap: Record<number, OptionId> = {};
  let isAnswerTable = false;

  if (rows.length >= 2) {
    // Kiểu 1: Hàng 1 là số câu (1, 2, 3...), Hàng 2 là đáp án (A, B, C...)
    for (let r = 0; r < rows.length - 1; r += 2) {
      const qRow = rows[r].cells;
      const aRow = rows[r + 1].cells;

      let validPairsCount = 0;
      for (let c = 0; c < Math.min(qRow.length, aRow.length); c++) {
        const qNum = parseInt(qRow[c].text.replace(/\D/g, ""), 10);
        const ans = aRow[c].text.toUpperCase().trim() as OptionId;

        if (qNum > 0 && qNum <= 300 && ["A", "B", "C", "D"].includes(ans)) {
          answerMap[qNum] = ans;
          validPairsCount++;
        }
      }

      if (validPairsCount >= 2) {
        isAnswerTable = true;
      }
    }
  }

  // Kiểu 2: Bảng nhiều cột dạng [Câu 1 | A] [Câu 2 | B]
  if (!isAnswerTable && rows.length >= 2) {
    let validPairsCount = 0;
    for (const row of rows) {
      for (let i = 0; i < row.cells.length - 1; i += 2) {
        const qNum = parseInt(row.cells[i].text.replace(/\D/g, ""), 10);
        const ans = row.cells[i + 1].text.toUpperCase().trim() as OptionId;
        if (qNum > 0 && qNum <= 300 && ["A", "B", "C", "D"].includes(ans)) {
          answerMap[qNum] = ans;
          validPairsCount++;
        }
      }
    }
    if (validPairsCount >= 3) {
      isAnswerTable = true;
    }
  }

  return {
    rows,
    isAnswerTable,
    answerMap: isAnswerTable ? answerMap : undefined,
  };
}

/**
 * Bộ chuyển đổi công thức Toán học OMML (OpenXML Math) sang LaTeX KaTeX
 * Hỗ trợ toàn diện: phân số, căn số, số mũ, chỉ số dưới, tích phân, hàm lượng giác, ma trận, ngoặc...
 */
export function convertOmmlToLatex(node: Element): string {
  if (!node) return "";
  const tag = (node.localName || node.nodeName || "").toLowerCase().replace(/^m:/, "");

  switch (tag) {
    case "omath":
    case "omathpara":
    case "num":
    case "den":
    case "e":
    case "deg":
    case "sup":
    case "sub":
    case "fname": {
      let result = "";
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 1) {
          result += convertOmmlToLatex(child as Element);
        }
      }
      return result;
    }

    case "r": {
      // Tìm m:t hoặc t
      const tElems = Array.from(node.getElementsByTagName("m:t")).concat(
        Array.from(node.getElementsByTagName("t"))
      );
      if (tElems.length > 0) {
        return convertMathSymbols(tElems.map((t) => t.textContent || "").join(""));
      }
      return convertMathSymbols(node.textContent || "");
    }

    case "t": {
      return convertMathSymbols(node.textContent || "");
    }

    case "f": {
      // Phân số (Fraction) <m:f><m:num>...</m:num><m:den>...</m:den></m:f>
      const numElem = getFirstDirectOrDescendant(node, ["m:num", "num"]);
      const denElem = getFirstDirectOrDescendant(node, ["m:den", "den"]);
      const numLatex = numElem ? convertOmmlToLatex(numElem) : "";
      const denLatex = denElem ? convertOmmlToLatex(denElem) : "";
      return `\\frac{${numLatex}}{${denLatex}}`;
    }

    case "rad": {
      // Căn thức (Radical) <m:rad><m:deg>...</m:deg><m:e>...</m:e></m:rad>
      const degElem = getFirstDirectOrDescendant(node, ["m:deg", "deg"]);
      const eElem = getFirstDirectOrDescendant(node, ["m:e", "e"]);
      const degLatex = degElem ? convertOmmlToLatex(degElem).trim() : "";
      const eLatex = eElem ? convertOmmlToLatex(eElem) : "";

      if (degLatex.length > 0) {
        return `\\sqrt[${degLatex}]{${eLatex}}`;
      }
      return `\\sqrt{${eLatex}}`;
    }

    case "ssup": {
      // Số mũ (Superscript) <m:sSup><m:e>...</m:e><m:sup>...</m:sup></m:sSup>
      const eElem = getFirstDirectOrDescendant(node, ["m:e", "e"]);
      const supElem = getFirstDirectOrDescendant(node, ["m:sup", "sup"]);
      const eLatex = eElem ? convertOmmlToLatex(eElem) : "";
      const supLatex = supElem ? convertOmmlToLatex(supElem) : "";
      return `{${eLatex}}^{${supLatex}}`;
    }

    case "ssub": {
      // Chỉ số dưới (Subscript) <m:sSub><m:e>...</m:e><m:sub>...</m:sub></m:sSub>
      const eElem = getFirstDirectOrDescendant(node, ["m:e", "e"]);
      const subElem = getFirstDirectOrDescendant(node, ["m:sub", "sub"]);
      const eLatex = eElem ? convertOmmlToLatex(eElem) : "";
      const subLatex = subElem ? convertOmmlToLatex(subElem) : "";
      return `{${eLatex}}_{${subLatex}}`;
    }

    case "ssubsup": {
      // Cả trên và dưới <m:sSubSup><m:e>...</m:e><m:sub>...</m:sub><m:sup>...</m:sup></m:sSubSup>
      const eElem = getFirstDirectOrDescendant(node, ["m:e", "e"]);
      const subElem = getFirstDirectOrDescendant(node, ["m:sub", "sub"]);
      const supElem = getFirstDirectOrDescendant(node, ["m:sup", "sup"]);
      const eLatex = eElem ? convertOmmlToLatex(eElem) : "";
      const subLatex = subElem ? convertOmmlToLatex(subElem) : "";
      const supLatex = supElem ? convertOmmlToLatex(supElem) : "";
      return `{${eLatex}}_{${subLatex}}^{${supLatex}}`;
    }

    case "d": {
      // Dấu ngoặc (Delimiter) <m:d><m:e>...</m:e></m:d>
      const dPr = getFirstDirectOrDescendant(node, ["m:dPr", "dPr"]);
      const begChrElem = dPr ? getFirstDirectOrDescendant(dPr, ["m:begChr", "begChr"]) : null;
      const endChrElem = dPr ? getFirstDirectOrDescendant(dPr, ["m:endChr", "endChr"]) : null;
      const begChr = begChrElem?.getAttribute("m:val") || begChrElem?.getAttribute("val") || "(";
      const endChr = endChrElem?.getAttribute("m:val") || endChrElem?.getAttribute("val") || ")";

      const eElem = getFirstDirectOrDescendant(node, ["m:e", "e"]);
      const eLatex = eElem ? convertOmmlToLatex(eElem) : "";

      const openBracket = begChr === "{" ? "\\left\\{" : begChr === "[" ? "\\left[" : "\\left(";
      const closeBracket = endChr === "}" ? "\\right\\}" : endChr === "]" ? "\\right]" : "\\right)";
      return `${openBracket}${eLatex}${closeBracket}`;
    }

    case "func": {
      // Hàm số (Function: sin, cos, log, lim...)
      const fNameElem = getFirstDirectOrDescendant(node, ["m:fName", "fName"]);
      const eElem = getFirstDirectOrDescendant(node, ["m:e", "e"]);
      const fName = fNameElem ? convertOmmlToLatex(fNameElem).trim() : "";
      const eLatex = eElem ? convertOmmlToLatex(eElem) : "";
      return `\\${fName} ${eLatex}`;
    }

    case "nary": {
      // Tích phân, Tổng sigma, Tích Pi
      const naryPr = getFirstDirectOrDescendant(node, ["m:naryPr", "naryPr"]);
      const chrElem = naryPr ? getFirstDirectOrDescendant(naryPr, ["m:chr", "chr"]) : null;
      const chr = chrElem?.getAttribute("m:val") || chrElem?.getAttribute("val") || "∫";
      const subElem = getFirstDirectOrDescendant(node, ["m:sub", "sub"]);
      const supElem = getFirstDirectOrDescendant(node, ["m:sup", "sup"]);
      const eElem = getFirstDirectOrDescendant(node, ["m:e", "e"]);

      let op = "\\int";
      if (chr === "∑") op = "\\sum";
      else if (chr === "∏") op = "\\prod";

      const subLatex = subElem ? convertOmmlToLatex(subElem).trim() : "";
      const supLatex = supElem ? convertOmmlToLatex(supElem).trim() : "";
      const eLatex = eElem ? convertOmmlToLatex(eElem) : "";

      if (subLatex && supLatex) {
        return `${op}_{${subLatex}}^{${supLatex}} ${eLatex}`;
      } else if (subLatex) {
        return `${op}_{${subLatex}} ${eLatex}`;
      }
      return `${op} ${eLatex}`;
    }

    case "acc": {
      // Dấu mũ, vector, gạch ngang
      const accPr = getFirstDirectOrDescendant(node, ["m:accPr", "accPr"]);
      const chrElem = accPr ? getFirstDirectOrDescendant(accPr, ["m:chr", "chr"]) : null;
      const chr = chrElem?.getAttribute("m:val") || chrElem?.getAttribute("val") || "̂";
      const eElem = getFirstDirectOrDescendant(node, ["m:e", "e"]);
      const eLatex = eElem ? convertOmmlToLatex(eElem) : "";

      if (chr === "→" || chr === "⃗") {
        return `\\vec{${eLatex}}`;
      } else if (chr === "¯" || chr === "‾") {
        return `\\overline{${eLatex}}`;
      }
      return `\\hat{${eLatex}}`;
    }

    case "m": {
      // Ma trận <m:m>
      const mrElems = Array.from(node.getElementsByTagName("m:mr")).concat(
        Array.from(node.getElementsByTagName("mr"))
      );
      const rowsLatex: string[] = [];
      for (const mr of mrElems) {
        const eElems = Array.from(mr.getElementsByTagName("m:e")).concat(
          Array.from(mr.getElementsByTagName("e"))
        );
        const rowContent = eElems.map((e) => convertOmmlToLatex(e).trim()).join(" & ");
        rowsLatex.push(rowContent);
      }
      return `\\begin{matrix} ${rowsLatex.join(" \\\\ ")} \\end{matrix}`;
    }

    default: {
      let result = "";
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 1) {
          result += convertOmmlToLatex(child as Element);
        }
      }
      return result;
    }
  }
}

function getFirstDirectOrDescendant(parent: Element, tagNames: string[]): Element | null {
  for (const name of tagNames) {
    const elems = parent.getElementsByTagName(name);
    if (elems && elems.length > 0) {
      return elems[0];
    }
  }
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 1) {
      const childElem = child as Element;
      const childTag = (childElem.localName || childElem.nodeName || "").toLowerCase().replace(/^m:/, "");
      for (const name of tagNames) {
        if (childTag === name.replace(/^m:/, "").toLowerCase()) {
          return childElem;
        }
      }
    }
  }
  return null;
}

/**
 * Chuyển các ký tự toán học Unicode phổ biến sang lệnh LaTeX
 */
function convertMathSymbols(str: string): string {
  return str
    .replace(/α/g, "\\alpha ")
    .replace(/β/g, "\\beta ")
    .replace(/γ/g, "\\gamma ")
    .replace(/δ/g, "\\delta ")
    .replace(/ε/g, "\\epsilon ")
    .replace(/θ/g, "\\theta ")
    .replace(/λ/g, "\\lambda ")
    .replace(/μ/g, "\\mu ")
    .replace(/π/g, "\\pi ")
    .replace(/σ/g, "\\sigma ")
    .replace(/φ/g, "\\phi ")
    .replace(/ω/g, "\\omega ")
    .replace(/Δ/g, "\\Delta ")
    .replace(/Ω/g, "\\Omega ")
    .replace(/∞/g, "\\infty ")
    .replace(/±/g, "\\pm ")
    .replace(/≠/g, "\\neq ")
    .replace(/≤/g, "\\le ")
    .replace(/≥/g, "\\ge ")
    .replace(/≈/g, "\\approx ")
    .replace(/∈/g, "\\in ")
    .replace(/∉/g, "\\notin ")
    .replace(/⊂/g, "\\subset ")
    .replace(/∪/g, "\\cup ")
    .replace(/∩/g, "\\cap ")
    .replace(/→/g, "\\rightarrow ")
    .replace(/⇒/g, "\\Rightarrow ")
    .replace(/⇔/g, "\\Leftrightarrow ")
    .replace(/∀/g, "\\forall ")
    .replace(/∃/g, "\\exists ")
    .replace(/×/g, "\\times ")
    .replace(/÷/g, "\\div ");
}

/**
 * Phân tích quan hệ relationships từ XML
 */
function parseRelationships(relsXml: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!relsXml) return result;

  const xml = parseXmlString(relsXml);
  const relNodes = Array.from(xml.getElementsByTagName("Relationship"));

  for (const rel of relNodes) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (id && target) {
      result[id] = target;
    }
  }

  return result;
}

function getMimeTypeFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
