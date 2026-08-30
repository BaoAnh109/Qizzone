import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  Home,
  Award,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Clock,
  Sparkles,
  Lock,
  RotateCcw,
} from "lucide-react";
import { useExamSessionStore } from "@/store/examSessionStore";
import { useQuizStore } from "@/store/quizStore";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MathRenderer } from "@/components/common/MathRenderer";
import type { OptionItem } from "@/types/quiz";

export function Result() {
  const navigate = useNavigate();
  const { resultId } = useParams();
  const { getResultById, results, getResultsByStudent } = useExamSessionStore();
  const getQuizById = useQuizStore((state) => state.getQuizById);

  const result = (resultId ? getResultById(resultId) : undefined) || results[0];
  const quiz = result ? getQuizById(result.quizId) : undefined;

  if (!result) {
    return (
      <div className="max-w-md mx-auto my-16 text-center space-y-4">
        <h2 className="text-xl font-bold text-neutral-900">
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
    <div className="max-w-4xl mx-auto space-y-8 pb-16">
      {/* Top Banner */}
      <div className="text-center space-y-3 pt-4">
        <div
          className={`inline-flex h-20 w-20 items-center justify-center rounded-3xl shadow-lg ${
            result.isPassed
              ? "bg-emerald-100 text-emerald-600 shadow-emerald-100"
              : "bg-amber-100 text-amber-600 shadow-amber-100"
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
          <h1 className="text-3xl font-extrabold text-neutral-900 tracking-tight mt-2">
            Kết quả bài thi: {result.quizTitle}
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            Thí sinh: <strong>{result.studentName}</strong> · Mã phòng:{" "}
            <span className="font-mono text-indigo-600 font-bold">{result.roomCode}</span> ·{" "}
            {new Date(result.submittedAt).toLocaleString("vi-VN")}
          </p>
        </div>
      </div>

      {/* Score Summary Card */}
      <Card className="text-center overflow-hidden border-neutral-200/90 shadow-sm">
        <CardContent className="p-6 sm:p-8 space-y-6">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-widest">
              Điểm số tổng kết
            </span>
            <div
              className={`text-5xl font-black tracking-tight font-mono ${
                result.isPassed ? "text-indigo-600" : "text-amber-600"
              }`}
            >
              {result.score.toFixed(1)}{" "}
              <span className="text-xl font-normal text-neutral-400">/ 10</span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-neutral-100">
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

            <div className="rounded-xl bg-neutral-50 p-3.5 border border-neutral-200">
              <span className="text-xs text-neutral-600 font-medium">Bỏ qua / Chưa làm</span>
              <p className="text-2xl font-black text-neutral-800 font-mono mt-0.5">
                {result.skippedCount}
              </p>
            </div>

            <div className="rounded-xl bg-indigo-50/80 p-3.5 border border-indigo-100">
              <span className="text-xs text-indigo-700 font-medium">Thời gian hoàn thành</span>
              <p className="text-sm font-bold text-indigo-950 mt-1 flex items-center justify-center gap-1">
                <Clock className="h-3.5 w-3.5 text-indigo-600" />
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
              <Button
                variant="primary"
                onClick={() => navigate(`/student/quiz/${result.quizId}/lobby`)}
                leftIcon={<RotateCcw className="h-4 w-4" />}
                className="w-full sm:w-auto font-semibold"
              >
                {maxAttempts === 0
                  ? "Làm lại bài thi (Không giới hạn)"
                  : `Làm lại bài thi (Còn ${maxAttempts - attemptsMade} lượt)`}
              </Button>
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
          <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-600" />
            <span>Chi tiết toàn bộ câu hỏi & Đáp án bài làm</span>
          </h2>

          {result.details.map((item, idx) => {
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

            return (
              <Card
                key={item.questionId || idx}
                className={`border shadow-xs overflow-hidden ${
                  item.isCorrect
                    ? "border-emerald-300 bg-white"
                    : isSkipped
                    ? "border-neutral-300 bg-white"
                    : "border-rose-300 bg-white"
                }`}
              >
                {/* Question Header */}
                <CardHeader
                  className={`p-4 border-b flex flex-row items-center justify-between ${
                    item.isCorrect
                      ? "bg-emerald-50/60 border-emerald-100"
                      : isSkipped
                      ? "bg-neutral-50 border-neutral-200"
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
                    <span className="text-xs font-semibold text-neutral-600">
                      {item.isCorrect
                        ? `+${item.pointsEarned} điểm`
                        : `0 / ${item.maxPoints} điểm`}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs font-bold">
                    {item.isCorrect ? (
                      <span className="flex items-center gap-1 text-emerald-700">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Chính xác
                      </span>
                    ) : isSkipped ? (
                      <span className="flex items-center gap-1 text-neutral-500">
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
                  <div className="text-base sm:text-lg font-medium text-neutral-900 leading-relaxed">
                    <MathRenderer content={item.content} />
                  </div>

                  {/* All Options with accurate color coding */}
                  <div className="space-y-3 pt-1">
                    <p className="text-xs font-bold text-neutral-700 uppercase tracking-wider">
                      Các lựa chọn:
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {optionsToRender.map((opt) => {
                        const isSelected = item.selectedAnswers.includes(opt.id);
                        const isCorrectAnswer = item.correctAnswers.includes(opt.id);

                        let cardStyle = "border-neutral-200 bg-white text-neutral-800";
                        let badgeStyle = "bg-neutral-100 text-neutral-700 border border-neutral-200";
                        let indicator: React.ReactNode = null;

                        if (isSelected && isCorrectAnswer) {
                          // Chọn ĐÚNG: Tô xanh đáp án đã chọn
                          cardStyle = "border-emerald-500 bg-emerald-50/80 text-emerald-950 ring-2 ring-emerald-500/30 font-semibold";
                          badgeStyle = "bg-emerald-600 text-white font-bold";
                          indicator = (
                            <div className="flex items-center gap-1 text-xs font-bold text-emerald-700 shrink-0 ml-auto">
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              <span className="hidden sm:inline">Bạn chọn (Đúng)</span>
                            </div>
                          );
                        } else if (isSelected && !isCorrectAnswer) {
                          // Chọn SAI: Tô đỏ đáp án đã chọn
                          cardStyle = "border-rose-500 bg-rose-50/80 text-rose-950 ring-2 ring-rose-500/30 font-semibold";
                          badgeStyle = "bg-rose-600 text-white font-bold";
                          indicator = (
                            <div className="flex items-center gap-1 text-xs font-bold text-rose-700 shrink-0 ml-auto">
                              <XCircle className="h-4 w-4 text-rose-600" />
                              <span className="hidden sm:inline">Bạn chọn (Sai)</span>
                            </div>
                          );
                        } else if (!isSelected && isCorrectAnswer && !item.isCorrect) {
                          // Đáp án đúng cần chỉ ra khi người dùng làm sai hoặc bỏ qua: Tô xanh
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
                    <div className="rounded-xl bg-indigo-50/70 p-4 border border-indigo-100/90 text-xs text-indigo-950 space-y-1">
                      <div className="flex items-center gap-1.5 font-bold text-indigo-900 mb-1">
                        <HelpCircle className="h-4 w-4 text-indigo-600" />
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
          })}
        </div>
      ) : (
        <Card className="border-neutral-200/90 bg-neutral-50/50 p-6 text-center space-y-3">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-200 text-neutral-600 mx-auto">
            <Lock className="h-6 w-6" />
          </div>
          <h3 className="font-bold text-neutral-900 text-base">
            Không hiển thị xem lại bài làm
          </h3>
          <p className="text-xs text-neutral-500 max-w-md mx-auto leading-relaxed">
            Giáo viên đã cấu hình bảo mật tắt tính năng xem lại đáp án chi tiết cho đề thi này nhằm đảm bảo tính công bằng.
          </p>
        </Card>
      )}
    </div>
  );
}

export default Result;
