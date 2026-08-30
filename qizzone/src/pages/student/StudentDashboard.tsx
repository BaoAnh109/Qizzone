import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  LogIn,
  BookOpen,
  Clock,
  Award,
  Sparkles,
  Search,
  CheckCircle2,
  ArrowRight,
  Play,
  TrendingUp,
  History,
  Timer,
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
  const [searchTerm, setSearchTerm] = useState("");

  const studentResults = user ? getResultsByStudent(user.id) : [];
  const publishedQuizzes = quizzes.filter((q) => q.status === "published");

  // Auto-finalize any expired exam sessions when visiting dashboard
  useEffect(() => {
    if (publishedQuizzes.length > 0) {
      checkAndAutoSubmitExpired(publishedQuizzes);
    }
  }, [publishedQuizzes, checkAndAutoSubmitExpired]);

  // In-progress active sessions count (only valid within time)
  const inProgressQuizzes = publishedQuizzes.filter((q) => {
    const s = activeSessions[q.id];
    return isSessionInProgress(s);
  });

  const filteredQuizzes = publishedQuizzes.filter((q) => {
    return (
      q.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.code.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const handleJoinByCode = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanCode = roomCode.trim().toUpperCase();

    if (!cleanCode) {
      toast.error("Vui lòng nhập mã phòng thi 6 ký tự (VD: QZ9821)");
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

  return (
    <div className="space-y-8 pb-16">
      {/* Header Welcome Banner */}
      <div className="flex flex-col justify-between gap-6 rounded-3xl bg-linear-to-r from-indigo-900 via-indigo-800 to-violet-900 p-6 sm:p-8 text-white shadow-xl shadow-indigo-950/10 md:flex-row md:items-center">
        <div className="space-y-2 max-w-xl">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-indigo-200 backdrop-blur-xs">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Cổng thi trực tuyến Học sinh</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Xin chào, {user?.name || user?.fullName || "Bạn học sinh"}! 🎓
          </h1>
          <p className="text-xs sm:text-sm text-indigo-200/90 leading-relaxed">
            Nhập mã phòng thi từ Thầy/Cô hoặc chọn bài thi đang mở để bắt đầu thử sức và xem kết quả tức thì.
          </p>
        </div>

        {/* 1-Click Join Room Code Box */}
        <div className="w-full md:max-w-xs rounded-2xl bg-white/10 p-4 backdrop-blur-md border border-white/20 shadow-lg space-y-3">
          <label className="text-xs font-bold uppercase tracking-wider text-indigo-200 block">
            Tham gia phòng thi bằng mã:
          </label>
          <form onSubmit={handleJoinByCode} className="space-y-2">
            <input
              type="text"
              placeholder="VD: QZ9821"
              maxLength={6}
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              className="w-full text-center font-mono font-black text-lg tracking-widest uppercase rounded-xl bg-white text-neutral-900 placeholder:text-neutral-400 py-2.5 px-3 focus:outline-hidden focus:ring-2 focus:ring-white shadow-inner"
            />
            <Button
              type="submit"
              variant="default"
              className="w-full bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-sm h-10 shadow-sm"
              leftIcon={<LogIn className="h-4 w-4" />}
            >
              Vào phòng thi ngay
            </Button>
          </form>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card hoverEffect>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-neutral-500">Phòng thi đang mở</p>
              <p className="text-2xl font-extrabold text-indigo-900 mt-1 font-mono">
                {publishedQuizzes.length}
              </p>
            </div>
            <div className="h-11 w-11 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <BookOpen className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card hoverEffect className={inProgressQuizzes.length > 0 ? "border-amber-300 bg-amber-50/20" : ""}>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-neutral-500">Bài đang làm dở</p>
              <p className="text-2xl font-extrabold text-amber-700 mt-1 font-mono">
                {inProgressQuizzes.length}
              </p>
            </div>
            <div className="h-11 w-11 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <Timer className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card hoverEffect>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-neutral-500">Bài đã hoàn thành</p>
              <p className="text-2xl font-extrabold text-emerald-900 mt-1 font-mono">
                {studentResults.length}
              </p>
            </div>
            <div className="h-11 w-11 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card hoverEffect>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-neutral-500">Điểm trung bình</p>
              <p className="text-2xl font-extrabold text-violet-900 mt-1 font-mono">
                {studentResults.length > 0
                  ? (
                      studentResults.reduce((s, r) => s + r.score, 0) /
                      studentResults.length
                    ).toFixed(1) + " đ"
                  : "--"}
              </p>
            </div>
            <div className="h-11 w-11 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center">
              <TrendingUp className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Available Quizzes Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-indigo-600" />
              <span>Phòng thi sẵn sàng tham gia</span>
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Chọn đề thi để vào sảnh chuẩn bị hoặc tiếp tục làm bài đang dở.
            </p>
          </div>

          <div className="w-full sm:max-w-xs">
            <Input
              placeholder="Tìm theo tên đề, mã phòng..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              leftIcon={<Search className="h-4 w-4" />}
            />
          </div>
        </div>

        {filteredQuizzes.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filteredQuizzes.map((quiz) => {
              const activeSession = activeSessions[quiz.id];
              const isInProgress = isSessionInProgress(activeSession);
              const answeredCount = isInProgress
                ? Object.keys(activeSession?.answers || {}).length
                : 0;

              const latestResult = studentResults.find((r) => r.quizId === quiz.id);

              return (
                <Card
                  key={quiz.id}
                  hoverEffect
                  className={`flex flex-col justify-between overflow-hidden transition ${
                    isInProgress
                      ? "border-amber-300 ring-2 ring-amber-400/20 bg-amber-50/10 shadow-sm"
                      : latestResult
                      ? "border-emerald-200/90 shadow-2xs"
                      : "border-neutral-200/90 shadow-xs"
                  }`}
                >
                  <CardHeader className={`pb-3 ${isInProgress ? "bg-amber-50/50" : "bg-neutral-50/40"}`}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <Badge variant="secondary" size="sm">
                        {quiz.subject}
                      </Badge>

                      {/* Trạng thái bài thi: Đang làm dở / Đã nộp / Mã phòng */}
                      {isInProgress ? (
                        <Badge variant="warning" size="sm" dot className="font-bold animate-pulse">
                          Đang làm ({answeredCount}/{quiz.totalQuestions})
                        </Badge>
                      ) : latestResult ? (
                        <Badge
                          variant={latestResult.isPassed ? "success" : "destructive"}
                          size="sm"
                          dot
                        >
                          Đã nộp ({latestResult.score.toFixed(1)}đ)
                        </Badge>
                      ) : (
                        <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                          {quiz.code}
                        </span>
                      )}
                    </div>

                    <CardTitle className="text-base line-clamp-2 leading-snug font-bold text-neutral-900">
                      {quiz.title}
                    </CardTitle>
                  </CardHeader>

                  <CardContent className="pt-3 space-y-4 flex-1 flex flex-col justify-between">
                    <div className="grid grid-cols-2 gap-2 text-xs text-neutral-500 py-1">
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-neutral-400" />
                        <span>
                          {quiz.settings.durationMinutes === 0
                            ? "Vô thời hạn"
                            : `${quiz.settings.durationMinutes} phút`}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Award className="h-3.5 w-3.5 text-neutral-400" />
                        <span>{quiz.totalQuestions} câu hỏi</span>
                      </div>
                    </div>

                    {/* Action Button: Tiếp tục làm bài / Vào sảnh / Xem kết quả */}
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
                    ) : latestResult ? (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 text-xs font-medium"
                          onClick={() => navigate(`/student/result/${latestResult.id}`)}
                        >
                          Xem kết quả
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-1 text-xs text-indigo-600 hover:bg-indigo-50 font-medium"
                          onClick={() => navigate(`/student/quiz/${quiz.id}/lobby`)}
                        >
                          Làm lại
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
                        className="w-full font-semibold"
                        onClick={() => navigate(`/student/quiz/${quiz.id}/lobby`)}
                        rightIcon={<ArrowRight className="h-4 w-4" />}
                      >
                        Vào sảnh thi
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="text-center p-8">
            <p className="text-sm text-neutral-500">
              Chưa có phòng thi nào đang mở phù hợp với từ khóa tìm kiếm.
            </p>
          </Card>
        )}
      </div>

      {/* Exam History Section */}
      {studentResults.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-neutral-200">
          <h2 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
            <History className="h-5 w-5 text-indigo-600" />
            <span>Lịch sử các bài thi đã hoàn thành</span>
          </h2>

          <Card className="overflow-hidden">
            <div className="divide-y divide-neutral-100">
              {studentResults.map((result) => (
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
                        {result.score.toFixed(1)} / 10 đ
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
        </div>
      )}
    </div>
  );
}

export default StudentDashboard;
