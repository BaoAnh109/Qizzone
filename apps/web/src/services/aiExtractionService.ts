import type {
  AiJobStatusResponse,
  DetectionStrategy,
  ExtractQuizResponse,
  ExtractedQuestion,
  ExtractionResult,
  OptionId,
} from '@qizzone/domain';
import { OPTION_IDS } from '@qizzone/domain';
import {
  GROUNDED_EXTRACTION_SYSTEM_PROMPT,
  MAX_AI_FALLBACK_SOURCE_CHARS,
  isCompleteSequentialNativeParse,
  mergeExtractionResults,
  mergeGroundedWithNative,
  parseGroundedAIResult,
  parseRawExamText,
  shouldUseAIExtractionFallback,
} from '@qizzone/document-parser';
import { edge, edgeGet, errorMessage } from '@/lib/cloud';
import { AI_CONFIG } from '@/config/aiConfig';

export {
  MAX_AI_FALLBACK_SOURCE_CHARS,
  shouldUseAIExtractionFallback,
  mergeExtractionResults,
  parseGroundedAIResult,
};

export interface AIExtractParams {
  file?: File;
  text?: string;
  imageBase64?: string;
  materialId?: string;
  selectedPages?: number[];
}

interface RawSolutionItem {
  id?: string;
  order?: number | string;
  index?: number | string;
  correctAnswer?: string;
  answer?: string;
  correct_answer?: string;
  choice?: string;
  correctAnswers?: string[];
  explanation?: string;
  explain?: string;
  reason?: string;
}

function cleanJson(value: string): string {
  return value.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
}

async function pollAiJob(jobId: string, timeoutMs = 120_000): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await edgeGet<AiJobStatusResponse>(
      `ai-job-status?id=${encodeURIComponent(jobId)}`,
      15_000,
    );
    if (job.status === 'completed') return job.resultDraft;
    if (job.status === 'failed') {
      throw new Error(`Tác vụ AI thất bại (${job.errorCode || 'ai_job_failed'}).`);
    }
    await new Promise(resolve => setTimeout(resolve, 1_200));
  }
  throw new Error('Tác vụ AI đang xử lý lâu hơn dự kiến. Vui lòng thử lại sau.');
}

async function requestAI(
  prompt: string,
  options: {
    imageBase64?: string;
    materialId?: string;
    selectedPages?: number[];
    extractionMode?: 'structural_fallback' | 'scan_ocr_vlm' | 'solve_missing_answers';
    maxAttempts?: number;
  } = {},
): Promise<unknown> {
  const {
    imageBase64,
    materialId,
    selectedPages,
    extractionMode = 'structural_fallback',
    maxAttempts = 1,
  } = options;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await edge<ExtractQuizResponse | { result: unknown }>(
        'extract-quiz',
        {
          prompt,
          imageBase64,
          materialId,
          selectedPages,
          extractionMode,
        },
        90_000,
      );
      if ('jobId' in response && response.jobId) {
        if (response.status === 'completed' && response.result !== undefined) {
          return response.result;
        }
        if (response.status === 'failed') {
          throw new Error('Không thể xử lý yêu cầu trích xuất AI.');
        }
        return await pollAiJob(response.jobId);
      }
      return (response as { result: unknown }).result;
    } catch (err) {
      lastErr = err;
      const msg = errorMessage(err);
      const isTransient = /quá tải|thử lại|timeout|503|504|429|network|fetch/i.test(msg);
      if (!isTransient || attempt === maxAttempts - 1) {
        throw err;
      }
      const delay = 1200 * (attempt + 1) + Math.random() * 400;
      await new Promise(res => setTimeout(res, delay));
    }
  }
  throw lastErr;
}

export async function extractQuizWithAI(params: AIExtractParams): Promise<ExtractionResult> {
  const { file, text, imageBase64, materialId, selectedPages } = params;
  const fileName = file?.name || (imageBase64 ? 'DeThi_AI.png' : 'DeThi_VanBan.txt');
  const fileType: ExtractionResult['fileType'] = imageBase64
    ? 'image'
    : file?.name.toLowerCase().endsWith('.pdf')
      ? 'pdf'
      : file?.name.toLowerCase().endsWith('.docx')
        ? 'docx'
        : 'text';
  const source = text?.trim() ? `\nNội dung tài liệu:\n${text}` : '';

  // Parser-first: structured text never needs an LLM call.
  if (text?.trim()) {
    const parsed = parseRawExamText(text, { fileName, fileType });
    if (isCompleteSequentialNativeParse(text, parsed)) {
      return parsed;
    }
  }

  if (materialId || (text?.trim() && text.length <= MAX_AI_FALLBACK_SOURCE_CHARS)) {
    try {
      const prompt = [GROUNDED_EXTRACTION_SYSTEM_PROMPT, source].filter(Boolean).join('\n');
      const aiRaw = await requestAI(prompt, {
        imageBase64,
        materialId,
        selectedPages,
        extractionMode: materialId && !text?.trim() ? 'scan_ocr_vlm' : 'structural_fallback',
      });
      const result = parseGroundedAIResult(
        aiRaw,
        fileName,
        fileType,
        file?.size || text?.length || 0,
        text || '',
      );
      if (result) {
        return text?.trim() ? mergeGroundedWithNative(result, text, fileName, fileType) : result;
      }
    } catch {
      // Deterministic parser remains the safe fallback below when text is available.
    }
  }

  if (text?.trim()) return parseRawExamText(text, { fileName, fileType });
  throw new Error(
    'Không thể tự động phân tích ảnh/tệp này vì thiếu văn bản nguồn để đối chiếu chứng cứ. Vui lòng dùng OCR hoặc nhập trực tiếp.',
  );
}

