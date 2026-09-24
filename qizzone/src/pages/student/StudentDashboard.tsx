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
      {/* Top Section: Greeting on Left + Room Code Card on Right with diagonal blue gradient */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5 pb-6 border-b border-neutral-200">
        {/* Left: Chào User */}
        <div className="space-y-1.5 max-w-xl">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200/60">
            <span>Cổng học sinh</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-neutral-900 tracking-tight">
            Xin chào, {user?.name || user?.fullName || "Bạn học sinh"}
          </h1>
          <p className="text-xs sm:text-sm text-neutral-500">
            Nhập mã phòng do thầy cô cung cấp để tham gia thi hoặc xem lại kết quả các bài đã làm.
          </p>
        </div>

        {/* Right: Card Tham gia phòng thi gradient chéo xanh */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-sky-600 p-4 sm:p-5 text-white shadow-md shadow-indigo-600/15 border border-blue-400/30 shrink-0 lg:max-w-md w-full lg:w-auto">
          {/* Subtle Decorative Glow */}
          <div className="pointer-events-none absolute -right-6 -bottom-6 h-24 w-24 rounded-full bg-white/15 blur-xl" />
          <div className="pointer-events-none absolute -left-6 -top-6 h-20 w-20 rounded-full bg-sky-400/20 blur-lg" />

          <div className="relative z-10 space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/20 backdrop-blur-xs text-white shadow-2xs">
                <KeyRound className="h-3.5 w-3.5" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-bold text-white tracking-tight leading-none">
                  Tham gia phòng thi
                </h2>
                <p className="text-[11px] text-blue-100/90 mt-0.5">
                  Nhập mã phòng thi 6 ký tự để vào làm bài
                </p>
              </div>
            </div>

            <form onSubmit={handleJoinByCode} className="pt-0.5 flex flex-col sm:flex-row gap-2 items-center">
              <input
                id="room-code"
                type="text"
                placeholder="VD: QZ9821"
                maxLength={10}
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                className="h-9.5 w-full sm:w-44 rounded-xl border border-white/20 bg-white px-3 text-center font-mono text-sm font-bold uppercase tracking-wider text-neutral-900 placeholder:font-sans placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-neutral-400 focus:outline-hidden focus:ring-2 focus:ring-white/50 shadow-xs"
              />
              <button
                type="submit"
                className="h-9.5 w-full sm:w-auto px-4 rounded-xl bg-white text-indigo-700 hover:bg-blue-50 font-bold text-xs shadow-xs flex items-center justify-center gap-1.5 transition cursor-pointer shrink-0"
              >
                <LogIn className="h-3.5 w-3.5 text-indigo-600" />
                <span>Vào phòng thi</span>
              </button>
            </form>
          </div>
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
