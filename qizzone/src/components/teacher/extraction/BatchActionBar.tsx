import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  PlusCircle,
  KeyRound,
  Calculator,
  Upload,
  Filter,
  Search,
  Sparkles,
  Clock,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useExtractionStore } from "@/store/extractionStore";
import { useQuizStore } from "@/store/quizStore";
import { useAuthStore } from "@/store/authStore";
import { useToast } from "@/hooks/useToast";
import { QuickAnswerKeyModal } from "./QuickAnswerKeyModal";
import {
  mapExtractedQuestionsToQuizQuestions,
  validateExtractedQuestions,
  getPublishBlockers,
} from "@/utils/extractedQuestionMapper";
import type { DetectionStrategy } from "@/types/extractor";
import {
  buildReviewDisplay,
  REVIEW_STATUS_LABELS,
  type ReviewDisplayStatus,
} from "@/services/extraction/reviewDisplay";
import { orchestrateWithAI } from "@/services/extraction/hybridOrchestrator";
import {
  assessPublishGuard,
  toPublishGuardSummary,
} from "@/services/extraction/publishGuard";
import {
  buildAiExtractParams,
  buildAiFillInput,
  shouldShowAiFillButton,
} from "@/services/extraction/aiFill";
import { extractQuizWithAI } from "@/services/aiExtractionService";