function solutionPrompt(batch: ExtractedQuestion[]): string {
  const questions = batch
    .map(
      (question, index) =>
        `[CÂU ${index + 1} | ORDER ${question.order} | ID ${question.id}]\n${question.content}\n${question.options
          .map(option => `${option.id}. ${option.content}`)
          .join('\n')}`,
    )
    .join('\n\n---\n\n');
  return `Bạn là chuyên gia giải đề trắc nghiệm. Chọn đáp án đúng cho TẤT CẢ câu hỏi sau và trả về JSON duy nhất theo định dạng {"solutions":[{"id":string,"order":number,"correctAnswer":"A|B|C|D|E","explanation":string}]}.
Quy tắc:
- correctAnswer: Bắt buộc chọn đúng một trong các chữ cái A, B, C, D, E có trong phương án.
- explanation: Giải thích ngắn gọn 1-2 câu lý do chọn đáp án để tiết kiệm thời gian.
- Bắt buộc trả về đầy đủ đáp án cho tất cả câu hỏi dưới đây.
${questions}`;
}

export async function solveMissingAnswersWithAI(
  questions: ExtractedQuestion[],
  onProgress?: (current: number, total: number, message?: string) => void,
): Promise<{
  updatedQuestions: ExtractedQuestion[];
  solvedCount: number;
  durationSeconds: number;
  failureMessage?: string;
}> {
  const start = performance.now();
  const unanswered = questions.filter(question => !question.correctAnswers?.length);
  if (unanswered.length === 0) return { updatedQuestions: questions, solvedCount: 0, durationSeconds: 0 };
  const solutions = new Map<string, { answer: OptionId; explanation: string }>();
  let failureMessage: string | undefined;

  const batchSize = AI_CONFIG.BATCH_SIZE || 12;
  const totalBatches = Math.ceil(unanswered.length / batchSize);

  onProgress?.(0, unanswered.length, `Đang kết nối AI giải ${unanswered.length} câu (${totalBatches} đợt)...`);

  for (let offset = 0; offset < unanswered.length; offset += batchSize) {
    const batch = unanswered.slice(offset, offset + batchSize);
    const batchIndex = Math.floor(offset / batchSize) + 1;
    const progressText = `Đang giải câu ${offset + 1} - ${Math.min(offset + batch.length, unanswered.length)} / ${unanswered.length} (Đợt ${batchIndex}/${totalBatches})...`;
    onProgress?.(offset, unanswered.length, progressText);

    try {
      const result = await requestAI(solutionPrompt(batch), {
        extractionMode: 'solve_missing_answers',
      });
      const payload = typeof result === 'string' ? JSON.parse(cleanJson(result)) : result;
      const list = Array.isArray(payload)
        ? payload
        : (payload as { solutions?: RawSolutionItem[] })?.solutions || [];
      list.forEach((item: RawSolutionItem, index: number) => {
        const answer = String(
          item.correctAnswer ||
            item.answer ||
            item.correct_answer ||
            item.choice ||
            item.correctAnswers?.[0] ||
            '',
        ).toUpperCase() as OptionId;
        if (!OPTION_IDS.includes(answer)) return;
        const byId = item.id && batch.find(question => question.id === item.id);
        const byOrder = batch.find(question => question.order === Number(item.order));
        const target = byId || byOrder || batch[index];
        if (target) {
          solutions.set(target.id, {
            answer,
            explanation: item.explanation || item.explain || item.reason || 'AI gợi ý đáp án (cần giáo viên duyệt).',
          });
        }
      });
    } catch (error) {
      failureMessage = errorMessage(error);
      console.warn(`[solveMissingAnswersWithAI] Đợt ${batchIndex}/${totalBatches} gặp lỗi:`, error);
    }

    const processedSoFar = Math.min(offset + batch.length, unanswered.length);
    onProgress?.(processedSoFar, unanswered.length, `Đã xử lý ${processedSoFar}/${unanswered.length} câu...`);

    if (offset + batchSize < unanswered.length) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  let solvedCount = 0;
  const updatedQuestions = questions.map(question => {
    const solution = solutions.get(question.id);
    if (!solution) return question;
    solvedCount++;
    return {
      ...question,
      correctAnswers: [solution.answer],
      explanation: solution.explanation,
      detectionStrategy: 'ai_inference' as DetectionStrategy,
      reviewStatus: 'pending' as const,
      confidenceScore: 0.96,
      warningFlags: (question.warningFlags || []).filter(flag => !flag.includes('Chưa có đáp án')),
    };
  });
  const durationSeconds = Math.round((performance.now() - start) / 100) / 10;
  onProgress?.(unanswered.length, unanswered.length, `Hoàn thành giải ${solvedCount}/${unanswered.length} câu trong ${durationSeconds}s`);
  return { updatedQuestions, solvedCount, durationSeconds, failureMessage };
}
