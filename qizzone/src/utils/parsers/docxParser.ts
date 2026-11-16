import mammoth from "mammoth";
import { parseRawExamText } from "./ruleExtractor";
import { parseDocxDirectAst, type ParsedDocxAst } from "./docxAstParser";
import { MAX_OCR_PAGES_PER_IMPORT, recognizeOcrPages, type OcrPageResult } from "./ocrService";
import type { ExtractionResult } from "@/types/extractor";
import type { DocumentIR, DocumentIRBlock } from "@/types/documentIR";
import { attachQuestionSourceReferences } from "./sourceReference";

export interface DocxParseOutput {
  rawHtml: string;
  rawText: string;
  result: ExtractionResult;
  extractedImages?: Record<string, string>;
  documentIR: DocumentIR;
}

async function sha256(data: ArrayBuffer): Promise<string | undefined> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return undefined;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildDocxIR(ast: ParsedDocxAst, sourceHash: string | undefined, imageText: Map<string, OcrPageResult>): DocumentIR {
  const flowBlocks: DocumentIRBlock[] = [];
  let readingOrder = 0;
  ast.paragraphs.forEach((paragraph, paragraphIndex) => {
    if (paragraph.text.trim()) {
      flowBlocks.push({
        id: "docx_paragraph_" + paragraphIndex,
        type: "paragraph",
        text: paragraph.text,
        normalizedText: paragraph.text.normalize("NFKC"),
        readingOrder: readingOrder++,
        sourceRef: { paragraph: paragraphIndex },
      });
    }
    paragraph.runs.forEach((run, runIndex) => {
      if (run.imageId) {
        flowBlocks.push({
          id: "docx_image_" + run.imageId,
          type: "image",
          text: run.text,
          readingOrder: readingOrder++,
          sourceRef: { paragraph: paragraphIndex, run: runIndex },
          assetId: run.imageId,
        });
        const image = ast.extractedImages[run.imageId];
        const ocr = image ? imageText.get(image) : undefined;
        if (ocr?.text) {
          flowBlocks.push({
            id: "docx_ocr_" + run.imageId,
            type: "text_span",
            text: ocr.text,
            normalizedText: ocr.text.normalize("NFKC"),
            readingOrder: readingOrder++,
            sourceRef: { paragraph: paragraphIndex, run: runIndex },
          });
        }
        return;
      }
      if (!run.text.trim()) return;
      flowBlocks.push({
        id: "docx_p" + paragraphIndex + "_r" + runIndex,
        type: run.isMath ? "formula" : paragraph.numberingLabel && runIndex === 0 ? "list_item" : "text_span",
        text: run.text,
        normalizedText: run.text.normalize("NFKC"),
        readingOrder: readingOrder++,
        style: {
          bold: run.style.isBold,
          underline: run.style.isUnderline,
          italic: run.style.isItalic,
          color: run.style.textColor,
          highlight: run.style.isHighlighted ? (run.style.backgroundColor || "highlight") : undefined,
        },
        sourceRef: { paragraph: paragraphIndex, run: runIndex },
      });
    });
  });
  return {
    schemaVersion: "2.0",
    sourceFormat: "docx",
    sourceHash,
    parserVersion: "qizzone-docx-openxml-v2",
    pages: [],
    flowBlocks,
    warnings: ["docx_page_coordinates_unavailable_until_rendered"],
  };
}

function insertOcrForParagraphs(ast: ParsedDocxAst, imageText: Map<string, OcrPageResult>) {
  const paragraphs = ast.paragraphs.map(paragraph => {
    let text = paragraph.text;
    let html = paragraph.html;
    for (const image of paragraph.images) {
      const recognized = imageText.get(image)?.text;
      if (!recognized) continue;
      const escaped = escapeHtml(recognized);
      text = text.replace("[Hình ảnh]", "\n" + recognized);
      html = html.replace("[Hình ảnh]", "<span class=\"ocr-image-text\">" + escaped + "</span>");
    }
    return { ...paragraph, text, html };
  });
  return {
    paragraphs,
    rawText: paragraphs.map(paragraph => paragraph.text).join("\n"),
    rawHtml: paragraphs.map((paragraph, index) => "<div data-source-id=\"docx_paragraph_" + index + "\"><p>" + paragraph.html + "</p></div>").join("\n"),
  };
}

