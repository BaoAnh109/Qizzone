import type { ExtractionResult, ExtractedQuestion, DetectionStrategy } from '@/types/extractor';
import type { OptionId } from '@/types/quiz';
import { edge, errorMessage } from '@/lib/cloud';
import { parseRawExamText } from '@/utils/parsers/ruleExtractor';
import { AI_CONFIG } from '@/config/aiConfig';

export interface AIExtractParams {
  file?: File;
  text?: string;
  imageBase64?: string;
}

interface RawSolutionItem {
  id?: string; order?: number | string; index?: number | string;
  correctAnswer?: string; answer?: string; correct_answer?: string; choice?: string;
  correctAnswers?: string[];
  explanation?: string; explain?: string; reason?: string;
}

interface AIQuestionPayload {
  order?: number; content?: string; type?: string; options?: Array<{ id?: string; content?: string }>;
  correctAnswers?: string[]; explanation?: string; confidenceScore?: number; detectionStrategy?: string;
}

const SYSTEM_PROMPT = `Bạn là chuyên gia bóc tách đề thi trắc nghiệm Việt Nam. Trả về JSON hợp lệ duy nhất.
Phải giữ đủ câu hỏi, nội dung phương án, đáp án đúng nếu có trong tài liệu hoặc suy luận được, lời giải và LaTeX.
Schema: {"title":string,"subject":string,"questions":[{"order":number,"content":string,"options":[{"id":"A|B|C|D","content":string}],"correctAnswers":["A"],"explanation":string,"confidenceScore":number,"detectionStrategy":"ai_inference"}]}`;

function cleanJson(value: string): string {
  return value.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
}

function parseAIResult(result: unknown, fileName: string, fileType: ExtractionResult['fileType'], size: number): ExtractionResult | null {
  if (!result || typeof result !== 'object') return null;
  const payload = result as { title?: string; subject?: string; questions?: AIQuestionPayload[] };
  if (!Array.isArray(payload.questions) || payload.questions.length === 0) return null;
  const questions: ExtractedQuestion[] = payload.questions.map((question, index) => {
    const options = (question.options || []).filter(option => ['A', 'B', 'C', 'D'].includes(option.id || '')).map(option => ({
      id: option.id as OptionId, content: option.content || '', rawContent: `${option.id}. ${option.content || ''}`,
    }));
    const answers = (question.correctAnswers || []).filter(answer => ['A', 'B', 'C', 'D'].includes(answer)) as OptionId[];
    return {
      id: `q-ai-${Date.now().toString(36)}-${index}`,
      tempId: `ai-${index + 1}`,
      order: question.order || index + 1,
      content: question.content || `Câu hỏi ${index + 1}`,
      options,
      correctAnswers: answers,
      explanation: question.explanation,
      points: payload.questions?.length ? 10 / payload.questions.length : 1,
      confidenceScore: typeof question.confidenceScore === 'number' ? question.confidenceScore : 0.9,
      detectionStrategy: (question.detectionStrategy || 'ai_inference') as DetectionStrategy,
      rawTextSegment: question.content || '',
      warningFlags: options.length < 2 || answers.length === 0 ? ['Cần kiểm tra đáp án'] : undefined,
    };
  });
  return {
    fileName, fileType, fileSize: size,
    title: payload.title || fileName.replace(/\.[^/.]+$/, '').replace(/_/g, ' '),
    subject: payload.subject || 'Toán học', totalQuestionsDetected: questions.length, questions,
    hasAnswerKeyTable: questions.some(question => question.correctAnswers.length > 0),
    warningsCount: questions.filter(question => question.warningFlags?.length).length,
    extractedAt: new Date().toISOString(),
  };
}

async function requestAI(prompt: string, imageBase64?: string, maxAttempts = 2): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await edge<{ result: unknown }>('extract-quiz-with-gemini', {
        prompt, imageBase64,
      }, 90_000);
      return response.result;
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
  const { file, text, imageBase64 } = params;
  const fileName = file?.name || (imageBase64 ? 'DeThi_AI.png' : 'DeThi_VanBan.txt');
  const fileType: ExtractionResult['fileType'] = imageBase64 ? 'image' : file?.name.toLowerCase().endsWith('.pdf') ? 'pdf' : file?.name.toLowerCase().endsWith('.docx') ? 'docx' : 'text';
  const source = text?.trim() ? `\nNội dung tài liệu:\n${text}` : '';
  if (imageBase64 || text?.trim()) {
    try {
      const result = parseAIResult(await requestAI(`${SYSTEM_PROMPT}\n${source}`, imageBase64), fileName, fileType, file?.size || text?.length || 0);
      if (result) return result;
    } catch {
      // Text still has a deterministic parser fallback; image will receive a useful error below.
    }
  }
  if (text?.trim()) return parseRawExamText(text, { fileName, fileType: 'text' });
  throw new Error('Không thể bóc tách ảnh. Kiểm tra đăng nhập, quyền giáo viên và cấu hình Gemini trên server.');
}

