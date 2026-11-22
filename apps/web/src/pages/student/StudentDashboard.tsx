import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Globe,
  GraduationCap,
  History,
  KeyRound,
  LogIn,
  Play,
  Search,
  Timer,
  TrendingUp,
} from "lucide-react";
import type { Classroom, StudentAssignmentItem } from "@qizzone/domain";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/hooks/useToast";
import { classroomService } from "@/services/classroomService";
import { useAuthStore } from "@/store/authStore";
import { isSessionInProgress, useExamSessionStore } from "@/store/examSessionStore";
import { useQuizStore } from "@/store/quizStore";

const HISTORY_PAGE_SIZE = 10;

function getWeekBounds(nowMs: number) {
  const current = new Date(nowMs);
  const day = current.getDay(); // 0 = Sun, 1 = Mon
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(current);
  start.setHours(0, 0, 0, 0);
  start.setDate(current.getDate() + diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

export function StudentDashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { quizzes, getQuizByCode, load: loadQuizzes } = useQuizStore();
  const { activeSessions, getResultsByStudent, checkAndAutoSubmitExpired } = useExamSessionStore();
  const toast = useToast();

  const [roomCode, setRoomCode] = useState("");
  const [historySearchTerm, setHistorySearchTerm] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [classroomAssignments, setClassroomAssignments] = useState<StudentAssignmentItem[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const studentResults = useMemo(
    () => (user ? getResultsByStudent(user.id) : []),
    [getResultsByStudent, user]
  );
  const publishedQuizzes = useMemo(
    () => quizzes.filter((q) => q.status === "published"),
    [quizzes]
  );

  useEffect(() => {
    void loadQuizzes().catch(() => {});
  }, [loadQuizzes]);

  useEffect(() => {
    void checkAndAutoSubmitExpired();
  }, [checkAndAutoSubmitExpired]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    Promise.all([
      classroomService.listStudentAssignments(),
      classroomService.listMyClassrooms(),
    ])
      .then(([assignmentItems, classroomItems]) => {
        if (cancelled) return;
        setClassroomAssignments(assignmentItems);
        setClassrooms(classroomItems.filter((item) => !item.isArchived));
      })
      .catch(() => {
        if (!cancelled) {
          setClassroomAssignments([]);
          setClassrooms([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const inProgressQuizzes = useMemo(
    () => publishedQuizzes.filter((q) => isSessionInProgress(activeSessions[q.id])),
    [activeSessions, publishedQuizzes]
  );

  const todoAssignments = useMemo(() => {
    return classroomAssignments
      .filter((item) => item.status !== "completed")
      .slice()
      .sort((a, b) => {
        const aDue = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
        const bDue = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
        if (aDue !== bDue) return aDue - bDue;
        const aAvail = a.availableFrom ? Date.parse(a.availableFrom) : 0;
        const bAvail = b.availableFrom ? Date.parse(b.availableFrom) : 0;
        return bAvail - aAvail;
      });
  }, [classroomAssignments]);

  const { weeklyTodoCount, totalTodoCount, newTodoCount } = useMemo(() => {
    const { startMs, endMs } = getWeekBounds(nowMs);
    const recentThresholdMs = nowMs - 48 * 60 * 60 * 1000;
    let weekly = 0;
    let newlyAdded = 0;

    for (const item of todoAssignments) {
      const dueMs = item.dueAt ? Date.parse(item.dueAt) : Number.NaN;
      const availMs = item.availableFrom ? Date.parse(item.availableFrom) : Number.NaN;
      const isDueThisWeek = Number.isFinite(dueMs) && dueMs >= startMs && dueMs < endMs;
      const isAvailableThisWeek = !Number.isFinite(dueMs) && (!Number.isFinite(availMs) || (availMs >= startMs && availMs < endMs));
      if (isDueThisWeek || isAvailableThisWeek) {
        weekly += 1;
      }
      const isRecentAvailable = Number.isFinite(availMs) && availMs >= recentThresholdMs;
      const isUntouchedTodo = item.status === "todo" && item.attemptCount === 0 && !item.hasActiveAttempt;
      if (isRecentAvailable || (!Number.isFinite(availMs) && isUntouchedTodo)) {
        newlyAdded += 1;
      }
    }

    return {
      weeklyTodoCount: weekly,
      totalTodoCount: todoAssignments.length,
      newTodoCount: newlyAdded,
    };
  }, [nowMs, todoAssignments]);

  const externalQuizCount = useMemo(() => {
    const classroomQuizIds = new Set(classroomAssignments.map((item) => item.quizId));
    return studentResults.filter((result) => !classroomQuizIds.has(result.quizId)).length;
  }, [classroomAssignments, studentResults]);

  const nearestTodoAssignments = useMemo(() => todoAssignments.slice(0, 2), [todoAssignments]);
  const topInProgressQuizzes = useMemo(() => inProgressQuizzes.slice(0, 2), [inProgressQuizzes]);

  const filteredHistory = useMemo(() => {
    const term = historySearchTerm.trim().toLowerCase();
    if (!term) return studentResults;
    return studentResults.filter((result) => (
      result.quizTitle.toLowerCase().includes(term) ||
      result.subject.toLowerCase().includes(term) ||
      result.roomCode.toLowerCase().includes(term)
    ));
  }, [historySearchTerm, studentResults]);

  const totalHistoryPages = Math.max(1, Math.ceil(filteredHistory.length / HISTORY_PAGE_SIZE));
  const safeHistoryPage = Math.min(historyPage, totalHistoryPages);
  const paginatedHistory = useMemo(() => {
    const start = (safeHistoryPage - 1) * HISTORY_PAGE_SIZE;
    return filteredHistory.slice(start, start + HISTORY_PAGE_SIZE);
  }, [filteredHistory, safeHistoryPage]);

  const handleJoinByCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanCode = roomCode.trim().toUpperCase();

    if (!cleanCode) {
      toast.error("Vui lòng nhập mã phòng thi (VD: QZ9821)");
      return;
    }

    let quiz = getQuizByCode(cleanCode);
    if (!quiz) {
      try {
        await loadQuizzes();
      } catch {
        toast.error("Không thể tải danh sách đề thi. Vui lòng thử lại.");
        return;
      }
      quiz = getQuizByCode(cleanCode);
    }

    if (!quiz) {
      toast.error(`Không tìm thấy phòng thi có mã "${cleanCode}"`);
      return;
    }

    if (quiz.status !== "published") {
      toast.warning("Phòng thi này chưa được mở bởi Giáo viên");
      return;
    }

    const existingSession = activeSessions[quiz.id];
    if (isSessionInProgress(existingSession)) {
      navigate(`/student/quiz/${quiz.id}`);
      return;
    }

    navigate(`/student/quiz/${quiz.id}/lobby`);
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Top Section: Greeting on Left + Room Code Card on Right */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5 pb-6 border-b theme-border">
        <div className="space-y-2 max-w-xl">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200/60">
            <span>Cổng học sinh</span>
          </div>
          <h1 className="page-heading">
            Xin chào, {user?.name || user?.fullName || "Bạn học sinh"}
          </h1>
          <p className="text-xs sm:text-sm theme-text-muted leading-relaxed">
            Theo dõi nhanh bài tập tuần này, lớp học đã tham gia, bài đang làm dở và lịch sử kết quả của bạn.
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-teal-600 to-sky-600 p-5 sm:p-6 text-white shadow-lg shadow-teal-600/20 border border-blue-400/40 shrink-0 lg:max-w-lg w-full lg:w-auto">
          <div className="pointer-events-none absolute -right-6 -bottom-6 h-28 w-28 rounded-full theme-surface blur-xl" />
          <div className="pointer-events-none absolute -left-6 -top-6 h-24 w-24 rounded-full bg-sky-400/25 blur-lg" />

          <div className="relative z-10 space-y-3.5">
            <div className="flex items-center gap-2.5">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl theme-surface backdrop-blur-xs text-white shadow-2xs">
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
                className="theme-light-control h-11 w-full sm:w-52 rounded-xl border border-white/25 theme-surface px-3.5 text-center font-mono text-sm sm:text-base font-bold uppercase tracking-wider theme-text-primary placeholder:font-sans placeholder:font-normal placeholder:normal-case placeholder:tracking-normal theme-placeholder-muted focus:outline-hidden focus:ring-2 focus:ring-white/60 shadow-xs"
              />
              <button
                type="submit"
                className="theme-light-control theme-light-control-button h-11 w-full sm:w-auto px-5 rounded-xl theme-surface text-teal-700 hover:bg-blue-50 font-bold text-xs sm:text-sm shadow-sm flex items-center justify-center gap-2 transition cursor-pointer shrink-0"
              >
                <LogIn className="h-4 w-4 text-teal-700" />
                <span>Vào phòng thi</span>
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* 3 Summary Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5 flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs font-semibold theme-text-muted">Số bài cần làm trong tuần</p>
              <div className="flex items-center gap-2">
                <p className="text-2xl font-extrabold text-blue-700 font-mono">
                  {weeklyTodoCount}
                </p>
                {newTodoCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                    <TrendingUp className="h-3 w-3" aria-hidden="true" />
                    +{newTodoCount}
                  </span>
                )}
              </div>
              <p className="text-xs theme-text-secondary">
                Trong tuần: <strong className="theme-text-primary">{weeklyTodoCount}</strong> · Tổng cần làm:{" "}
                <strong className="theme-text-primary">{totalTodoCount}</strong>
              </p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
              <CalendarClock className="h-5 w-5" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs font-semibold theme-text-muted">Số lớp đã tham gia</p>
              <p className="text-2xl font-extrabold text-emerald-700 font-mono">
                {classrooms.length}
              </p>
              <Link
                to="/student/classes"
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900"
              >
                <span>Xem lớp học</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <GraduationCap className="h-5 w-5" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs font-semibold theme-text-muted">Số bài làm ngoài lớp</p>
              <p className="text-2xl font-extrabold text-teal-700 font-mono">
                {externalQuizCount}
              </p>
              <p className="text-xs theme-text-secondary">
                Bài thi tự do hoặc qua mã phòng
              </p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <Globe className="h-5 w-5" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 2-Column Section: 2 Nearest Todo Assignments | 2 In-Progress Quizzes */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: 2 Nearest Todo Assignments */}
        <section className="space-y-3" aria-labelledby="nearest-assignments-heading">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-blue-700" aria-hidden="true" />
              <h2 id="nearest-assignments-heading" className="text-lg font-bold theme-text-primary">
                Bài tập gần nhất cần làm
              </h2>
            </div>
            <Link
              to="/student/classes"
              className="text-xs font-semibold text-blue-700 hover:text-blue-900"
            >
              Xem tất cả ({todoAssignments.length})
            </Link>
          </div>

          {nearestTodoAssignments.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm theme-text-secondary">
                Không có bài tập lớp nào cần làm ngay lúc này.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {nearestTodoAssignments.map((assignment) => {
                const isOverdue = assignment.status === "overdue";
                const href = `/student/quiz/${assignment.quizId}/lobby?assignmentId=${encodeURIComponent(assignment.assignmentId)}`;
                return (
                  <Card key={assignment.assignmentId}>
                    <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium theme-text-muted">
                            {assignment.classroomName}
                          </span>
                          <Badge variant={isOverdue ? "destructive" : "success"} size="sm">
                            {isOverdue ? "Quá hạn" : "Cần làm"}
                          </Badge>
                        </div>
                        <h3 className="truncate font-semibold theme-text-primary">
                          {assignment.title || assignment.quizTitle}
                        </h3>
                        <p className="text-xs theme-text-secondary">
                          {assignment.dueAt
                            ? `Hạn nộp: ${new Date(assignment.dueAt).toLocaleString("vi-VN")}`
                            : "Chưa đặt hạn nộp"}
                        </p>
                      </div>
                      <Link
                        to={href}
                        className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800"
                      >
                        Làm bài
                      </Link>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* Right: 2 In-Progress Quizzes */}
        <section className="space-y-3" aria-labelledby="in-progress-heading">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Timer className="h-5 w-5 text-amber-600" aria-hidden="true" />
              <h2 id="in-progress-heading" className="text-lg font-bold theme-text-primary">
                Bài đang làm dở
              </h2>
            </div>
            <span className="text-xs font-medium theme-text-muted">
              {inProgressQuizzes.length} bài đang làm
            </span>
          </div>

          {topInProgressQuizzes.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm theme-text-secondary">
                Bạn không có bài thi nào đang làm dở.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {topInProgressQuizzes.map((quiz) => {
                const activeSession = activeSessions[quiz.id];
                const answeredCount = Object.keys(activeSession?.answers || {}).length;
                return (
                  <Card key={quiz.id} className="border-amber-300/70">
                    <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" size="sm">
                            {quiz.subject}
                          </Badge>
                          <Badge variant="warning" size="sm" dot>
                            Đang làm ({answeredCount}/{quiz.totalQuestions} câu)
                          </Badge>
                        </div>
                        <h3 className="truncate font-semibold theme-text-primary">{quiz.title}</h3>
                        <p className="text-xs theme-text-secondary">
                          Mã phòng: <strong className="font-mono text-teal-700">{quiz.code}</strong> ·{" "}
                          {quiz.settings.durationMinutes > 0
                            ? `${quiz.settings.durationMinutes} phút`
                            : "Không giới hạn"}
                        </p>
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        className="shrink-0 bg-amber-600 text-white hover:bg-amber-700"
                        onClick={() => navigate(`/student/quiz/${quiz.id}`)}
                        leftIcon={<Play className="h-4 w-4 fill-current" />}
                      >
                        Tiếp tục
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* History Section with 10 items/page pagination */}
      <div className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-xl font-bold theme-text-primary flex items-center gap-2">
            <History className="h-5 w-5 text-teal-700" />
            <span>Lịch sử các bài thi đã hoàn thành ({filteredHistory.length})</span>
          </h2>

          {studentResults.length > 0 && (
            <div className="w-full sm:max-w-xs">
              <Input
                placeholder="Tìm theo tên bài, mã phòng..."
                value={historySearchTerm}
                onChange={(e) => {
                  setHistorySearchTerm(e.target.value);
                  setHistoryPage(1);
                }}
                leftIcon={<Search className="h-4 w-4" />}
              />
            </div>
          )}
        </div>

        {studentResults.length === 0 ? (
          <Card className="text-center p-8 border-dashed">
            <p className="text-sm theme-text-muted">
              Bạn chưa hoàn thành bài thi nào. Nhập mã phòng hoặc vào lớp học để bắt đầu làm bài!
            </p>
          </Card>
        ) : filteredHistory.length > 0 ? (
          <div className="space-y-4">
            <Card className="overflow-hidden">
              <div className="divide-y divide-neutral-100">
                {paginatedHistory.map((result) => (
                  <div
                    key={result.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:px-6 theme-hover-surface transition"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" size="sm">
                          {result.subject}
                        </Badge>
                        <h4 className="font-bold text-sm theme-text-primary">
                          {result.quizTitle}
                        </h4>
                      </div>
                      <p className="text-xs theme-text-muted">
                        Nộp bài lúc: {new Date(result.submittedAt).toLocaleString("vi-VN")} · Mã phòng:{" "}
                        <span className="font-mono text-teal-700 font-bold">{result.roomCode}</span>
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        {result.scoreHidden || result.score === null ? (
                          <>
                            <span className="text-sm font-bold theme-text-muted">
                              Đã ẩn điểm
                            </span>
                            <p className="text-[11px] theme-text-muted font-medium">
                              {result.totalQuestions} câu hỏi
                            </p>
                          </>
                        ) : (
                          <>
                            <span
                              className={`text-lg font-black font-mono ${
                                result.isPassed ? "text-emerald-600" : "text-rose-600"
                              }`}
                            >
                              {result.score.toFixed(2)} / 10 đ
                            </span>
                            <p className="text-[11px] theme-text-muted font-medium">
                              Đúng {result.correctCount ?? "—"}/{result.totalQuestions} câu (
                              {result.percentage ?? 0}%)
                            </p>
                          </>
                        )}
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

            {totalHistoryPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs theme-text-muted">
                  Hiển thị {(safeHistoryPage - 1) * HISTORY_PAGE_SIZE + 1}–
                  {Math.min(safeHistoryPage * HISTORY_PAGE_SIZE, filteredHistory.length)} / {filteredHistory.length} bài
                </p>
                <div className="flex items-center gap-2" role="navigation" aria-label="Phân trang lịch sử bài thi">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safeHistoryPage <= 1}
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    leftIcon={<ChevronLeft className="h-4 w-4" />}
                  >
                    Trước
                  </Button>
                  <span className="text-xs font-semibold theme-text-secondary px-2">
                    Trang {safeHistoryPage} / {totalHistoryPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safeHistoryPage >= totalHistoryPages}
                    onClick={() => setHistoryPage((p) => Math.min(totalHistoryPages, p + 1))}
                    rightIcon={<ChevronRight className="h-4 w-4" />}
                  >
                    Sau
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Card className="text-center p-8">
            <p className="text-sm theme-text-muted">
              Không tìm thấy kết quả nào phù hợp với từ khóa &ldquo;{historySearchTerm}&rdquo;.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

export default StudentDashboard;