export function BatchActionBar() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { createQuiz } = useQuizStore();
  const toast = useToast();

  const {
    document,
    extractionResult,
    hybridReview,
    hybridInput,
    filterStrategy,
    filterReviewStatus,
    searchQuery,
    setFilterStrategy,
    setFilterReviewStatus,
    setSearchQuery,
    setExtractionResult,
    setHybridReview,
    autoBalancePoints,
    addEmptyQuestion,
    solveUnansweredWithAI,
    clearAll,
  } = useExtractionStore();

  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSolvingAI, setIsSolvingAI] = useState(false);
  const [isFillingAI, setIsFillingAI] = useState(false);
  const [solveElapsed, setSolveElapsed] = useState(0);
  const [solveStatusMessage, setSolveStatusMessage] = useState("");
  const timerIntervalRef = useRef<number | null>(null);

  const questions = extractionResult?.questions || [];
  const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);
  const totalWarnings = questions.reduce(
    (sum, q) => sum + (q.warningFlags?.length || 0),
    0
  );
  const unansweredCount = questions.filter(
    (q) => !q.correctAnswers || q.correctAnswers.length === 0
  ).length;

  // Bước 23: đếm theo trạng thái hiển thị để lọc câu flagged. Khi chưa
  // có hybridReview thì select bị disable (không có dữ liệu phân loại).
  const reviewSummary = useMemo(
    () => (hybridReview ? buildReviewDisplay(hybridReview).summary : null),
    [hybridReview]
  );

  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

  const handleSolveAI = async () => {
    if (unansweredCount === 0) {
      toast.info("Tất cả câu hỏi đều đã có đáp án!");
      return;
    }

    setIsSolvingAI(true);
    setSolveElapsed(0);
    setSolveStatusMessage(`Bắt đầu giải ${unansweredCount} câu...`);

    const startTime = Date.now();
    timerIntervalRef.current = window.setInterval(() => {
      setSolveElapsed((Date.now() - startTime) / 1000);
    }, 100);

    toast.info(`🤖 AI đang bắt đầu giải tự động ${unansweredCount} câu hỏi...`);

    try {
      const { solvedCount, durationSeconds, failureMessage } = await solveUnansweredWithAI(
        (_current, _total, message) => {
          if (message) {
            setSolveStatusMessage(message);
          }
        }
      );

      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }

      const totalTime = durationSeconds || Math.round(((Date.now() - startTime) / 1000) * 10) / 10;
      setSolveElapsed(totalTime);

      if (solvedCount > 0) {
        const message = solvedCount === unansweredCount
          ? `🎉 AI đã giải xong ${solvedCount}/${unansweredCount} câu hỏi trong ${totalTime}s!`
          : `AI đã giải được ${solvedCount}/${unansweredCount} câu trong ${totalTime}s. ${failureMessage || "Các câu còn lại cần thử lại."}`;
        if (solvedCount === unansweredCount) toast.success(message);
        else toast.warning(message);
      } else {
        toast.warning(failureMessage || "AI không trả về đáp án hợp lệ. Vui lòng thử lại!");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Quá trình AI giải câu hỏi gặp sự cố.");
    } finally {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      setIsSolvingAI(false);
    }
  };

  // Bước 24: nút "AI lấp đáp án còn thiếu" — EXTRACTION on-demand, khác
  // nút "AI Giải tự động" (solving opt-in, bước 17). Chỉ hiện khi còn
  // câu cần AI theo aiNeeded (bước 21); gọi orchestrateWithAI một lần:
  // chỉ lấp câu luật đang rỗng bằng đáp án AI có bằng chứng, không ghi
  // đè đáp án luật, không tự giải đề; vượt quota thì giữ luật kèm cảnh
  // báo (bước 20), không retry. Input dùng V1 hiện tại để không hoàn
  // tác sửa tay của giáo viên (xem aiFill.ts).
  const showAiFillButton = shouldShowAiFillButton(hybridReview);
  const aiNeededCount = hybridReview?.aiNeeded.questions.length ?? 0;

  const handleFillAI = async () => {
    if (!hybridReview || !extractionResult) return;
    const params = buildAiExtractParams(document);
    const input = buildAiFillInput(extractionResult, hybridInput);
    setIsFillingAI(true);
    try {
      const result = await orchestrateWithAI(
        input,
        params ? { aiExtract: () => extractQuizWithAI(params) } : null
      );
      // V1 sau hợp nhất (đáp án luật giữ nguyên, câu rỗng được lấp nếu
      // AI có bằng chứng) + metadata mới; store cập nhật cả hai để
      // review UI và progress panel phản ánh đúng trạng thái cuối.
      setExtractionResult(result.v1);
      setHybridReview(result);
      if (result.aiCalled) {
        if (result.aiFilledCount > 0) {
          toast.success(
            `AI đã lấp đáp án cho ${result.aiFilledCount} câu từ tài liệu gốc.`
          );
        } else {
          toast.info("AI không lấp thêm được câu nào từ tài liệu gốc.");
        }
      } else if (result.aiSkippedReason === "quota") {
        toast.warning("Đã vượt giới hạn gọi AI — giữ kết quả parser luật.");
      } else if (result.aiSkippedReason === "no-provider") {
        toast.warning(
          "Chưa có tài liệu gốc để AI đối chiếu — giữ kết quả parser luật."
        );
      } else if (result.aiSkippedReason === "error") {
        toast.error("Gọi AI thất bại — giữ kết quả parser luật.");
      } else {
        toast.info("Không còn câu nào cần AI lấp đáp án.");
      }
    } catch {
      toast.error("Lấp đáp án bằng AI gặp sự cố — giữ kết quả parser luật.");
    } finally {
      setIsFillingAI(false);
    }
  };

  const handleConfigureQuiz = () => {
    if (questions.length === 0) {
      toast.error("Đề thi chưa có câu hỏi nào để cấu hình");
      return;
    }
    const formattedQuestions = mapExtractedQuestionsToQuizQuestions(questions);
    // Câu thiếu đáp án giữ nguyên [] (không gán A ngầm); diagnostics đi
    // kèm để CreateQuiz hiển thị và chặn submit theo validation sẵn có.
    const mappingDiagnostics = validateExtractedQuestions(questions);
    // Bước 25: Configure không chặn (giáo viên còn sửa tiếp ở CreateQuiz),
    // nhưng cảnh báo vấn đề cấp tài liệu và truyền guard summary sang để
    // CreateQuiz chặn xuất bản theo docBlockers.
    const guard = extractionResult
      ? assessPublishGuard(extractionResult, hybridReview)
      : null;
    if (guard && guard.docBlockers.length > 0) {
      toast.warning(
        `Lưu ý: tài liệu có ${guard.docBlockers.length} vấn đề cấp tài liệu chưa xử lý (bóc tách thất bại/trang scan) — cần xử lý trước khi xuất bản, nhưng vẫn có thể cấu hình và sửa tiếp.`
      );
    }
    navigate("/teacher/create-quiz", {
      state: {
        initialQuestions: formattedQuestions,
        mappingDiagnostics,
        extractionGuard: guard ? toPublishGuardSummary(guard) : undefined,
        initialTitle: extractionResult?.title || "Đề thi bóc tách từ tài liệu",
        initialSubject: extractionResult?.subject || "Toán học 12",
        initialDescription: `Bóc tách tự động từ file ${extractionResult?.fileName || "tài liệu"}.`,
        initialStep: 3,
      },
    });
  };

  const handleFinalizeQuiz = async (status: "draft" | "published" = "published") => {
    if (questions.length === 0) {
      toast.error("Đề thi chưa có câu hỏi nào để lưu");
      return;
    }

    // Bước 25: guard nối hybridReview (gate/evidence/reconcile/chunk/type)
    // vào Finalize, trên nền diagnostics V1 bước 04 (guard đã bao gồm
    // chúng, tính lại từ câu live). Xuất bản thì chặn kèm lý do + hành
    // động từng vấn đề; lưu nháp thì cho qua kèm cảnh báo để giáo viên
    // hoàn thiện sau (nháp không phải đề thi cho học sinh làm).
    // Không có extractionResult thì không thể có câu hỏi (đã return ở
    // trên) — nhánh fallback giữ logic bước 04 phòng thủ.
    if (extractionResult) {
      const guard = assessPublishGuard(extractionResult, hybridReview);
      if (status === "published") {
        if (guard.publishBlocked) {
          const shown = guard.blockers
            .slice(0, 5)
            .map((b) => b.message)
            .join(" ");
          const more =
            guard.blockers.length > 5
              ? ` Và ${guard.blockers.length - 5} vấn đề khác.`
              : "";
          toast.error(
            `Không thể xuất bản: ${guard.blockers.length} vấn đề cần sửa. ${shown}${more} ` +
              `Hãy sửa ở màn review hoặc lưu bản nháp trước.`
          );
          return;
        }
      } else if (guard.draftWarnings.length > 0) {
        toast.warning(
          `Lưu nháp với ${guard.draftWarnings.length} vấn đề chưa đủ điều kiện xuất bản ` +
            `— cần sửa trước khi xuất bản. Vấn đề đầu tiên: ${guard.draftWarnings[0].message}`
        );
      }
    } else {
      const diagnostics = validateExtractedQuestions(questions);
      if (status === "published") {
        const blockers = getPublishBlockers(diagnostics);
        if (blockers.length > 0) {
          const shown = blockers
            .slice(0, 5)
            .map((d) => `câu ${d.order}`)
            .join(", ");
          const more = blockers.length > 5 ? ` và ${blockers.length - 5} vấn đề khác` : "";
          toast.error(
            `Không thể xuất bản: ${blockers.length} vấn đề cần sửa (${shown}${more}). ` +
              `Hãy chọn đáp án cho các câu thiếu hoặc lưu bản nháp trước.`
          );
          return;
        }
      } else if (diagnostics.length > 0) {
        toast.warning(
          `Lưu nháp với ${diagnostics.length} vấn đề chưa đủ điều kiện xuất bản ` +
            `(thiếu đáp án/phương án) — cần sửa trước khi xuất bản.`
        );
      }
    }

    setIsSubmitting(true);

    try {
      const formattedQuestions = mapExtractedQuestionsToQuizQuestions(questions);

      const newQuiz = await createQuiz({
        title: extractionResult?.title || "Đề thi bóc tách từ tài liệu",
        subject: extractionResult?.subject || "Toán học 12",
        description: `Bóc tách tự động từ file ${extractionResult?.fileName || "tài liệu"}.`,
        status,
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
        status === "published"
          ? `Đã xuất bản đề thi thành công! Mã phòng thi: ${newQuiz.code}`
          : "Đã lưu bản nháp đề thi thành công!"
      );
      clearAll();
      if (status === "published") {
        navigate(`/teacher/quiz/${newQuiz.id}/review`);
      } else {
        navigate("/teacher/quizzes");
      }
    } catch (error) {
      // Bước 08: hiện đúng thông điệp lỗi thay vì toast chung chung.
      // Trường hợp đã biết: nháp có câu chưa xác minh vẫn bị DB từ
      // chối (save_quiz bắt buộc đáp án 1–4 với mọi trạng thái) — khi
      // đó câu hỏi vẫn giữ nguyên ở màn review (clearAll chỉ chạy khi
      // lưu thành công), không mất dữ liệu, không bịa đáp án; việc nới
      // DB riêng cho draft thuộc migration sau, không tự sửa ở đây.
      toast.error(
        error instanceof Error
          ? error.message
          : status === "published"
            ? "Không thể xuất bản đề thi. Vui lòng thử lại!"
            : "Không thể lưu bản nháp đề thi. Vui lòng thử lại!"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4">
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
                <strong className="font-mono text-indigo-700">{Math.round(totalPoints * 100) / 100}đ</strong>
                {totalWarnings > 0 && (
                  <span className="text-amber-700 font-semibold ml-2">
                    · ⚠️ {totalWarnings} cảnh báo cần xem
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={clearAll}
              leftIcon={<Upload className="h-3.5 w-3.5" />}
            >
              Tải file khác
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => handleFinalizeQuiz("draft")}
              disabled={isSubmitting || questions.length === 0}
              leftIcon={<Save className="h-3.5 w-3.5 text-neutral-600" />}
            >
              Lưu bản nháp
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={handleConfigureQuiz}
              disabled={questions.length === 0}
              rightIcon={<ArrowRight className="h-4 w-4" />}
              className="font-bold bg-indigo-600 hover:bg-indigo-700 shadow-sm"
            >
              Chuyển sang cấu hình đề ({questions.length} câu)
            </Button>
          </div>
        </div>

        {/* Bottom Row: Batch Tools & Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Batch Tool Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {unansweredCount > 0 && (
              isSolvingAI ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={true}
                  leftIcon={<Sparkles className="h-3.5 w-3.5 text-violet-600 animate-spin" />}
                  className="text-xs font-bold border-violet-400 bg-violet-100 text-violet-950 ring-2 ring-violet-400/50 shadow-sm"
                >
                  <Clock className="h-3 w-3 mr-1 inline animate-pulse text-violet-700" />
                  <span>{solveElapsed.toFixed(1)}s: {solveStatusMessage || `Đang giải ${unansweredCount} câu...`}</span>
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSolveAI}
                  leftIcon={<Sparkles className="h-3.5 w-3.5 text-violet-600 animate-pulse" />}
                  className="text-xs font-bold border-violet-300 bg-violet-50 text-violet-900 hover:bg-violet-100 shadow-xs"
                >
                  ✨ AI Giải tự động ({unansweredCount} câu)
                </Button>
              )
            )}

            {/* Bước 24: lấp đáp án bằng AI (trích xuất từ tài liệu, không
                phải giải đề). Chỉ hiện khi còn câu cần AI; khác nút "AI
                Giải tự động" (solving) ở trên. */}
            {showAiFillButton && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleFillAI}
                disabled={isFillingAI}
                leftIcon={<Sparkles className="h-3.5 w-3.5 text-teal-600 animate-pulse" />}
                className="text-xs font-bold border-teal-300 bg-teal-50 text-teal-900 hover:bg-teal-100 shadow-xs"
                title="Chỉ lấp đáp án cho câu còn thiếu bằng nội dung có trong tài liệu gốc — không tự giải đề, không ghi đè đáp án đã có"
              >
                {isFillingAI
                  ? "AI đang lấp đáp án..."
                  : `AI lấp đáp án còn thiếu (${aiNeededCount} câu)`}
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => autoBalancePoints(10)}
              leftIcon={<Calculator className="h-3.5 w-3.5 text-indigo-600" />}
              className="text-xs font-semibold"
            >
              Chia đều 10 điểm ({questions.length > 0 ? Number((10 / questions.length).toFixed(3)) : 0}đ/câu)
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
                <option value="answer_at_end">Đáp án cuối câu</option>
                <option value="distinct_bold">In đậm</option>
                <option value="highlight_color">Tô màu / Chữ đỏ</option>
                <option value="special_marker">Ký hiệu *</option>
                <option value="ai_inference">AI Gợi ý tự giải</option>
                <option value="warnings">Cảnh báo ({totalWarnings})</option>
              </select>
            </div>

            {/* Bước 23: lọc theo trạng thái xác minh (mọi câu flagged đều
                lọc được). Disable khi chưa có hybridReview vì khi đó
                không có dữ liệu phân loại. */}
            <div className="flex items-center gap-1.5 bg-neutral-50 px-2.5 py-1 rounded-xl border border-neutral-200">
              <Filter className="h-3.5 w-3.5 text-neutral-500" />
              <span className="text-neutral-600 font-medium">Trạng thái:</span>
              <select
                value={filterReviewStatus}
                onChange={(e) =>
                  setFilterReviewStatus(
                    e.target.value as ReviewDisplayStatus | "all"
                  )
                }
                disabled={!reviewSummary}
                title={
                  reviewSummary
                    ? "Lọc câu hỏi theo trạng thái xác minh"
                    : "Cần kết quả trích xuất qua Hybrid Orchestrator mới lọc được theo trạng thái"
                }
                className="bg-transparent text-neutral-800 font-bold focus:outline-hidden cursor-pointer disabled:cursor-not-allowed disabled:text-neutral-400"
              >
                <option value="all">
                  Tất cả ({reviewSummary?.total ?? questions.length})
                </option>
                <option value="verified">
                  {REVIEW_STATUS_LABELS.verified} ({reviewSummary?.verified ?? 0})
                </option>
                <option value="likely">
                  {REVIEW_STATUS_LABELS.likely} ({reviewSummary?.likely ?? 0})
                </option>
                <option value="needs_review">
                  {REVIEW_STATUS_LABELS.needs_review} (
                  {reviewSummary?.needs_review ?? 0})
                </option>
                <option value="invalid">
                  {REVIEW_STATUS_LABELS.invalid} ({reviewSummary?.invalid ?? 0})
                </option>
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