async function buildAstResult(ast: ParsedDocxAst, file: File, arrayBuffer: ArrayBuffer): Promise<DocxParseOutput> {
  const sourceHash = await sha256(arrayBuffer);
  const imageEntries = Object.entries(ast.extractedImages);
  const qualityFlags = ["docx_page_coordinates_unavailable_until_rendered"];
  const imageText = new Map<string, OcrPageResult>();
  if (imageEntries.length && typeof window === "undefined") {
    qualityFlags.push("docx_image_ocr_requires_browser_runtime");
  } else if (imageEntries.length) {
    if (imageEntries.length > MAX_OCR_PAGES_PER_IMPORT) qualityFlags.push("docx_image_ocr_limit_exceeded");
    const selected = imageEntries.slice(0, MAX_OCR_PAGES_PER_IMPORT);
    try {
      const recognized = await recognizeOcrPages(selected.map(([, image], index) => ({
        pageNumber: index + 1,
        image,
      })));
      recognized.forEach((result, index) => imageText.set(selected[index][1], result));
      if (recognized.some(result => result.confidence < 0.72)) qualityFlags.push("docx_image_ocr_low_confidence");
    } catch {
      qualityFlags.push("docx_image_ocr_failed");
    }
  }

  const augmented = insertOcrForParagraphs(ast, imageText);
  let result = parseRawExamText(augmented.rawHtml || augmented.rawText, {
    fileName: file.name,
    fileType: "docx",
    initialAnswerKey: ast.answerKeyMap,
    extractedImages: ast.extractedImages,
    allowCompactOptionLabels: imageText.size > 0,
  });
  const documentIR = buildDocxIR(ast, sourceHash, imageText);
  result = attachQuestionSourceReferences(result, documentIR);
  result.fileSize = file.size;
  result.sourceHash = sourceHash;
  result.extractionMethod = imageText.size ? "ocr" : "native_parser";
  result.qualityFlags = [...new Set([...(result.qualityFlags || []), ...qualityFlags])];
  result.warningsCount += qualityFlags.length;

  return {
    rawHtml: augmented.rawHtml,
    rawText: augmented.rawText,
    result,
    extractedImages: ast.extractedImages,
    documentIR,
  };
}

/** Native OOXML preserves style, math, tables and images before any plain-text fallback. */
export async function parseDocxFile(file: File): Promise<DocxParseOutput> {
  const arrayBuffer = await file.arrayBuffer();
  let ast: ParsedDocxAst | undefined;
  try {
    ast = await parseDocxDirectAst(arrayBuffer);
  } catch {
    ast = undefined;
  }
  if (ast && (ast.fullText.trim().length > 0 || ast.paragraphs.length > 0)) {
    return buildAstResult(ast, file, arrayBuffer);
  }

  const styleMap = [
    "u => u.is-underline",
    "b => strong.is-bold",
    "strong => strong.is-bold",
    "mark => mark.is-highlighted",
    "span[style*='underline'] => u.is-underline",
    "span[style*='red'] => span.text-color-red",
    "span[style*='#FF0000'] => span.text-color-red",
    "span[style*='#ff0000'] => span.text-color-red",
    "span[style*='#e11d48'] => span.text-color-red",
    "span[style*='yellow'] => mark.is-highlighted",
    "sup => sup",
    "sub => sub",
  ];
  const htmlResult = await mammoth.convertToHtml({ arrayBuffer, styleMap });
  const rawTextResult = await mammoth.extractRawText({ arrayBuffer });
  const rawHtml = htmlResult.value;
  const rawText = rawTextResult.value;
  const sourceHash = await sha256(arrayBuffer);
  let result = parseRawExamText(rawHtml || rawText, { fileName: file.name, fileType: "docx" });
  result.fileSize = file.size;
  result.sourceHash = sourceHash;
  result.qualityFlags = [...new Set([...(result.qualityFlags || []), "docx_style_fallback_used", "docx_page_coordinates_unavailable_until_rendered"])];
  const documentIR: DocumentIR = {
    schemaVersion: "2.0",
    sourceFormat: "docx",
    sourceHash,
    parserVersion: "mammoth-fallback-v2",
    pages: [],
    warnings: ["docx_style_fallback_used", "docx_page_coordinates_unavailable_until_rendered"],
    flowBlocks: rawText.split(/\r?\n/).filter(Boolean).map((text, index) => ({
      id: "docx_fallback_" + index,
      type: "paragraph" as const,
      text,
      normalizedText: text.normalize("NFKC"),
      readingOrder: index,
      sourceRef: { paragraph: index },
    })),
  };
  result = attachQuestionSourceReferences(result, documentIR);
  return {
    rawHtml,
    rawText,
    result,
    documentIR,
  };
}
