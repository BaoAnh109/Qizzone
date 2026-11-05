import { create } from "zustand";
import { solveMissingAnswersWithAI } from "@/services/aiExtractionService";
import type {
  HybridInput,
  HybridOrchestrationResult,
} from "@/services/extraction/hybridOrchestrator";
import type { ReviewDisplayStatus } from "@/services/extraction/reviewDisplay";
import type { OptionId } from "@/types/quiz";
import type {
  ExtractedQuestion,
  ExtractionResult,
  UploadedExamDocument,
  DetectionStrategy,
} from "@/types/extractor";

/**
 * Bước 05: cờ "cần review" khi một câu không còn đáp án đúng nào.
 * Dùng đúng từ vựng warningFlags sẵn có của ExtractedQuestion; câu ở
 * trạng thái này đã bị validator bước 04 chặn xuất bản (missing_answer)
 * nên cờ này là tín hiệu hiển thị, không phải guard mới.
 */
const NO_ANSWER_FLAG = "Chưa có đáp án đúng";
const MANUAL_DRAFT_FLAG = "Câu hỏi nháp tạo thủ công";

interface ExtractionState {
  document: UploadedExamDocument | null;
  extractionResult: ExtractionResult | null;
  /**
   * Bước 21: metadata Hybrid Orchestrator của lần trích xuất gần nhất
   * (V2 + chunks + gate + evidence + aiNeeded). V1 gốc vẫn nằm ở
   * extractionResult và không bị metadata này sửa đổi — review UI cũ
   * đọc extractionResult như trước, UI bước 24 đọc hybridReview để
   * hiển thị chất lượng/bằng chứng. clearAll xóa cả hai.
   */
  hybridReview: HybridOrchestrationResult | null;
  /**
   * Bước 24: input gốc đã đưa vào orchestrateExtraction (documentQuality
   * / totalPages / scanPages của lần trích xuất gần nhất). Nút "AI lấp
   * đáp án" dùng metadata này + V1 hiện tại (đã gồm sửa tay) để gọi
   * orchestrateWithAI — không dùng V1 cũ trong input này để khỏi hoàn
   * tác sửa tay của giáo viên. clearAll xóa cùng hybridReview.
   */
  hybridInput: HybridInput | null;
  selectedQuestionId: string | null;
  isProcessing: boolean;
  processProgress: number; // 0 - 100
  splitterRatio: number; // 30 - 70 (%)
  filterStrategy: DetectionStrategy | "all" | "warnings";
  /**
   * Bước 23: lọc theo trạng thái hiển thị review (verified | likely |
   * needs_review | invalid, xem reviewDisplay.ts). Chỉ có tác dụng khi
   * có hybridReview; khi chưa có metadata thì bộ lọc này được bỏ qua
   * (không làm rỗng danh sách vì thiếu dữ liệu phân loại).
   */
  filterReviewStatus: ReviewDisplayStatus | "all";
  searchQuery: string;

  // Actions
  setDocument: (doc: UploadedExamDocument | null) => void;
  setExtractionResult: (res: ExtractionResult | null) => void;
  setHybridReview: (review: HybridOrchestrationResult | null) => void;
  setHybridInput: (input: HybridInput | null) => void;
  setSelectedQuestionId: (id: string | null) => void;
  setIsProcessing: (isProcessing: boolean, progress?: number) => void;
  setSplitterRatio: (ratio: number) => void;
  setFilterStrategy: (filter: DetectionStrategy | "all" | "warnings") => void;
  setFilterReviewStatus: (filter: ReviewDisplayStatus | "all") => void;
  setSearchQuery: (query: string) => void;

  // Question editing actions
  updateQuestion: (id: string, partial: Partial<ExtractedQuestion>) => void;
  setCorrectAnswer: (questionId: string, answer: OptionId) => void;
  toggleCorrectAnswer: (questionId: string, answer: OptionId) => void;
  deleteQuestion: (id: string) => void;
  addEmptyQuestion: () => void;

  // Batch actions
  autoBalancePoints: (totalPoints?: number) => void;
  applyBatchAnswerKey: (answerKeyString: string) => { updatedCount: number };
  solveUnansweredWithAI: (
    onStepProgress?: (current: number, total: number, message?: string) => void
  ) => Promise<{ solvedCount: number; durationSeconds: number; failureMessage?: string }>;
  clearAll: () => void;
}