function solutionPrompt(batch: ExtractedQuestion[]): string {
  const questions = batch.map((question, index) => `[CÂU ${index + 1} | ORDER ${question.order} | ID ${question.id}]\n${question.content}\n${question.options.map(option => `${option.id}. ${option.content}`).join('\n')}`).join('\n\n---\n\n');
  return `Bạn là chuyên gia giải đề trắc nghiệm. Chọn đáp án đúng cho TẤT CẢ câu hỏi sau và trả về JSON duy nhất theo định dạng {"solutions":[{"id":string,"order":number,"correctAnswer":"A|B|C|D","explanation":string}]}.
Quy tắc:
- correctAnswer: Bắt buộc chọn đúng một trong bốn chữ cái A, B, C, D.
- explanation: Giải thích ngắn gọn 1-2 câu lý do chọn đáp án để tiết kiệm thời gian.
- Bắt buộc trả về đầy đủ đáp án cho tất cả câu hỏi dưới đây.
${questions}`;
}

export async function solveMissingAnswersWithAI(
  questions: ExtractedQuestion[],
  onProgress?: (current: number, total: number, message?: string) => void,
): Promise<{ updatedQuestions: ExtractedQuestion[]; solvedCount: number; durationSeconds: number; failureMessage?: string }> {
  const start = performance.now();
  const unanswered = questions.filter(question => !question.correctAnswers?.length);
  if (unanswered.length === 0) return { updatedQuestions: questions, solvedCount: 0, durationSeconds: 0 };
  const solutions = new Map<string, { answer: OptionId; explanation: string }>();
  let failureMessage: string | undefined;

  // Adaptive batching: Processing in small chunks (10-15 questions) ensures fast inference (2-4s),
  // avoids Gemini 503 overload and gateway timeouts, and provides continuous progress feedback.
  const batchSize = AI_CONFIG.BATCH_SIZE || 12;
  const totalBatches = Math.ceil(unanswered.length / batchSize);

  onProgress?.(0, unanswered.length, `Đang kết nối AI giải ${unanswered.length} câu (${totalBatches} đợt)...`);

  for (let offset = 0; offset < unanswered.length; offset += batchSize) {
    const batch = unanswered.slice(offset, offset + batchSize);
    const batchIndex = Math.floor(offset / batchSize) + 1;
    const progressText = `Đang giải câu ${offset + 1} - ${Math.min(offset + batch.length, unanswered.length)} / ${unanswered.length} (Đợt ${batchIndex}/${totalBatches})...`;
    onProgress?.(offset, unanswered.length, progressText);

    try {
      const result = await requestAI(solutionPrompt(batch));
      const payload = typeof result === 'string' ? JSON.parse(cleanJson(result)) : result;
      const list = Array.isArray(payload) ? payload : (payload as { solutions?: RawSolutionItem[] })?.solutions || [];
      list.forEach((item: RawSolutionItem, index: number) => {
        const answer = String(item.correctAnswer || item.answer || item.correct_answer || item.choice || item.correctAnswers?.[0] || '').toUpperCase() as OptionId;
        if (!['A', 'B', 'C', 'D'].includes(answer)) return;
        const byId = item.id && batch.find(question => question.id === item.id);
        const byOrder = batch.find(question => question.order === Number(item.order));
        const target = byId || byOrder || batch[index];
        if (target) {
          solutions.set(target.id, {
            answer,
            explanation: item.explanation || item.explain || item.reason || 'AI phân tích đáp án.',
          });
        }
      });
    } catch (error) {
      // Keep previously solved questions so user gets partial progress instead of losing everything
      failureMessage = errorMessage(error);
      console.warn(`[solveMissingAnswersWithAI] Đợt ${batchIndex}/${totalBatches} gặp lỗi:`, error);
    }

    const processedSoFar = Math.min(offset + batch.length, unanswered.length);
    onProgress?.(processedSoFar, unanswered.length, `Đã xử lý ${processedSoFar}/${unanswered.length} câu...`);

    // Polite delay between batches to respect Gemini rate limits
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
      confidenceScore: 0.96,
      warningFlags: (question.warningFlags || []).filter(flag => !flag.includes('Chưa có đáp án')),
    };
  });
  const durationSeconds = Math.round((performance.now() - start) / 100) / 10;
  onProgress?.(unanswered.length, unanswered.length, `Hoàn thành giải ${solvedCount}/${unanswered.length} câu trong ${durationSeconds}s`);
  return { updatedQuestions, solvedCount, durationSeconds, failureMessage };
}

