import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  Search,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Award,
  BookOpen,
  Filter,
  Eye,
  AlertCircle,
} from "lucide-react";
import { useQuizStore } from "@/store/quizStore";
import { useExamSessionStore } from "@/store/examSessionStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { MathRenderer } from "@/components/common/MathRenderer";
import { exportResultsToCsv } from "@/utils/exportHelper";
import { useToast } from "@/hooks/useToast";
import type { ExamResult } from "@/types/exam";

export function QuizResultsView() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const getQuizById = useQuizStore((state) => state.getQuizById);
  const allResults = useExamSessionStore((state) => state.results);
  const toast = useToast();

  const quiz = quizId ? getQuizById(quizId) : undefined;

  const rawResults = useMemo(() => {
    if (!quizId) return [];
    return allResults.filter((r) => r.quizId === quizId);
  }, [allResults, quizId]);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "passed" | "failed">("all");
  const [sortBy, setSortBy] = useState<"score_desc" | "score_asc" | "time_desc">("score_desc");

  // Selected student result for detail modal view
  const [selectedResult, setSelectedResult] = useState<ExamResult | null>(null);

  // Filter & Sort Results
  const filteredResults = useMemo(() => {
    return rawResults
      .filter((r) => {
        const matchesSearch =
          r.studentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (r.studentClass || "").toLowerCase().includes(searchTerm.toLowerCase());

        const matchesStatus =
          filterStatus === "all"
            ? true
            : filterStatus === "passed"
            ? r.isPassed
            : !r.isPassed;

        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => {
        if (sortBy === "score_desc") return b.score - a.score;
        if (sortBy === "score_asc") return a.score - b.score;
        if (sortBy === "time_desc") {
          return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
        }
        return 0;
      });
  }, [rawResults, searchTerm, filterStatus, sortBy]);

  // Analytics Stats
  const totalSubmissions = rawResults.length;
  const averageScore =
    totalSubmissions > 0
      ? (rawResults.reduce((sum, r) => sum + r.score, 0) / totalSubmissions).toFixed(1)
      : "0.0";
  const maxScore =
    totalSubmissions > 0
      ? Math.max(...rawResults.map((r) => r.score)).toFixed(1)
      : "0.0";
  const minScore =
    totalSubmissions > 0
      ? Math.min(...rawResults.map((r) => r.score)).toFixed(1)
      : "0.0";
  const passedCount = rawResults.filter((r) => r.isPassed).length;
  const passRate =
    totalSubmissions > 0
      ? Math.round((passedCount / totalSubmissions) * 100)
      : 0;

  const handleExportCsv = () => {
    if (!quiz || rawResults.length === 0) {
      toast.warning("Chưa có kết quả nộp bài nào để xuất file");
      return;
    }

    try {
      exportResultsToCsv({
        quizTitle: quiz.title,
        roomCode: quiz.code,
        subject: quiz.subject,
        results: filteredResults,
      });
      toast.success("Đã xuất file bảng điểm CSV thành công!");
    } catch {
      toast.error("Không thể xuất file bảng điểm. Vui lòng thử lại!");
    }
  };

  if (!quiz) {
    return (
      <div className="max-w-md mx-auto my-16 text-center space-y-4">
        <AlertCircle className="h-10 w-10 text-rose-600 mx-auto" />
        <h2 className="text-xl font-bold text-neutral-900">Không tìm thấy bài thi</h2>
        <Button variant="outline" onClick={() => navigate("/teacher/quizzes")}>
          Quay lại danh sách đề thi
        </Button>
      </div>
    );
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}p ${secs < 10 ? "0" : ""}${secs}s`;
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Header Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-neutral-200/80 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/teacher/quizzes")}
              leftIcon={<ArrowLeft className="h-4 w-4" />}
              className="p-0 h-auto text-neutral-500 hover:text-neutral-900"
            >
              Danh sách đề thi
            </Button>
            <span className="text-neutral-300">/</span>
            <Badge variant="secondary" size="sm">
              {quiz.subject}
            </Badge>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-neutral-900 tracking-tight">
            Bảng điểm & Thống kê: {quiz.title}
          </h1>
          <p className="text-xs sm:text-sm text-neutral-500">
            Mã phòng: <span className="font-mono font-bold text-indigo-600">{quiz.code}</span> ·{" "}
            Tổng số: <strong>{quiz.totalQuestions} câu hỏi</strong> · Điểm đạt yêu cầu:{" "}
            <strong>{quiz.settings.passPercentage}%</strong>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            leftIcon={<Download className="h-4 w-4 text-emerald-600" />}
            className="font-semibold"
          >
            Xuất Excel / CSV
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate(`/teacher/quiz/${quiz.id}/review`)}
            leftIcon={<BookOpen className="h-4 w-4" />}
          >
            Xem đề gốc
          </Button>
        </div>
      </div>

      {/* Analytics Highlights */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card hoverEffect>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-neutral-500">Số bài nộp</p>
              <p className="text-2xl font-extrabold text-indigo-900 mt-1 font-mono">
                {totalSubmissions}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-50 text-blue-700">
              <Award className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card hoverEffect>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-neutral-500">Điểm trung bình</p>
              <p className="text-2xl font-extrabold text-violet-900 mt-1 font-mono">
                {averageScore} <span className="text-sm font-normal text-neutral-400">/ 10</span>
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-neutral-100 text-neutral-700">
              <TrendingUp className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card hoverEffect>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-neutral-500">Cao nhất / Thấp nhất</p>
              <p className="text-2xl font-extrabold text-emerald-900 mt-1 font-mono">
                {maxScore} <span className="text-xs font-normal text-neutral-400">/ {minScore}</span>
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
              <Award className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card hoverEffect>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-neutral-500">Tỉ lệ đạt yêu cầu</p>
              <p className="text-2xl font-extrabold text-indigo-700 mt-1 font-mono">
                {passRate}%
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-50 text-blue-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <Input
            placeholder="Tìm theo tên học sinh, lớp..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-600">
            <Filter className="h-4 w-4 text-neutral-400" />
            <span>Trạng thái:</span>
            <select
              value={filterStatus}
              onChange={(e) =>
                setFilterStatus(e.target.value as "all" | "passed" | "failed")
              }
              className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-800 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="all">Tất cả</option>
              <option value="passed">Đạt (Passed)</option>
              <option value="failed">Chưa đạt</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-600">
            <span>Sắp xếp:</span>
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(
                  e.target.value as "score_desc" | "score_asc" | "time_desc"
                )
              }
              className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-800 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="score_desc">Điểm cao nhất</option>
              <option value="score_asc">Điểm thấp nhất</option>
              <option value="time_desc">Nộp bài mới nhất</option>
            </select>
          </div>
        </div>
      </div>

      {/* Submissions Table */}
      <Card className="overflow-hidden border-neutral-200/90 shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-neutral-600">
            <thead className="bg-neutral-50/80 text-neutral-800 font-bold border-b border-neutral-200/80 uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3.5 px-4 w-12 text-center">STT</th>
                <th className="py-3.5 px-4">Họ và tên thí sinh</th>
                <th className="py-3.5 px-4">Lớp</th>
                <th className="py-3.5 px-4 text-center">Điểm số</th>
                <th className="py-3.5 px-4 text-center">Số câu đúng</th>
                <th className="py-3.5 px-4 text-center">Tỉ lệ</th>
                <th className="py-3.5 px-4 text-center">Xếp loại</th>
                <th className="py-3.5 px-4 text-center">Trạng thái</th>
                <th className="py-3.5 px-4">Thời gian</th>
                <th className="py-3.5 px-4">Thời điểm nộp</th>
                <th className="py-3.5 px-4 text-right">Chi tiết</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-neutral-100 font-medium">
              {filteredResults.length > 0 ? (
                filteredResults.map((item, idx) => (
                  <tr key={item.id} className="hover:bg-neutral-50/60 transition">
                    <td className="py-3 px-4 text-center font-mono text-neutral-400">
                      {idx + 1}
                    </td>
                    <td className="py-3 px-4 font-bold text-neutral-900">
                      {item.studentName}
                    </td>
                    <td className="py-3 px-4 font-mono text-neutral-600">
                      {item.studentClass || "12A1"}
                    </td>
                    <td className="py-3 px-4 text-center font-black font-mono text-sm text-indigo-700">
                      {item.score.toFixed(1)}
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-semibold text-neutral-800">
                      {item.correctCount} / {item.totalQuestions}
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-semibold text-neutral-800">
                      {item.percentage}%
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="font-semibold text-[11px] text-neutral-700">
                        {item.academicRank || (item.score >= 8 ? "Giỏi" : item.score >= 6.5 ? "Khá" : "Trung bình")}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Badge
                        variant={item.isPassed ? "success" : "destructive"}
                        size="sm"
                        dot
                      >
                        {item.isPassed ? "Đạt" : "Chưa đạt"}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 font-mono text-neutral-500">
                      {formatDuration(item.timeSpentSeconds)}
                    </td>
                    <td className="py-3 px-4 text-neutral-500">
                      {new Date(item.submittedAt).toLocaleTimeString("vi-VN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      - {new Date(item.submittedAt).toLocaleDateString("vi-VN")}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedResult(item)}
                        leftIcon={<Eye className="h-3.5 w-3.5" />}
                        className="h-7 text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
                      >
                        Xem bài
                      </Button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-neutral-400">
                    Chưa có học sinh nào nộp bài thi phù hợp với bộ lọc hiện tại.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Student Detail Test Paper Modal */}
      {selectedResult && (
        <Modal
          isOpen={!!selectedResult}
          onClose={() => setSelectedResult(null)}
          title={`Bài làm của thí sinh: ${selectedResult.studentName}`}
          description={`Điểm số: ${selectedResult.score.toFixed(1)} / 10 · Đúng ${selectedResult.correctCount}/${selectedResult.totalQuestions} câu · Nộp lúc: ${new Date(selectedResult.submittedAt).toLocaleString("vi-VN")}`}
          footer={
            <Button variant="outline" onClick={() => setSelectedResult(null)}>
              Đóng cửa sổ
            </Button>
          }
        >
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {selectedResult.details.map((q, qIdx) => {
              const optionsToRender =
                q.options ||
                quiz.questions.find((x) => x.id === q.questionId)?.options ||
                [];

              return (
                <div
                  key={q.questionId || qIdx}
                  className={`rounded-xl border p-4 space-y-3 ${
                    q.isCorrect
                      ? "border-emerald-200 bg-emerald-50/20"
                      : "border-rose-200 bg-rose-50/20"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold">
                    <Badge variant={q.isCorrect ? "success" : "destructive"} size="sm">
                      Câu {q.order || qIdx + 1}
                    </Badge>
                    <span className={q.isCorrect ? "text-emerald-700" : "text-rose-700"}>
                      {q.isCorrect ? "Đúng (+2.5đ)" : "Sai (0đ)"}
                    </span>
                  </div>

                  <div className="text-sm font-medium text-neutral-900 leading-relaxed">
                    <MathRenderer content={q.content} />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    {optionsToRender.map((opt) => {
                      const isSelected = q.selectedAnswers.includes(opt.id);
                      const isCorrect = q.correctAnswers.includes(opt.id);

                      let style = "border-neutral-200 bg-white text-neutral-700";
                      if (isSelected && isCorrect) {
                        style = "border-emerald-500 bg-emerald-50 text-emerald-950 font-bold";
                      } else if (isSelected && !isCorrect) {
                        style = "border-rose-500 bg-rose-50 text-rose-950 font-bold";
                      } else if (!isSelected && isCorrect && !q.isCorrect) {
                        style = "border-emerald-500 bg-emerald-50/60 text-emerald-950 border-dashed font-medium";
                      }

                      return (
                        <div
                          key={opt.id}
                          className={`flex items-start gap-2 rounded-lg border p-2 text-xs ${style}`}
                        >
                          <span className="font-mono font-bold">{opt.id}.</span>
                          <div className="flex-1">
                            <MathRenderer content={opt.content} />
                          </div>
                          {isSelected && isCorrect && (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          )}
                          {isSelected && !isCorrect && (
                            <XCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {q.explanation && (
                    <div className="rounded-lg bg-indigo-50/80 p-2.5 text-xs text-indigo-950 border border-indigo-100">
                      <strong>Lời giải: </strong>
                      <MathRenderer content={q.explanation} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Modal>
      )}
    </div>
  );
}

export default QuizResultsView;
