import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  LogIn,
  Search,
  CheckCircle2,
  Play,
  TrendingUp,
  History,
  Timer,
  KeyRound,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useQuizStore } from "@/store/quizStore";
import { useExamSessionStore, isSessionInProgress } from "@/store/examSessionStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/hooks/useToast";

export function StudentDashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { quizzes, getQuizByCode } = useQuizStore();
  const {
    activeSessions,
    getResultsByStudent,
    checkAndAutoSubmitExpired,
  } = useExamSessionStore();
  const toast = useToast();

  const [roomCode, setRoomCode] = useState("");
  const [historySearchTerm, setHistorySearchTerm] = useState("");

  const studentResults = user ? getResultsByStudent(user.id) : [];
  const publishedQuizzes = quizzes.filter((q) => q.status === "published");

  // Auto-finalize any expired exam sessions when visiting dashboard
  useEffect(() => {
    void checkAndAutoSubmitExpired();
  }, [checkAndAutoSubmitExpired]);

  // In-progress active sessions count (only valid within time)
  const inProgressQuizzes = publishedQuizzes.filter((q) => {
    const s = activeSessions[q.id];
    return isSessionInProgress(s);
  });

  const filteredHistory = studentResults.filter((result) => {
    return (
      result.quizTitle.toLowerCase().includes(historySearchTerm.toLowerCase()) ||
      result.subject.toLowerCase().includes(historySearchTerm.toLowerCase()) ||
      result.roomCode.toLowerCase().includes(historySearchTerm.toLowerCase())
    );
  });

  const handleJoinByCode = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanCode = roomCode.trim().toUpperCase();

    if (!cleanCode) {
      toast.error("Vui lòng nhập mã phòng thi (VD: QZ9821)");
      return;
    }

    const quiz = getQuizByCode(cleanCode);
    if (!quiz) {
      toast.error(`Không tìm thấy phòng thi có mã "${cleanCode}"`);
      return;
    }

    if (quiz.status !== "published") {
      toast.warning("Phòng thi này chưa được mở bởi Giáo viên");
      return;
    }

    // If already in-progress and within time, take student directly to quiz room
    const existingSession = activeSessions[quiz.id];
    if (isSessionInProgress(existingSession)) {
      navigate(`/student/quiz/${quiz.id}`);
      return;
    }

    navigate(`/student/quiz/${quiz.id}/lobby`);
  };

  const avgScore =
    studentResults.length > 0
      ? (
          studentResults.reduce((s, r) => s + r.score, 0) /
          studentResults.length
        ).toFixed(2)
      : "--";

  return (
    <div className="space-y-8 pb-16">
      {/* Header */}
      <div className="border-b border-neutral-200 pb-5">
        <p className="text-sm font-medium text-blue-700">Cổng học sinh</p>
        <h1 className="page-heading mt-1">
          Xin chào, {user?.name || user?.fullName || "Bạn học sinh"}
        </h1>
        <p className="page-description">
          Nhập mã phòng do thầy cô cung cấp để tham gia thi hoặc xem lại kết quả các bài đã làm.
        </p>
      </div>

      {/* Hero: Room Code Input Center Focus (Kích thước nhỏ gọn, vừa vặn) */}
      <div className="relative overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 via-white to-blue-50/40 p-4 sm:p-5 shadow-xs text-center">
        <div className="mx-auto max-w-md space-y-2.5">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs shadow-indigo-200">
            <KeyRound className="h-4 w-4" />
          </div>

          <div>
            <h2 className="text-base sm:text-lg font-bold text-neutral-900 tracking-tight">
              Tham gia phòng thi
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Nhập mã phòng thi 6 ký tự được giáo viên chia sẻ để bắt đầu làm bài.
            </p>
          </div>

          <form onSubmit={handleJoinByCode} className="pt-1 flex flex-col sm:flex-row gap-2.5 items-center justify-center">
            <input
              id="room-code"
              type="text"
              placeholder="VD: QZ9821"
              maxLength={10}
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              className="h-10 w-full sm:w-48 rounded-xl border border-indigo-200 bg-white px-3 text-center font-mono text-sm font-bold uppercase tracking-wider text-indigo-950 placeholder:font-sans placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-neutral-400 focus:border-indigo-600 focus:outline-hidden focus:ring-2 focus:ring-indigo-100 shadow-2xs"
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              className="w-full sm:w-auto h-10 px-4 text-xs font-bold shadow-xs bg-indigo-600 hover:bg-indigo-700"
              leftIcon={<LogIn className="h-4 w-4" />}
            >
              Vào phòng thi
            </Button>
          </form>
        </div>
      </div>

      {/* Active In-Progress Sessions (if any) */}
      {inProgressQuizzes.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-amber-600 animate-pulse" />
            <h2 className="text-lg font-bold text-neutral-900">
              Bài thi đang làm dở ({inProgressQuizzes.length})
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {inProgressQuizzes.map((quiz) => {
              const activeSession = activeSessions[quiz.id];
              const answeredCount = Object.keys(activeSession?.answers || {}).length;

              return (
                <Card key={quiz.id} className="border-amber-300 bg-amber-50/30 overflow-hidden shadow-xs">
                  <CardHeader className="pb-3 bg-amber-100/50">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <Badge variant="secondary" size="sm">
                        {quiz.subject}
                      </Badge>
                      <Badge variant="warning" size="sm" dot className="font-bold">
                        Đang làm ({answeredCount}/{quiz.totalQuestions} câu)
                      </Badge>
                    </div>
                    <CardTitle className="text-base font-bold text-neutral-900 line-clamp-1">
                      {quiz.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-3 space-y-3">
                    <div className="flex items-center justify-between text-xs text-neutral-600">
                      <span>Mã: <strong className="font-mono text-indigo-700">{quiz.code}</strong></span>
                      <span>Thời gian: {quiz.settings.durationMinutes > 0 ? `${quiz.settings.durationMinutes} phút` : "Không giới hạn"}</span>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs"
                      onClick={() => navigate(`/student/quiz/${quiz.id}`)}
                      leftIcon={<Play className="h-4 w-4 fill-current" />}
                    >
                      Tiếp tục làm bài
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className={inProgressQuizzes.length > 0 ? "border-amber-300 bg-amber-50/20" : ""}>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-neutral-500">Bài đang làm dở</p>
              <p className="text-2xl font-extrabold text-amber-700 mt-1 font-mono">
                {inProgressQuizzes.length}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <Timer className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-neutral-500">Bài đã hoàn thành</p>
              <p className="text-2xl font-extrabold text-emerald-900 mt-1 font-mono">
                {studentResults.length}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-neutral-500">Điểm trung bình</p>
              <p className="text-2xl font-extrabold text-violet-900 mt-1 font-mono">
                {avgScore} {avgScore !== "--" ? "đ" : ""}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
              <TrendingUp className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* History Section */}
      <div className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
            <History className="h-5 w-5 text-indigo-600" />
            <span>Lịch sử các bài thi đã hoàn thành</span>
          </h2>

          {studentResults.length > 0 && (
            <div className="w-full sm:max-w-xs">
              <Input
                placeholder="Tìm theo tên bài, mã phòng..."
                value={historySearchTerm}
                onChange={(e) => setHistorySearchTerm(e.target.value)}
                leftIcon={<Search className="h-4 w-4" />}
              />
            </div>
          )}
        </div>

        {studentResults.length === 0 ? (
          <Card className="text-center p-8 border-dashed">
            <p className="text-sm text-neutral-500">
              Bạn chưa hoàn thành bài thi nào. Nhập mã phòng bên trên để bắt đầu làm bài kiểm tra đầu tiên!
            </p>
          </Card>
        ) : filteredHistory.length > 0 ? (
          <Card className="overflow-hidden">
            <div className="divide-y divide-neutral-100">
              {filteredHistory.map((result) => (
                <div
                  key={result.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:px-6 hover:bg-neutral-50/70 transition"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" size="sm">
                        {result.subject}
                      </Badge>
                      <h4 className="font-bold text-sm text-neutral-900">
                        {result.quizTitle}
                      </h4>
                    </div>
                    <p className="text-xs text-neutral-500">
                      Nộp bài lúc: {new Date(result.submittedAt).toLocaleString("vi-VN")} · Mã phòng:{" "}
                      <span className="font-mono text-indigo-600 font-bold">{result.roomCode}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span
                        className={`text-lg font-black font-mono ${
                          result.isPassed ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {result.score.toFixed(2)} / 10 đ
                      </span>
                      <p className="text-[11px] text-neutral-400 font-medium">
                        Đúng {result.correctCount}/{result.totalQuestions} câu ({result.percentage}%)
                      </p>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/student/result/${result.id}`)}
                    >
                      Xem chi tiết
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <Card className="text-center p-8">
            <p className="text-sm text-neutral-500">
              Không tìm thấy kết quả nào phù hợp với từ khóa "{historySearchTerm}".
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

export default StudentDashboard;