export const useExtractionStore = create<ExtractionState>()((set) => ({
  document: null,
  extractionResult: null,
  hybridReview: null,
  hybridInput: null,
  selectedQuestionId: null,
  isProcessing: false,
  processProgress: 0,
  splitterRatio: 50,
  filterStrategy: "all",
  filterReviewStatus: "all",
  searchQuery: "",

  setDocument: (doc) => set({ document: doc }),
  setExtractionResult: (res) =>
    set({
      extractionResult: res,
      selectedQuestionId: res?.questions[0]?.id || null,
    }),
  setHybridReview: (review) => set({ hybridReview: review }),
  setHybridInput: (input) => set({ hybridInput: input }),
  setSelectedQuestionId: (id) => set({ selectedQuestionId: id }),
  setIsProcessing: (isProcessing, progress = 0) =>
    set({ isProcessing, processProgress: progress }),
  setSplitterRatio: (ratio) =>
    set({ splitterRatio: Math.min(80, Math.max(20, ratio)) }),
  setFilterStrategy: (filter) => set({ filterStrategy: filter }),
  setFilterReviewStatus: (filter) => set({ filterReviewStatus: filter }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  updateQuestion: (id, partial) => {
    set((state) => {
      if (!state.extractionResult) return state;
      const updated = state.extractionResult.questions.map((q) =>
        q.id === id ? { ...q, ...partial } : q
      );
      return {
        extractionResult: {
          ...state.extractionResult,
          questions: updated,
        },
      };
    });
  },

  setCorrectAnswer: (questionId, answer) => {
    set((state) => {
      if (!state.extractionResult) return state;
      const updated = state.extractionResult.questions.map((q) => {
        if (q.id === questionId) {
          return {
            ...q,
            correctAnswers: [answer],
            detectionStrategy: "manual" as DetectionStrategy,
            confidenceScore: 1.0,
            // Chọn đáp án chủ động thì cờ "chưa có đáp án" (nếu có
            // từ lần toggle rỗng trước đó) không còn đúng nữa.
            warningFlags: (q.warningFlags || []).filter(
              (f) => f !== NO_ANSWER_FLAG
            ),
          };
        }
        return q;
      });
      return {
        extractionResult: {
          ...state.extractionResult,
          questions: updated,
        },
      };
    });
  },

  toggleCorrectAnswer: (questionId, answer) => {
    set((state) => {
      if (!state.extractionResult) return state;
      const updated = state.extractionResult.questions.map((q) => {
        if (q.id === questionId) {
          const current = (q.correctAnswers || []) as OptionId[];
          const next: OptionId[] = current.includes(answer)
            ? current.filter((a) => a !== answer)
            : [...current, answer];
          // Bước 05: bỏ đáp án cuối thì câu về [] — KHÔNG rơi về
          // ["A"] như trước (đáp án giả). Câu ở trạng thái cần review:
          // cờ NO_ANSWER_FLAG + confidence 0; validator bước 04 chặn
          // xuất bản (missing_answer) cho tới khi giáo viên chọn lại.
          // Chọn lại đáp án thì cờ được gỡ, confidence về 1.0.
          const needsReview = next.length === 0;
          const flags = (q.warningFlags || []).filter(
            (f) => f !== NO_ANSWER_FLAG
          );
          if (needsReview) flags.push(NO_ANSWER_FLAG);
          return {
            ...q,
            correctAnswers: next,
            detectionStrategy: "manual" as DetectionStrategy,
            confidenceScore: needsReview ? 0 : 1.0,
            warningFlags: flags,
          };
        }
        return q;
      });
      return {
        extractionResult: {
          ...state.extractionResult,
          questions: updated,
        },
      };
    });
  },

  deleteQuestion: (id) => {
    set((state) => {
      if (!state.extractionResult) return state;
      const filtered = state.extractionResult.questions
        .filter((q) => q.id !== id)
        .map((q, idx) => ({ ...q, order: idx + 1 }));
      return {
        extractionResult: {
          ...state.extractionResult,
          totalQuestionsDetected: filtered.length,
          questions: filtered,
        },
        selectedQuestionId:
          state.selectedQuestionId === id
            ? filtered[0]?.id || null
            : state.selectedQuestionId,
      };
    });
  },

  addEmptyQuestion: () => {
    set((state) => {
      if (!state.extractionResult) return state;
      const newOrder = state.extractionResult.questions.length + 1;
      const newQuestion: ExtractedQuestion = {
        id: `q-ext-${newOrder}-${Date.now().toString(36)}`,
        tempId: `manual-${newOrder}`,
        order: newOrder,
        content: "Nhập nội dung câu hỏi mới tại đây...",
        options: [
          { id: "A", content: "Lựa chọn A", rawContent: "A. Lựa chọn A" },
          { id: "B", content: "Lựa chọn B", rawContent: "B. Lựa chọn B" },
          { id: "C", content: "Lựa chọn C", rawContent: "C. Lựa chọn C" },
          { id: "D", content: "Lựa chọn D", rawContent: "D. Lựa chọn D" },
        ],
        // Bước 05: tạo thủ công thì KHÔNG gán đáp án ["A"] giả.
        // Options placeholder chỉ là khung UI để giáo viên sửa, kèm
        // cờ manual_draft + correctAnswers [] + confidence 0: câu này
        // không phải câu trích xuất hợp lệ và không tự xuất bản được
        // (validator bước 04 chặn ở missing_answer). Toggle/chọn đáp
        // án sau đó không tự xóa isManualDraft — nội dung vẫn là nháp
        // cho tới khi giáo viên hoàn thiện (bước 08/25 quyết tiêu chí).
        correctAnswers: [],
        points: 1,
        confidenceScore: 0,
        detectionStrategy: "manual",
        isManualDraft: true,
        warningFlags: [MANUAL_DRAFT_FLAG, NO_ANSWER_FLAG],
        rawTextSegment: "Câu hỏi thêm mới thủ công",
      };

      const updated = [...state.extractionResult.questions, newQuestion];
      return {
        extractionResult: {
          ...state.extractionResult,
          totalQuestionsDetected: updated.length,
          questions: updated,
        },
        selectedQuestionId: newQuestion.id,
      };
    });
  },

  autoBalancePoints: (totalPoints = 10) => {
    set((state) => {
      if (!state.extractionResult) return state;
      const total = state.extractionResult.questions.length || 1;
      const pointsEach = total > 0 ? totalPoints / total : 1;
      const updated = state.extractionResult.questions.map((q) => ({
        ...q,
        points: pointsEach,
      }));
      return {
        extractionResult: {
          ...state.extractionResult,
          questions: updated,
        },
      };
    });
  },

  applyBatchAnswerKey: (answerKeyString) => {
    const regex = /(?:Câu\s*)?(\d+)[\s.:\-)_]*([A-D])\b/gi;
    let match: RegExpExecArray | null;
    const map: Record<number, OptionId> = {};

    while ((match = regex.exec(answerKeyString)) !== null) {
      const qNum = parseInt(match[1], 10);
      const ans = match[2].toUpperCase() as OptionId;
      if (qNum > 0 && ["A", "B", "C", "D"].includes(ans)) {
        map[qNum] = ans;
      }
    }

    let updatedCount = 0;
    set((state) => {
      if (!state.extractionResult) return state;
      const updated = state.extractionResult.questions.map((q) => {
        if (map[q.order]) {
          updatedCount++;
          return {
            ...q,
            correctAnswers: [map[q.order]],
            detectionStrategy: "answer_table" as DetectionStrategy,
            confidenceScore: 0.99,
          };
        }
        return q;
      });

      return {
        extractionResult: {
          ...state.extractionResult,
          questions: updated,
        },
      };
    });

    return { updatedCount };
  },

  solveUnansweredWithAI: async (onStepProgress) => {
    const { extractionResult, setIsProcessing } = useExtractionStore.getState();
    if (!extractionResult || extractionResult.questions.length === 0) {
      return { solvedCount: 0, durationSeconds: 0 };
    }

    setIsProcessing(true, 10);
    try {
      // Bước 17: đường gọi solving DUY NHẤT được phép — giáo viên bấm nút
      // giải trong UI review (opt-in tường minh). Không nơi nào khác được
      // gọi solveMissingAnswersWithAI mà không có optIn: true.
      const { updatedQuestions, solvedCount, durationSeconds, failureMessage } = await solveMissingAnswersWithAI(
        extractionResult.questions,
        (current, total, message) => {
          const progress = Math.round(10 + (current / total) * 85);
          setIsProcessing(true, progress);
          if (onStepProgress) {
            onStepProgress(current, total, message);
          }
        },
        { optIn: true },
      );

      set({
        extractionResult: {
          ...extractionResult,
          questions: updatedQuestions,
        },
        processProgress: 100,
      });

      return { solvedCount, durationSeconds, failureMessage };
    } finally {
      set({ isProcessing: false });
    }
  },

  clearAll: () =>
    set({
      document: null,
      extractionResult: null,
      hybridReview: null,
      hybridInput: null,
      selectedQuestionId: null,
      isProcessing: false,
      processProgress: 0,
      searchQuery: "",
    }),
}));

export default useExtractionStore;
