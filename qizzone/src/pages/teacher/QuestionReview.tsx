import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  Edit,
  Clock,
  BookOpen,
  Award,
  ListChecks,
  HelpCircle,
} from "lucide-react";
import { useQuizStore } from "@/store/quizStore";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MathRenderer } from "@/components/common/MathRenderer";

export function QuestionReview() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const { getQuizById, quizzes } = useQuizStore();

  const quiz = (quizId ? getQuizById(quizId) : null) || quizzes[0];

  if (!quiz) {
    return (
      <div className="text-center py-16 space-y-4">
        <h2 className="text-xl font-bold text-neutral-900">
          Không tìm thấy bài thi
        </h2>
        <Button variant="outline" onClick={() => navigate("/teacher/quizzes")}>
          Quay lại danh sách đề thi
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-16">
      {/* Top Action Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-neutral-200/80 pb-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/teacher/quizzes")}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
          >
            Danh sách đề
          </Button>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-neutral-900 tracking-tight">
                Kiểm duyệt câu hỏi & Xem trước
              </h1>
              <Badge variant={quiz.status} size="sm" dot>
                {quiz.status === "published"
                  ? "Đã xuất bản"
                  : quiz.status === "closed"
                  ? "Đã đóng"
                  : "Bản nháp"}
              </Badge>
            </div>
            <p className="text-xs text-neutral-500 mt-0.5">
              Rà soát công thức Toán LaTeX và bảng đáp án trước khi học sinh làm bài.
            </p>
          </div>
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={() => navigate(`/teacher/edit-quiz/${quiz.id}`)}
          leftIcon={<Edit className="h-4 w-4" />}
        >
          Chỉnh sửa đề thi
        </Button>
      </div>

      {/* Quiz Overview Banner */}
      <Card className="overflow-hidden">
        <CardHeader className="bg-white p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <Badge variant="secondary" size="sm">
                {quiz.subject}
              </Badge>
              <CardTitle className="text-xl font-semibold sm:text-2xl">
                {quiz.title}
              </CardTitle>
            </div>

            <div className="flex items-center gap-4 rounded-md bg-neutral-50 px-4 py-2.5 text-xs font-medium text-neutral-600">
              <div className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-blue-600" />
                <span>
                  {quiz.settings.durationMinutes === 0
                    ? "Vô thời hạn"
                    : `${quiz.settings.durationMinutes} phút`}
                </span>
              </div>
              <span>•</span>
              <div className="flex items-center gap-1.5">
                <BookOpen className="h-4 w-4 text-blue-600" />
                <span>{quiz.questions.length} câu hỏi</span>
              </div>
              <span>•</span>
              <div className="flex items-center gap-1.5">
                <Award className="h-4 w-4 text-blue-600" />
                <span>Mã phòng: <strong className="font-mono text-neutral-950">{quiz.code}</strong></span>
              </div>
            </div>
          </div>
        </CardHeader>

        {quiz.description && (
          <CardContent className="p-4 bg-neutral-50/70 border-t border-neutral-100 text-xs text-neutral-600">
            <strong className="text-neutral-900">Hướng dẫn làm bài: </strong>
            {quiz.description}
          </CardContent>
        )}
      </Card>

      {/* Questions Review List */}
      <div className="space-y-6">
        <h2 className="section-heading flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-blue-600" />
          <span>Danh sách câu hỏi và đáp án</span>
        </h2>

        {quiz.questions.map((q, idx) => (
          <Card key={q.id || idx} className="border-neutral-200 shadow-xs">
            <CardHeader className="bg-neutral-50/60 pb-3 border-b border-neutral-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="primary" size="md">
                    Câu {idx + 1}
                  </Badge>
                  <span className="text-xs font-semibold text-neutral-500">
                    Thang điểm: {q.points || 1} điểm
                  </span>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(`/teacher/edit-quiz/${quiz.id}`)}
                  className="h-8 text-xs text-neutral-600 hover:text-indigo-600"
                  leftIcon={<Edit className="h-3.5 w-3.5" />}
                >
                  Sửa câu này
                </Button>
              </div>

              {/* Question content with LaTeX */}
              <div className="pt-3 text-sm sm:text-base font-medium text-neutral-900 leading-relaxed">
                <MathRenderer content={q.content} />
              </div>
            </CardHeader>

            <CardContent className="p-6 space-y-4">
              {/* 4 Options Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {q.options.map((opt) => {
                  const isCorrect = q.correctAnswers.includes(opt.id);
                  return (
                    <div
                      key={opt.id}
                      className={`flex items-start gap-3 rounded-xl border p-3.5 text-sm transition ${
                        isCorrect
                          ? "border-emerald-500 bg-emerald-50/70 text-emerald-950 font-medium shadow-2xs"
                          : "border-neutral-200 bg-white text-neutral-800"
                      }`}
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg font-bold text-xs ${
                          isCorrect
                            ? "bg-emerald-600 text-white"
                            : "bg-neutral-100 text-neutral-600 border border-neutral-200"
                        }`}
                      >
                        {opt.id}
                      </span>

                      <div className="flex-1 min-w-0 pt-0.5">
                        <MathRenderer content={opt.content} />
                      </div>

                      {isCorrect && (
                        <div className="flex items-center gap-1 text-xs font-bold text-emerald-700 shrink-0 mt-0.5">
                          <CheckCircle2 className="h-4 w-4" />
                          <span className="hidden sm:inline">Đáp án đúng</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Explanation Section */}
              {q.explanation && (
                <div className="rounded-xl bg-indigo-50/70 p-4 border border-indigo-100/90 text-xs text-indigo-950 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-indigo-900 mb-1">
                    <HelpCircle className="h-4 w-4 text-indigo-600" />
                    <span>Lời giải & Hướng dẫn chi tiết:</span>
                  </div>
                  <div className="leading-relaxed">
                    <MathRenderer content={q.explanation} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default QuestionReview;
