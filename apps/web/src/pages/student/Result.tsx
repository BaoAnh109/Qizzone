import { useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  Home,
  Award,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Clock,
  ListChecks,
  Lock,
  RotateCcw,
  Search,
  Flag,
} from "lucide-react";
import { useExamSessionStore } from "@/store/examSessionStore";
import { useQuizStore } from "@/store/quizStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MathRenderer } from "@/components/common/MathRenderer";
import type { OptionItem } from "@/types/quiz";

export function Result() {
  const navigate = useNavigate();
  const { resultId } = useParams();
  const { getResultById, results, getResultsByStudent } = useExamSessionStore();
  const getQuizById = useQuizStore((state) => state.getQuizById);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "correct" | "incorrect" | "skipped" | "flagged">("all");

  const result = (resultId ? getResultById(resultId) : undefined) || results[0];
  const quiz = result ? getQuizById(result.quizId) : undefined;

  const flaggedSet = useMemo(() => new Set(result?.flaggedQuestionIds || []), [result?.flaggedQuestionIds]);

  const filteredDetails = useMemo(() => {
    if (!result?.details) return [];
    return result.details.filter((item, idx) => {
      const isSkipped = item.selectedAnswers.length === 0;
      const isFlagged = flaggedSet.has(item.questionId);

      if (filterTab === "correct" && !item.isCorrect) return false;
      if (filterTab === "incorrect" && (item.isCorrect || isSkipped)) return false;
      if (filterTab === "skipped" && !isSkipped) return false;
      if (filterTab === "flagged" && !isFlagged) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const orderStr = `${item.order || idx + 1}`;
        const matchesOrder = `câu ${orderStr}`.includes(q) || orderStr === q;
        const matchesContent = item.content.toLowerCase().includes(q);
        const matchesExplanation = (item.explanation || "").toLowerCase().includes(q);
        if (!matchesOrder && !matchesContent && !matchesExplanation) return false;
      }

      return true;
    });
  }, [result, filterTab, searchQuery, flaggedSet]);

  if (!result) {
    return (
      <div className="max-w-md mx-auto my-16 text-center space-y-4">
        <h2 className="text-xl font-bold theme-text-primary">
          Chưa tìm thấy kết quả bài thi
        </h2>
        <Button variant="primary" onClick={() => navigate("/student")}>
          Quay lại sảnh học sinh
        </Button>
      </div>
    );
  }

  const allowReview = quiz?.settings?.allowReview !== false;
  const attemptsMade = getResultsByStudent(result.studentId).filter(
    (r) => r.quizId === result.quizId
  ).length;
  const maxAttempts = quiz?.settings?.maxAttempts || 0; // 0 = unlimited
  const canRetake = maxAttempts === 0 || attemptsMade < maxAttempts;

  const formatTimeSpent = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins} phút ${secs < 10 ? "0" : ""}${secs} giây`;
  };

  const getRankBadgeVariant = (rank?: string) => {
    switch (rank) {
      case "Xuất sắc":
        return "primary";
      case "Giỏi":
        return "success";
      case "Khá":
        return "secondary";
      case "Trung bình":
        return "warning";
      case "Yếu":
      default:
        return "destructive";
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-8 pb-16">
      {/* Top Banner */}
      <div className="text-center space-y-3 pt-4">
        <div
          className={`inline-flex h-16 w-16 items-center justify-center rounded-lg ${
            result.isPassed
              ? "bg-emerald-100 text-emerald-600"
              : "bg-amber-100 text-amber-600"
          }`}
        >
          <Award className="h-10 w-10" />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Badge variant={result.isPassed ? "success" : "destructive"} size="md" dot>
              {result.isPassed ? "Đạt yêu cầu (Passed)" : "Chưa đạt yêu cầu"}
            </Badge>
            {result.academicRank && (
              <Badge variant={getRankBadgeVariant(result.academicRank)} size="md">
                Xếp loại: {result.academicRank}
              </Badge>
            )}
          </div>
          <h1 className="page-heading mt-2">
            Kết quả bài thi: {result.quizTitle}
          </h1>
          <p className="text-xs theme-text-muted mt-1">
            Thí sinh: <strong>{result.studentName}</strong> · Mã phòng:{" "}
            <span className="font-mono text-teal-700 font-bold">{result.roomCode}</span> ·{" "}
            {new Date(result.submittedAt).toLocaleString("vi-VN")}
          </p>
        </div>
      </div>

      {/* Score Summary Card */}
      <Card className="text-center overflow-hidden theme-border shadow-sm">
        <CardContent className="p-6 sm:p-8 space-y-6">
          <div className="space-y-1">
            <span className="text-xs font-semibold theme-text-muted uppercase tracking-widest">
              Điểm số tổng kết
            </span>
            <div
              className={`text-5xl font-black tracking-tight font-mono ${
                result.isPassed ? "text-teal-700" : "text-amber-600"
              }`}
            >
              {result.score.toFixed(2)}{" "}
              <span className="text-xl font-normal theme-text-muted">/ 10</span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t theme-border">
            <div className="rounded-xl bg-emerald-50/80 p-3.5 border border-emerald-100">
              <span className="text-xs text-emerald-700 font-medium">Số câu đúng</span>
              <p className="text-2xl font-black text-emerald-900 font-mono mt-0.5">
                {result.correctCount} / {result.totalQuestions}
              </p>
            </div>

            <div className="rounded-xl bg-rose-50/80 p-3.5 border border-rose-100">
              <span className="text-xs text-rose-700 font-medium">Số câu sai</span>
              <p className="text-2xl font-black text-rose-900 font-mono mt-0.5">
                {result.incorrectCount}
              </p>
            </div>

            <div className="rounded-xl theme-surface-muted p-3.5 border theme-border">
              <span className="text-xs theme-text-secondary font-medium">Bỏ qua / Chưa làm</span>
              <p className="text-2xl font-black theme-text-secondary font-mono mt-0.5">
                {result.skippedCount}
              </p>
            </div>

            <div className="rounded-xl bg-teal-50/80 p-3.5 border border-teal-100">
              <span className="text-xs text-teal-700 font-medium">Thời gian hoàn thành</span>
              <p className="text-sm font-bold text-teal-950 mt-1 flex items-center justify-center gap-1">
                <Clock className="h-3.5 w-3.5 text-teal-700" />
                <span>{formatTimeSpent(result.timeSpentSeconds)}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => navigate("/student")}
              leftIcon={<Home className="h-4 w-4" />}
              className="w-full sm:w-auto"
            >
              Về sảnh học sinh
            </Button>
            {canRetake ? (
              <div className="flex flex-wrap items-center justify-center gap-3 w-full sm:w-auto">
                <Button
                  variant="primary"
                  onClick={() => navigate(`/student/quiz/${result.quizId}/lobby`)}
                  leftIcon={<RotateCcw className="h-4 w-4" />}
                  className="font-semibold"
                >
                  {maxAttempts === 0
                    ? "Làm lại toàn bộ"
                    : `Làm lại toàn bộ (${attemptsMade}/${maxAttempts} lượt)`}
                </Button>
                {result.incorrectCount + result.skippedCount > 0 && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      navigate(
                        `/student/quiz/${result.quizId}/lobby?mode=retry_incorrect&sourceResultId=${result.id}`,
                        { state: { retryMode: "retry_incorrect", sourceResultId: result.id } }
                      )
                    }
                    leftIcon={<RotateCcw className="h-4 w-4 text-amber-600" />}
                    className="font-semibold border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                  >
                    Làm lại các câu sai ({result.incorrectCount + result.skippedCount} câu)
                  </Button>
                )}
              </div>
            ) : (
              <Button
                variant="primary"
                onClick={() => navigate("/student")}
                rightIcon={<ArrowRight className="h-4 w-4" />}
                className="w-full sm:w-auto font-semibold"
              >
                Khám phá đề thi khác
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Detailed Question Review List (or Locked Notice if allowReview is false) */}
      {allowReview ? (
        <div className="space-y-6">
          {/* Header & Search */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b theme-border pb-4">
            <h2 className="text-lg font-bold theme-text-primary flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-blue-600" />
              <span>Chi tiết câu hỏi và đáp án</span>
            </h2>

            {/* Task 2.1: Search Bar */}
            <div className="w-full sm:w-72">
              <Input
                placeholder="Tìm câu hỏi, số câu, lời giải..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                leftIcon={<Search className="h-4 w-4" />}
              />
            </div>
          </div>

          {/* Task 2.2: Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto rounded-xl theme-surface-muted p-1.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setFilterTab("all")}
              className={`rounded-lg px-3 py-1.5 transition cursor-pointer ${
                filterTab === "all"
                  ? "theme-surface text-teal-700 shadow-xs font-bold"
                  : "theme-text-secondary theme-hover-text-primary"
              }`}
            >
              Tất cả ({result.totalQuestions})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab("correct")}
              className={`rounded-lg px-3 py-1.5 transition cursor-pointer ${
                filterTab === "correct"
                  ? "theme-surface text-emerald-700 shadow-xs font-bold"
                  : "theme-text-secondary theme-hover-text-primary"
              }`}
            >
              Đúng ({result.correctCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab("incorrect")}
              className={`rounded-lg px-3 py-1.5 transition cursor-pointer ${
                filterTab === "incorrect"
                  ? "theme-surface text-rose-700 shadow-xs font-bold"
                  : "theme-text-secondary theme-hover-text-primary"
              }`}
            >
              Sai ({result.incorrectCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab("skipped")}
              className={`rounded-lg px-3 py-1.5 transition cursor-pointer ${
                filterTab === "skipped"
                  ? "theme-surface theme-text-secondary shadow-xs font-bold"
                  : "theme-text-secondary theme-hover-text-primary"
              }`}
            >
              Chưa làm ({result.skippedCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab("flagged")}
              className={`flex items-center gap-1 rounded-lg px-3 py-1.5 transition cursor-pointer ${
                filterTab === "flagged"
                  ? "theme-surface text-amber-800 shadow-xs font-bold"
                  : "theme-text-secondary theme-hover-text-primary"
              }`}
            >
              <Flag className="h-3 w-3 fill-amber-500 text-amber-600" />
              <span>Có cờ ({flaggedSet.size})</span>
            </button>
          </div>

          {/* Task 2.5: 2-Column layout (Questions list + Sticky 40-question matrix) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT: Filtered Questions List (8 cols) */}
            <div className="lg:col-span-8 space-y-6">
              {filteredDetails.length > 0 ? (
                filteredDetails.map((item, idx) => {
                  // Resolve options for this question
                  const fallbackOptions: OptionItem[] =
                    quiz?.questions.find((q) => q.id === item.questionId)?.options || [
                      { id: "A", content: "Đáp án A" },
                      { id: "B", content: "Đáp án B" },
                      { id: "C", content: "Đáp án C" },
                      { id: "D", content: "Đáp án D" },
                    ];
                  const optionsToRender: OptionItem[] = item.options || fallbackOptions;
                  const isSkipped = item.selectedAnswers.length === 0;
                  const isFlagged = flaggedSet.has(item.questionId);

                  return (
                    <Card
                      key={item.questionId || idx}
                      id={`question-${item.questionId}`}
                      className={`border shadow-xs overflow-hidden scroll-mt-20 ${
                        item.isCorrect
                          ? "border-emerald-300 theme-surface"
                          : isSkipped
                          ? "theme-border-strong theme-surface"
                          : "border-rose-300 theme-surface"
                      }`}
                    >
                      {/* Question Header */}
                      <CardHeader
                        className={`p-4 border-b flex flex-row items-center justify-between ${
                          item.isCorrect
                            ? "bg-emerald-50/60 border-emerald-100"
                            : isSkipped
                            ? "theme-surface-muted theme-border"
                            : "bg-rose-50/60 border-rose-100"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              item.isCorrect
                                ? "success"
                                : isSkipped
                                ? "secondary"
                                : "destructive"
                            }
                            size="md"
                          >
                            Câu {item.order || idx + 1}
                          </Badge>
                          <span className="text-xs font-semibold theme-text-secondary">
                            {item.isCorrect
                              ? `+${Number(item.pointsEarned.toFixed(2))} điểm`
                              : `0 / ${Number(item.maxPoints.toFixed(2))} điểm`}
                          </span>
                          {/* Task 2.4: Flag indicator on question */}
                          {isFlagged && (
                            <Badge className="bg-amber-100 text-amber-900 border-amber-300 gap-1" size="sm">
                              <Flag className="h-3 w-3 fill-amber-500 text-amber-600" />
                              <span>Có cờ</span>
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 text-xs font-bold">
                          {item.isCorrect ? (
                            <span className="flex items-center gap-1 text-emerald-700">
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Chính xác
                            </span>
                          ) : isSkipped ? (
                            <span className="flex items-center gap-1 theme-text-muted">
                              Chưa chọn đáp án
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-rose-700">
                              <XCircle className="h-4 w-4 text-rose-600" /> Chưa chính xác
                            </span>
                          )}
                        </div>
                      </CardHeader>

                      <CardContent className="p-5 sm:p-6 space-y-5">
                        {/* Question prompt with KaTeX */}
                        <div className="text-base sm:text-lg font-medium theme-text-primary leading-relaxed">
                          <MathRenderer content={item.content} />
                        </div>

                        {/* All Options with accurate color coding */}
                        <div className="space-y-3 pt-1">
                          <p className="text-xs font-bold theme-text-secondary uppercase tracking-wider">
                            Các lựa chọn:
                          </p>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {optionsToRender.map((opt) => {
                              const isSelected = item.selectedAnswers.includes(opt.id);
                              const isCorrectAnswer = item.correctAnswers.includes(opt.id);

                              let cardStyle = "theme-border theme-surface theme-text-secondary";
                              let badgeStyle = "theme-surface-muted theme-text-secondary border theme-border";
                              let indicator: React.ReactNode = null;

                              if (isSelected && isCorrectAnswer) {
                                cardStyle = "border-emerald-500 bg-emerald-50/80 text-emerald-950 ring-2 ring-emerald-500/30 font-semibold";
                                badgeStyle = "bg-emerald-600 text-white font-bold";
                                indicator = (
                                  <div className="flex items-center gap-1 text-xs font-bold text-emerald-700 shrink-0 ml-auto">
                                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                    <span className="hidden sm:inline">Bạn chọn (Đúng)</span>
                                  </div>
                                );
                              } else if (isSelected && !isCorrectAnswer) {
                                cardStyle = "border-rose-500 bg-rose-50/80 text-rose-950 ring-2 ring-rose-500/30 font-semibold";
                                badgeStyle = "bg-rose-600 text-white font-bold";
                                indicator = (
                                  <div className="flex items-center gap-1 text-xs font-bold text-rose-700 shrink-0 ml-auto">
                                    <XCircle className="h-4 w-4 text-rose-600" />
                                    <span className="hidden sm:inline">Bạn chọn (Sai)</span>
                                  </div>
                                );
                              } else if (!isSelected && isCorrectAnswer && !item.isCorrect) {
                                cardStyle = "border-emerald-500 bg-emerald-50/60 text-emerald-950 border-dashed font-medium";
                                badgeStyle = "bg-emerald-600 text-white font-bold";
                                indicator = (
                                  <div className="flex items-center gap-1 text-xs font-bold text-emerald-700 shrink-0 ml-auto">
                                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                    <span className="hidden sm:inline">Đáp án đúng</span>
                                  </div>
                                );
                              }

                              return (
                                <div
                                  key={opt.id}
                                  className={`flex items-start gap-3 rounded-xl border p-3.5 text-sm transition ${cardStyle}`}
                                >
                                  <span
                                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-mono font-bold mt-0.5 ${badgeStyle}`}
                                  >
                                    {opt.id}
                                  </span>

                                  <div className="flex-1 min-w-0 pt-0.5">
                                    <MathRenderer content={opt.content} />
                                  </div>

                                  {indicator}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Step-by-step Explanation */}
                        {item.explanation && (
                          <div className="rounded-xl bg-teal-50/70 p-4 border border-teal-100/90 text-xs text-teal-950 space-y-1">
                            <div className="flex items-center gap-1.5 font-bold text-teal-900 mb-1">
                              <HelpCircle className="h-4 w-4 text-teal-700" />
                              <span>Phương pháp & Lời giải chi tiết:</span>
                            </div>
                            <div className="leading-relaxed">
                              <MathRenderer content={item.explanation} />
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed theme-border-strong theme-surface-muted p-12 text-center theme-text-muted">
                  <p className="font-semibold text-sm">Không tìm thấy câu hỏi phù hợp với điều kiện tìm kiếm hoặc bộ lọc.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 text-xs"
                    onClick={() => {
                      setSearchQuery("");
                      setFilterTab("all");
                    }}
                  >
                    Xóa bộ lọc tìm kiếm
                  </Button>
                </div>
              )}
            </div>

            {/* RIGHT: Task 2.5 Matrix Navigator (4 cols, 40 questions scroll max) */}
            <div className="lg:col-span-4 space-y-4 sticky top-6">
              <Card className="theme-border shadow-xs theme-surface">
                <CardHeader className="pb-3 border-b theme-border">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-bold flex items-center gap-1.5">
                      <ListChecks className="h-4 w-4 text-blue-600" />
                      <span>Danh sách câu hỏi</span>
                    </CardTitle>
                    <span className="text-xs font-semibold theme-text-muted">
                      {result.correctCount}/{result.totalQuestions} đúng
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="p-4 space-y-4">
                  {/* Status Legend */}
                  <div className="flex flex-wrap items-center gap-3 text-[11px] font-medium theme-text-secondary pb-1 border-b theme-border">
                    <div className="flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-md bg-emerald-500" />
                      <span>Đúng</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-md bg-rose-500" />
                      <span>Sai</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-md theme-surface-inset" />
                      <span>Chưa làm</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                      <span>Có cờ</span>
                    </div>
                  </div>

                  {/* 40-question scroll matrix container */}
                  <div className="max-h-[404px] overflow-y-auto pr-1">
                    <div className="grid grid-cols-5 gap-2">
                      {result.details.map((q, qIdx) => {
                        const isSkipped = q.selectedAnswers.length === 0;
                        const isFlagged = flaggedSet.has(q.questionId);

                        let bgClass = "bg-rose-500 text-white font-bold";
                        if (q.isCorrect) {
                          bgClass = "bg-emerald-500 text-white font-bold";
                        } else if (isSkipped) {
                          bgClass = "theme-surface-inset theme-text-secondary font-semibold";
                        }

                        return (
                          <button
                            key={q.questionId || qIdx}
                            type="button"
                            onClick={() => {
                              const el = document.getElementById(`question-${q.questionId}`);
                              if (el) {
                                el.scrollIntoView({ behavior: "smooth", block: "center" });
                              }
                            }}
                            className={`h-10 w-full rounded-xl text-xs flex items-center justify-center font-mono transition cursor-pointer relative hover:opacity-90 ${bgClass}`}
                          >
                            {q.order || qIdx + 1}
                            {isFlagged && (
                              <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-amber-400 border border-white" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      ) : (
        <Card className="theme-border theme-surface-muted p-6 text-center space-y-3">
          <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-lg theme-surface-inset theme-text-secondary">
            <Lock className="h-6 w-6" />
          </div>
          <h3 className="font-bold theme-text-primary text-base">
            Không hiển thị xem lại bài làm
          </h3>
          <p className="text-xs theme-text-muted max-w-md mx-auto leading-relaxed">
            Giáo viên đã cấu hình bảo mật tắt tính năng xem lại đáp án chi tiết cho đề thi này nhằm đảm bảo tính công bằng.
          </p>
        </Card>
      )}
    </div>
  );
}

export default Result;
