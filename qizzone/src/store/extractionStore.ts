import { create } from "zustand";
import type { OptionId } from "@/types/quiz";
import type {
  ExtractedQuestion,
  ExtractionResult,
  UploadedExamDocument,
  DetectionStrategy,
} from "@/types/extractor";

interface ExtractionState {
  document: UploadedExamDocument | null;
  extractionResult: ExtractionResult | null;
  selectedQuestionId: string | null;
  isProcessing: boolean;
  processProgress: number; // 0 - 100
  splitterRatio: number; // 30 - 70 (%)
  filterStrategy: DetectionStrategy | "all" | "warnings";
  searchQuery: string;

  // Actions
  setDocument: (doc: UploadedExamDocument | null) => void;
  setExtractionResult: (res: ExtractionResult | null) => void;
  setSelectedQuestionId: (id: string | null) => void;
  setIsProcessing: (isProcessing: boolean, progress?: number) => void;
  setSplitterRatio: (ratio: number) => void;
  setFilterStrategy: (filter: DetectionStrategy | "all" | "warnings") => void;
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
  solveUnansweredWithAI: (apiKeyInput?: string) => Promise<{ solvedCount: number }>;
  clearAll: () => void;
}

export const useExtractionStore = create<ExtractionState>()((set) => ({
  document: null,
  extractionResult: null,
  selectedQuestionId: null,
  isProcessing: false,
  processProgress: 0,
  splitterRatio: 50,
  filterStrategy: "all",
  searchQuery: "",

  setDocument: (doc) => set({ document: doc }),
  setExtractionResult: (res) =>
    set({
      extractionResult: res,
      selectedQuestionId: res?.questions[0]?.id || null,
    }),
  setSelectedQuestionId: (id) => set({ selectedQuestionId: id }),
  setIsProcessing: (isProcessing, progress = 0) =>
    set({ isProcessing, processProgress: progress }),
  setSplitterRatio: (ratio) =>
    set({ splitterRatio: Math.min(80, Math.max(20, ratio)) }),
  setFilterStrategy: (filter) => set({ filterStrategy: filter }),
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
          return {
            ...q,
            correctAnswers: next.length > 0 ? next : [("A" as OptionId)],
            detectionStrategy: "manual" as DetectionStrategy,
            confidenceScore: 1.0,
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
        correctAnswers: ["A"],
        points: 1,
        confidenceScore: 1.0,
        detectionStrategy: "manual",
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
      const pointsEach = Math.round((totalPoints / total) * 100) / 100;
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

  solveUnansweredWithAI: async (apiKeyInput) => {
    const { extractionResult, setIsProcessing } = useExtractionStore.getState();
    if (!extractionResult || extractionResult.questions.length === 0) {
      return { solvedCount: 0 };
    }

    setIsProcessing(true, 10);
    const { solveMissingAnswersWithAI } = await import("@/services/aiExtractionService");
    
    const { updatedQuestions, solvedCount } = await solveMissingAnswersWithAI(
      extractionResult.questions,
      apiKeyInput,
      (current, total) => {
        const progress = Math.round(10 + (current / total) * 85);
        setIsProcessing(true, progress);
      }
    );

    set({
      extractionResult: {
        ...extractionResult,
        questions: updatedQuestions,
      },
      isProcessing: false,
      processProgress: 100,
    });

    return { solvedCount };
  },

  clearAll: () =>
    set({
      document: null,
      extractionResult: null,
      selectedQuestionId: null,
      isProcessing: false,
      processProgress: 0,
      searchQuery: "",
    }),
}));

export default useExtractionStore;
