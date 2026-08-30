import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  PlusCircle,
  KeyRound,
  Calculator,
  Upload,
  CheckCircle2,
  Filter,
  Search,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useExtractionStore } from "@/store/extractionStore";
import { useQuizStore } from "@/store/quizStore";
import { useAuthStore } from "@/store/authStore";
import { useToast } from "@/hooks/useToast";
import { QuickAnswerKeyModal } from "./QuickAnswerKeyModal";
import type { DetectionStrategy } from "@/types/extractor";
import type { Question } from "@/types/quiz";

export function BatchActionBar() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { createQuiz } = useQuizStore();
  const toast = useToast();

  const {
    extractionResult,
    filterStrategy,
    searchQuery,
    setFilterStrategy,
    setSearchQuery,
    autoBalancePoints,
    addEmptyQuestion,
    solveUnansweredWithAI,
    clearAll,
  } = useExtractionStore();

  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSolvingAI, setIsSolvingAI] = useState(false);

  const questions = extractionResult?.questions || [];
  const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);
  const totalWarnings = questions.reduce(
    (sum, q) => sum + (q.warningFlags?.length || 0),
    0
  );
  const unansweredCount = questions.filter(
    (q) => !q.correctAnswers || q.correctAnswers.length === 0
  ).length;

  const handleSolveAI = async () => {
    if (unansweredCount === 0) {
      toast.info("Tất cả câu hỏi đều đã có đáp án!");
      return;
    }
    setIsSolvingAI(true);
    toast.info(`AI đang suy luận và giải ${unansweredCount} câu hỏi...`);
    try {
      const { solvedCount } = await solveUnansweredWithAI();
      if (solvedCount > 0) {
        toast.success(`AI đã giải xong và điền đáp án cho ${solvedCount} câu hỏi!`);
      } else {
        toast.warning("Chưa cấu hình API Key Gemini hoặc không thể kết nối.");
      }
    } catch {
      toast.error("Quá trình AI giải câu hỏi gặp lỗi.");
    } finally {
      setIsSolvingAI(false);
    }
  };

  const handleFinalizeQuiz = () => {
    if (questions.length === 0) {
      toast.error("Đề thi chưa có câu hỏi nào để xuất bản");
      return;
    }

    setIsSubmitting(true);

    try {
      const formattedQuestions: Question[] = questions.map((q, idx) => ({
        id: `q-ext-${Date.now().toString(36)}-${idx}`,
        order: idx + 1,
        content: q.content,
        type: "single_choice",
        options: q.options.map((opt) => ({
          id: opt.id,
          content: opt.content,
        })),
        correctAnswers: q.correctAnswers,
        explanation: q.explanation,
        points: q.points,
      }));

      const newQuiz = createQuiz({
        title: extractionResult?.title || "Đề thi bóc tách từ tài liệu",
        subject: extractionResult?.subject || "Toán học",
        description: `Bóc tách tự động từ file ${extractionResult?.fileName || "tài liệu"}.`,
        status: "published",
        teacherId: user?.id || "teacher-1",
        teacherName: user?.name || user?.fullName || "Thầy Cô",
        settings: {
          durationMinutes: 45,
          shuffleQuestions: false,
          shuffleOptions: true,
          allowReview: true,
          maxAttempts: 0,
          passPercentage: 50,
        },
        questions: formattedQuestions,
      });

      toast.success(
        `Đã xuất bản đề thi thành công! Mã phòng thi: ${newQuiz.code}`
      );
      clearAll();
      navigate(`/teacher/quiz/${newQuiz.id}/review`);
    } catch {
      toast.error("Không thể xuất bản đề thi. Vui lòng thử lại!");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-4 bg-white p-4 rounded-2xl border border-neutral-200/90 shadow-xs">
        {/* Top Row: Navigation and Main CTA */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-neutral-100 pb-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                clearAll();
                navigate("/teacher/quizzes");
              }}
              leftIcon={<ArrowLeft className="h-4 w-4" />}
            >
              Danh sách đề
            </Button>
            <span className="text-neutral-300">|</span>
            <div>
              <h2 className="text-base sm:text-lg font-extrabold text-neutral-900 truncate">
                {extractionResult?.title || "Bóc tách đề thi thông minh"}
              </h2>
              <p className="text-xs text-neutral-500">
                Tổng số: <strong>{questions.length} câu</strong> · Tổng điểm:{" "}
                <strong className="font-mono text-indigo-700">{totalPoints.toFixed(1)}đ</strong>
                {totalWarnings > 0 && (
                  <span className="text-amber-700 font-semibold ml-2">
                    · ⚠️ {totalWarnings} cảnh báo cần xem
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={clearAll}
              leftIcon={<Upload className="h-3.5 w-3.5" />}
            >
              Tải file khác
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={handleFinalizeQuiz}
              disabled={isSubmitting || questions.length === 0}
              leftIcon={<CheckCircle2 className="h-4 w-4" />}
              className="font-bold bg-indigo-600 hover:bg-indigo-700 shadow-sm"
            >
              Xuất bản đề thi ({questions.length} câu)
            </Button>
          </div>
        </div>

        {/* Bottom Row: Batch Tools & Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Batch Tool Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {unansweredCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSolveAI}
                disabled={isSolvingAI}
                leftIcon={<Sparkles className="h-3.5 w-3.5 text-violet-600 animate-pulse" />}
                className="text-xs font-bold border-violet-300 bg-violet-50 text-violet-900 hover:bg-violet-100 shadow-xs"
              >
                {isSolvingAI ? "AI đang giải..." : `✨ AI Giải tự động (${unansweredCount} câu)`}
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => autoBalancePoints(10)}
              leftIcon={<Calculator className="h-3.5 w-3.5 text-indigo-600" />}
              className="text-xs font-semibold"
            >
              Chia đều 10 điểm ({questions.length > 0 ? (10 / questions.length).toFixed(2) : 0}đ/câu)
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsKeyModalOpen(true)}
              leftIcon={<KeyRound className="h-3.5 w-3.5 text-emerald-600" />}
              className="text-xs font-semibold"
            >
              Nhập bảng đáp án nhanh
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={addEmptyQuestion}
              leftIcon={<PlusCircle className="h-3.5 w-3.5" />}
              className="text-xs text-indigo-600 font-semibold"
            >
              Thêm câu hỏi
            </Button>
          </div>

          {/* Filter & Search */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 bg-neutral-50 px-2.5 py-1 rounded-xl border border-neutral-200">
              <Filter className="h-3.5 w-3.5 text-neutral-500" />
              <span className="text-neutral-600 font-medium">Nguồn:</span>
              <select
                value={filterStrategy}
                onChange={(e) =>
                  setFilterStrategy(
                    e.target.value as DetectionStrategy | "all" | "warnings"
                  )
                }
                className="bg-transparent text-neutral-800 font-bold focus:outline-hidden cursor-pointer"
              >
                <option value="all">Tất cả ({questions.length})</option>
                <option value="underline">Gạch chân</option>
                <option value="answer_table">Bảng đáp án</option>
                <option value="distinct_bold">In đậm</option>
                <option value="highlight_color">Tô màu / Chữ đỏ</option>
                <option value="special_marker">Ký hiệu *</option>
                <option value="ai_inference">AI Gợi ý tự giải</option>
                <option value="warnings">Cảnh báo ({totalWarnings})</option>
              </select>
            </div>

            <div className="w-44">
              <Input
                placeholder="Tìm kiếm câu hỏi..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                leftIcon={<Search className="h-3.5 w-3.5" />}
              />
            </div>
          </div>
        </div>
      </div>

      <QuickAnswerKeyModal
        isOpen={isKeyModalOpen}
        onClose={() => setIsKeyModalOpen(false)}
      />
    </>
  );
}

export default BatchActionBar;
