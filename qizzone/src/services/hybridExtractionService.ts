import type { ExtractionResult, ExtractedQuestion } from "@/types/extractor";
import { extractQuizWithAI } from "./aiExtractionService";

/** A valid question can legitimately have no key; do not infer missing keys. */
export function needsAIRecovery(result: ExtractionResult): boolean {
  if (result.questions.length === 0) return true;
  return result.questions.some(q => q.options.length < 2 || q.options.some(o => !o.content.trim()));
}

function quality(question: ExtractedQuestion): number {
  return Number(question.content.trim().length > 4) +
    Number(question.options.length >= 2 && question.options.every(o => o.content.trim().length > 0)) * 3;
}

/** Never overwrite a key already extracted from the source document. */
export function mergeAIRecovery(base: ExtractionResult, recovered: ExtractionResult): ExtractionResult {
  if (base.questions.length === 0 && recovered.questions.length > 0) return recovered;
  const merged = base.questions.map((question, index) => {
    const fromAI = recovered.questions[index];
    if (!fromAI || quality(fromAI) <= quality(question)) return question;
    const words = (value: string) => new Set(
      value.toLocaleLowerCase("vi").match(/[\\p{L}\\p{N}]{3,}/gu) || []
    );
    const a = words(question.content);
    const b = words(fromAI.content);
    // Question order alone is not enough evidence to merge after a failed AI batch.
    if (a.size > 3 && [...a].filter(word => b.has(word)).length / a.size < 0.35) return question;
    return {
      ...question,
      content: question.content.trim().length > 4 ? question.content : fromAI.content,
      options: fromAI.options,
      type: fromAI.type || question.type,
      correctAnswers: question.correctAnswers.filter(a => fromAI.options.some(o => o.id === a)),
      warningFlags: ["Đã khôi phục cấu trúc bằng AI; cần đối chiếu tài liệu gốc"],
      confidenceScore: 0,
      detectionStrategy: "ai_inference" as const,
    };
  });
  const warningsCount = merged.reduce((n, q) => n + (q.warningFlags?.length || 0), 0);
  return { ...base, questions: merged, warningsCount };
}

function chunkDocument(text: string): string[] {
  // Preserve question boundaries, limiting each prompt and avoiding cut-off.
  const parts = text.split(/(?=^\s*(?:Câu|Question|Bài)\s+\d+\s*[.：:)]?)/gmi).filter(s => s.trim());
  const chunks: string[] = [];
  let current = "";
  for (const part of (parts.length > 1 ? parts : text.match(/[^\n]{1,10000}(?:\n|$)/g) || [text])) {
    if (current.length + part.length > 12000 && current) {
      chunks.push(current);
      current = "";
    }
    current += part;
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

export async function recoverTextExtraction(
  file: File,
  text: string,
  base: ExtractionResult,
): Promise<ExtractionResult> {
  if (!text.trim()) return base;
  const headerCount = (text.match(/(?:^|\\n)\\s*(?:Câu|Question|Bài)\\s+\\d+\\s*[.：:)]/gmi) || []).length;
  if (!needsAIRecovery(base) && (headerCount === 0 || headerCount <= base.questions.length)) return base;
  const chunks = chunkDocument(text);
  // Avoid treating partial AI output as a complete document if many chunks exist.
  const recovered: ExtractedQuestion[] = [];
  for (const chunk of chunks) {
    try {
      const result = await extractQuizWithAI({ file, text: chunk });
      if (result.questions.some(q => q.options.length >= 2)) recovered.push(...result.questions);
    } catch {
      // Keep the original document and its unresolved questions for manual review.
    }
  }
  if (recovered.length === 0) {
    if (headerCount > base.questions.length) {
      throw new Error(`Thiếu ${headerCount - base.questions.length} câu so với số đầu mục trong tài liệu; AI chưa khôi phục được.`);
    }
    return base;
  }
  if (headerCount > 0 && Math.max(base.questions.length, recovered.length) < headerCount) {
    throw new Error(`Tài liệu có ít nhất ${headerCount} câu, nhưng AI chỉ nhận diện ${recovered.length} câu.`);
  }
  const ai: ExtractionResult = {
    ...base,
    questions: recovered.map((q, index) => ({ ...q, order: index + 1, id: `ai-recovered-${index + 1}` })),
    totalQuestionsDetected: recovered.length,
  };
  if (base.questions.length < recovered.length) return ai;
  return mergeAIRecovery(base, ai);
}

/**
 * For image-only PDF files: process every page with the existing Gemini Vision
 * endpoint. Fail closed if any page fails; never silently publish partial exams.
 */
export async function recoverScannedPdf(
  file: File,
  pdf: import("pdfjs-dist").PDFDocumentProxy,
  base: ExtractionResult,
): Promise<ExtractionResult> {
  if (base.questions.length > 0 || typeof document === "undefined") return base;
  if (pdf.numPages > 25) {
    throw new Error("PDF scan có trên 25 trang. Hãy chia file để tránh vượt hạn mức AI.");
  }
  const { renderPdfPageToCanvas } = await import("@/utils/parsers/pdfParser");
  const questions: ExtractedQuestion[] = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const canvas = document.createElement("canvas");
    try {
      await renderPdfPageToCanvas(pdf, pageNo, canvas, 1.5);
      const imageBase64 = canvas.toDataURL("image/jpeg", 0.82);
      const parsed = await extractQuizWithAI({ file, imageBase64 });
      if (parsed.questions.length === 0) {
        throw new Error(`Trang ${pageNo} không có dữ liệu trích xuất.`);
      }
      for (const q of parsed.questions) {
        questions.push({
          ...q,
          order: questions.length + 1,
          id: `scan-${pageNo}-${q.id}`,
          warningFlags: [...(q.warningFlags || []), `PDF scan, trang ${pageNo}: cần đối chiếu câu hỏi gốc`],
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Lỗi không xác định";
      throw new Error(`Không thể đọc đủ PDF scan (trang ${pageNo}/${pdf.numPages}): ${reason}`);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  return {
    ...base,
    questions,
    totalQuestionsDetected: questions.length,
    warningsCount: questions.reduce((n, q) => n + (q.warningFlags?.length || 0), 0),
  };
}

/** Guard against silent loss of numbered questions from unfamiliar layouts. */
export function assertQuestionCoverage(text: string, result: ExtractionResult): void {
  const count = (text.match(/(?:^|\\n)\\s*(?:Câu|Question|Bài)\\s+\\d+\\s*[.：:)]/gmi) || []).length;
  if (count > result.questions.length) {
    throw new Error(`Phát hiện ${count} đầu mục câu hỏi nhưng chỉ bóc tách ${result.questions.length}. Vui lòng kiểm tra/nhập lại; không lưu đề thiếu câu.`);
  }
}
