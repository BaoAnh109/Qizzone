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
  GraduationCap,
  Mail,
  Sparkles,
  BookOpen,
  Clock,
  Award,
  RefreshCw,
  Eye,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useQuizStore } from "@/store/quizStore";
import { useExamSessionStore, isSessionInProgress } from "@/store/examSessionStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/hooks/useToast";
import type { Quiz } from "@/types/quiz";

export function StudentDashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { quizzes, getQuizByCode, load: loadQuizzes, isLoading: isQuizzesLoading } = useQuizStore();
  const {
    activeSessions,
    getResultsByStudent,
    checkAndAutoSubmitExpired,
  } = useExamSessionStore();
  const toast = useToast();

  const [roomCode, setRoomCode] = useState("");
  const [historySearchTerm, setHistorySearchTerm] = useState("");
  const [availableSearchTerm, setAvailableSearchTerm] = useState("");

  const studentResults = user ? getResultsByStudent(user.id) : [];
  const publishedQuizzes = quizzes.filter((q) => q.status === "published");

  // Auto-fetch latest quizzes from server on dashboard mount
  useEffect(() => {
    void loadQuizzes().catch(() => {});
  }, [loadQuizzes]);

  // Auto-finalize any expired exam sessions when visiting dashboard
  useEffect(() => {
    void checkAndAutoSubmitExpired();
  }, [checkAndAutoSubmitExpired]);

  // In-progress active sessions count (only valid within time)
  const inProgressQuizzes = publishedQuizzes.filter((q) => {
    const s = activeSessions[q.id];
    return isSessionInProgress(s);
  });

  // Match available quizzes for this student based on Class or Email
  // MẶC ĐỊNH: Đề public không gán lớp hoặc email sẽ KHÔNG hiển thị trên trang chủ
  // Chỉ khi được gán Email hoặc Lớp thì học sinh phù hợp mới thấy trên trang chủ
  const userEmail = (user?.email || "").trim().toLowerCase();
  const userClassNorm = (user?.studentClass || "").trim().toLowerCase();

  const getQuizAudienceBadge = (quiz: Quiz) => {
    const assignedClasses = (quiz.settings.assignedClasses || []).map((c) => c.trim().toLowerCase());
    const assignedEmails = (quiz.settings.assignedEmails || []).map((e) => e.trim().toLowerCase());

    if (userEmail && assignedEmails.includes(userEmail)) {
      return (
        <Badge variant="primary" size="sm" className="font-bold flex items-center gap-1">
          <Mail className="h-3 w-3" />
          <span>Giao đích danh</span>
        </Badge>
      );
    }

    if (userClassNorm && assignedClasses.includes(userClassNorm)) {
      return (
        <Badge variant="success" size="sm" className="font-bold flex items-center gap-1">
          <GraduationCap className="h-3 w-3" />
          <span>Lớp {user?.studentClass}</span>
        </Badge>
      );
    }

    if (quiz.settings.assignedClasses && quiz.settings.assignedClasses.length > 0) {
      return (
        <Badge variant="success" size="sm" className="font-bold flex items-center gap-1">
          <GraduationCap className="h-3 w-3" />
          <span>Lớp {quiz.settings.assignedClasses.join(", ")}</span>
        </Badge>
      );
    }

    return null;
  };

  const matchedQuizzes = publishedQuizzes.filter((quiz) => {
    const assignedClasses = (quiz.settings.assignedClasses || []).map((c) => c.trim().toLowerCase());
    const assignedEmails = (quiz.settings.assignedEmails || []).map((e) => e.trim().toLowerCase());

    const hasClassRestriction = assignedClasses.length > 0;
    const hasEmailRestriction = assignedEmails.length > 0;

    // 1. Mặc định: đề không giao cho lớp hay email nào sẽ KHÔNG hiển thị sẵn trên màn hình
    if (!hasClassRestriction && !hasEmailRestriction) {
      return false;
    }

    // 2. Học sinh có email khớp với email được giao
    if (hasEmailRestriction && userEmail && assignedEmails.includes(userEmail)) {
      return true;
    }

    // 3. Học sinh có lớp khớp với lớp được giao
    if (hasClassRestriction && userClassNorm && assignedClasses.includes(userClassNorm)) {
      return true;
    }

    return false;
  });

  const filteredAvailableQuizzes = !availableSearchTerm
    ? matchedQuizzes
    : matchedQuizzes.filter((quiz) => {
        const term = availableSearchTerm.toLowerCase();
        return (
          quiz.title.toLowerCase().includes(term) ||
          quiz.subject.toLowerCase().includes(term) ||
          quiz.code.toLowerCase().includes(term) ||
          (quiz.teacherName || "").toLowerCase().includes(term)
        );
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
      {/* Top Section: Greeting on Left + Room Code Card on Right */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5 pb-6 border-b border-neutral-200">
        {/* Left: Chào User */}
        <div className="space-y-2 max-w-xl">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200/60">
            <span>Cổng học sinh</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-neutral-900 tracking-tight">
            Xin chào, {user?.name || user?.fullName || "Bạn học sinh"}
          </h1>
          <p className="text-xs sm:text-sm text-neutral-500 leading-relaxed">
            Các đề thi được thầy cô giao trực tiếp cho bạn qua Email hoặc Lớp sẽ tự động xuất hiện ở mục bên dưới. Bạn cũng có thể nhập mã phòng hoặc nhấn vào liên kết chia sẻ để vào thi.
          </p>
        </div>

        {/* Right: Card Tham gia phòng thi qua mã phòng 6 ký tự */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-sky-600 p-5 sm:p-6 text-white shadow-lg shadow-indigo-600/20 border border-blue-400/40 shrink-0 lg:max-w-lg w-full lg:w-auto">
          {/* Subtle Decorative Glow */}
          <div className="pointer-events-none absolute -right-6 -bottom-6 h-28 w-28 rounded-full bg-white/20 blur-xl" />
          <div className="pointer-events-none absolute -left-6 -top-6 h-24 w-24 rounded-full bg-sky-400/25 blur-lg" />

          <div className="relative z-10 space-y-3.5">
            <div className="flex items-center gap-2.5">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 backdrop-blur-xs text-white shadow-2xs">
                <KeyRound className="h-4.5 w-4.5" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight leading-snug">
                  Tham gia bằng mã phòng
                </h2>
                <p className="text-xs text-blue-100 mt-0.5">
                  Nhập mã 6 ký tự do thầy cô cung cấp để vào thi
                </p>
              </div>
            </div>

            <form onSubmit={handleJoinByCode} className="pt-1 flex flex-col sm:flex-row gap-2.5 items-center">
              <input
                id="room-code"
                type="text"
                placeholder="VD: QZ9821"
                maxLength={10}
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                className="h-11 w-full sm:w-52 rounded-xl border border-white/25 bg-white px-3.5 text-center font-mono text-sm sm:text-base font-bold uppercase tracking-wider text-neutral-900 placeholder:font-sans placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-neutral-400 focus:outline-hidden focus:ring-2 focus:ring-white/60 shadow-xs"
              />
              <button
                type="submit"
                className="h-11 w-full sm:w-auto px-5 rounded-xl bg-white text-indigo-700 hover:bg-blue-50 font-bold text-xs sm:text-sm shadow-sm flex items-center justify-center gap-2 transition cursor-pointer shrink-0"
              >
                <LogIn className="h-4 w-4 text-indigo-600" />
                <span>Vào phòng</span>
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

      {/* SECTION: ĐỀ THI ĐƯỢC GIAO CHO BẠN (Hiện thẳng lên đề đang mở, không cần nhập mã) */}
      <div className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-600" />
              <h2 className="text-xl font-bold text-neutral-900">
                Đề thi được giao cho bạn ({matchedQuizzes.length})
              </h2>
            </div>
            <p className="text-xs text-neutral-500 mt-0.5">
              Đề thi được thầy cô giao trực tiếp cho bạn qua Lớp hoặc Email. Nhấn vào bài để làm ngay!
            </p>
          </div>

          {/* Search & Refresh */}
          <div className="flex items-center gap-2">
            <div className="w-full sm:w-56">
              <Input
                placeholder="Tìm đề thi..."
                value={availableSearchTerm}
                onChange={(e) => setAvailableSearchTerm(e.target.value)}
                leftIcon={<Search className="h-3.5 w-3.5" />}
                className="h-9 text-xs"
              />
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadQuizzes()}
              isLoading={isQuizzesLoading}
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              className="h-9 text-xs shrink-0"
              title="Tải lại danh sách đề thi mới nhất"
            >
              Làm mới
            </Button>
          </div>
        </div>

        {/* Quizzes Grid */}
        {filteredAvailableQuizzes.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredAvailableQuizzes.map((quiz) => {
              const audienceBadge = getQuizAudienceBadge(quiz);
              const pastSubmissions = studentResults.filter((r) => r.quizId === quiz.id);
              const attemptsMade = pastSubmissions.length;
              const maxAttempts = quiz.settings.maxAttempts || 0;
              const isAttemptsExceeded = maxAttempts > 0 && attemptsMade >= maxAttempts;
              const activeSession = activeSessions[quiz.id];
              const isInProgress = isSessionInProgress(activeSession);

              return (
                <Card
                  key={quiz.id}
                  className="flex flex-col justify-between overflow-hidden border-indigo-100 hover:border-indigo-300 hover:shadow-md transition bg-white"
                >
                  <CardHeader className="pb-3 bg-neutral-50/70 border-b border-neutral-100">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <Badge variant="secondary" size="sm" className="font-semibold">
                        {quiz.subject}
                      </Badge>
                      {audienceBadge}
                    </div>

                    <CardTitle className="text-base font-bold text-neutral-900 line-clamp-2 leading-snug">
                      {quiz.title}
                    </CardTitle>

                    <p className="text-xs text-neutral-500 pt-0.5">
                      Giáo viên: <strong className="text-neutral-700">{quiz.teacherName || "Thầy Cô"}</strong>
                    </p>
                  </CardHeader>

                  <CardContent className="pt-3 pb-4 space-y-3.5 flex-1 flex flex-col justify-between">
                    <div className="space-y-2 text-xs text-neutral-600">
                      <div className="grid grid-cols-2 gap-2 bg-neutral-50 p-2.5 rounded-lg border border-neutral-100">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                          <span>
                            {quiz.settings.durationMinutes === 0
                              ? "Vô thời hạn"
                              : `${quiz.settings.durationMinutes} phút`}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <BookOpen className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                          <span>{quiz.totalQuestions} câu hỏi</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <KeyRound className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                          <span className="font-mono font-bold text-indigo-700">{quiz.code}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Award className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                          <span>{quiz.settings.passPercentage}% đạt</span>
                        </div>
                      </div>

                      {/* Attempts info */}
                      <div className="flex items-center justify-between text-[11px] text-neutral-500 px-0.5">
                        <span>
                          Số lượt đã làm: <strong className="text-neutral-800">{attemptsMade}</strong>
                          {maxAttempts > 0 && `/${maxAttempts}`}
                        </span>
                        {isAttemptsExceeded && (
                          <span className="text-amber-700 font-semibold">Hết lượt làm</span>
                        )}
                      </div>
                    </div>

                    {/* Action Button: Direct entry WITHOUT entering room code */}
                    <div>
                      {isInProgress ? (
                        <Button
                          variant="primary"
                          size="sm"
                          className="w-full font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs"
                          onClick={() => navigate(`/student/quiz/${quiz.id}`)}
                          leftIcon={<Play className="h-4 w-4 fill-current" />}
                        >
                          Tiếp tục làm bài
                        </Button>
                      ) : isAttemptsExceeded && pastSubmissions[0] ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full text-xs font-semibold"
                          onClick={() => navigate(`/student/result/${pastSubmissions[0].id}`)}
                          leftIcon={<Eye className="h-3.5 w-3.5" />}
                        >
                          Xem kết quả ({pastSubmissions[0].score.toFixed(2)}đ)
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          className="w-full font-bold bg-indigo-600 hover:bg-indigo-700 shadow-xs"
                          onClick={() => navigate(`/student/quiz/${quiz.id}/lobby`)}
                          leftIcon={<Play className="h-4 w-4 fill-current" />}
                        >
                          Vào thi ngay
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="text-center p-8 border-dashed border-neutral-200 bg-neutral-50/50">
            <BookOpen className="h-10 w-10 text-neutral-300 mx-auto mb-2" />
            <h3 className="text-base font-bold text-neutral-900">
              Chưa có đề thi nào được giao trực tiếp cho bạn
            </h3>
            <p className="text-xs text-neutral-500 mt-1 max-w-md mx-auto leading-relaxed">
              Nếu thầy cô cung cấp mã phòng thi hoặc liên kết chia sẻ, bạn hãy nhập mã ở khung bên trên hoặc mở link để tham gia làm bài như bình thường.
            </p>
            <div className="pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadQuizzes()}
                leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              >
                Kiểm tra lại dữ liệu
              </Button>
            </div>
          </Card>
        )}
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
              Bạn chưa hoàn thành bài thi nào. Nhập mã phòng hoặc chọn bài thi được giao bên trên để bắt đầu làm bài!
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
