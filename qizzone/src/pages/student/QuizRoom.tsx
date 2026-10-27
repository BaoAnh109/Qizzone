import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  Clock,
  Send,
  Flag,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudCheck,
  CloudOff,
  CheckCircle2,
  AlertCircle,
  ListChecks,
  RotateCcw,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useQuizStore } from "@/store/quizStore";
import { useExamSessionStore } from "@/store/examSessionStore";
import { useExamTimer } from "@/hooks/useExamTimer";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MathRenderer } from "@/components/common/MathRenderer";
import { QuestionFrame } from "@/components/student/QuestionFrame";
import { SubmitConfirmModal } from "@/components/student/SubmitConfirmModal";
import { useToast } from "@/hooks/useToast";
import type { OptionId, Question } from "@/types/quiz";

function cleanStudentName(rawName?: string): string {
  if (!rawName) return "Học sinh";
  return rawName.replace(/^(Em|Học sinh|Thầy|Cô)\s+/i, "").trim() || rawName;
}

export function QuizRoom() {
  const { quizId } = useParams();
  const [searchParams] = useSearchParams();
  const retryMode = searchParams.get("mode");
  const sourceResultId = searchParams.get("sourceResultId");
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const getQuizById = useQuizStore((state) => state.getQuizById);

  // Direct reactive Zustand selectors
  const activeSessions = useExamSessionStore((state) => state.activeSessions);
  const selectAnswer = useExamSessionStore((state) => state.selectAnswer);
  const toggleFlagQuestion = useExamSessionStore((state) => state.toggleFlagQuestion);
  const clearAnswer = useExamSessionStore((state) => state.clearAnswer);
  const setQuestionIndex = useExamSessionStore((state) => state.setQuestionIndex);
  const submitExam = useExamSessionStore((state) => state.submitExam);
  const initSession = useExamSessionStore((state) => state.initSession);
  const flushSession = useExamSessionStore((state) => state.flushSession);
  const isSubmitting = useExamSessionStore((state) => state.isSubmitting);
  const getResultById = useExamSessionStore((state) => state.getResultById);
  const saveStatus = useExamSessionStore((state) => quizId ? state.saveStatus[quizId] || 'idle' : 'idle');

  const toast = useToast();

  const quiz = quizId ? getQuizById(quizId) : undefined;
  const session = quizId ? activeSessions[quizId] : undefined;

  const sourceResult = sourceResultId ? getResultById(sourceResultId) : undefined;
  const incorrectQuestionIds = useMemo(() => {
    if (retryMode !== "retry_incorrect" || !sourceResult) return null;
    return sourceResult.details.filter((d) => !d.isCorrect).map((d) => d.questionId);
  }, [retryMode, sourceResult]);

  // Auto-init session on mount if not exists
  useEffect(() => {
    if (quiz && !session) {
      void initSession({
        quiz,
        studentId: user?.id || "guest-student",
        studentName: cleanStudentName(user?.fullName || user?.name),
      });
    }
  }, [quiz, session, initSession, user]);

  const currentIndex = session?.currentQuestionIndex || 0;
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [isNavigatorCollapsed, setIsNavigatorCollapsed] = useState(false);

  useEffect(() => {
    if (!quizId) return;
    const flush = () => { void flushSession(quizId).catch(() => undefined); };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', flush);
    return () => {
      flush();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', flush);
    };
  }, [quizId, flushSession]);

  const questions: Question[] = useMemo(() => {
    if (!quiz) return [];
    let baseList = quiz.questions;
    if (incorrectQuestionIds && incorrectQuestionIds.length > 0) {
      baseList = baseList.filter((q) => incorrectQuestionIds.includes(q.id));
    }
    const order = session?.questionOrder
      ? session.questionOrder.filter((id) => baseList.some((q) => q.id === id))
      : baseList.map((question) => question.id);
    return order.flatMap((id) => {
      const question = baseList.find((item) => item.id === id);
      if (!question) return [];
      const optionOrder = session?.optionOrder?.[question.id];
      if (!optionOrder) return [question];
      return [{
        ...question,
        options: optionOrder.flatMap((optionId) => {
          const option = question.options.find((item) => item.id === optionId);
          return option ? [option] : [];
        }),
      }];
    });
  }, [quiz, session, incorrectQuestionIds]);

  const currentQuestion: Question | undefined = questions[currentIndex];

  const currentAnswers: OptionId[] =
    session && currentQuestion ? session.answers[currentQuestion.id] || [] : [];

  const isCurrentFlagged =
    session && currentQuestion
      ? (session.flaggedQuestionIds || []).includes(currentQuestion.id)
      : false;

  // Submit Handler
  const handleFinalSubmit = useCallback(async () => {
    if (!quiz || !session) return;
    try {
      const result = await submitExam({
        quiz,
        studentId: session.studentId,
        studentName: session.studentName,
        studentClass: session.studentClass,
      });

      toast.success("Nộp bài thi thành công!");
      setIsSubmitModalOpen(false);
      navigate(`/student/result/${result.id}`, { replace: true });
    } catch {
      toast.error("Có lỗi xảy ra khi nộp bài. Vui lòng thử lại!");
    }
  }, [quiz, session, submitExam, toast, navigate]);

  // Resilient Timer
  const { formattedTime, isWarning, isCritical, isUnlimited } = useExamTimer({
    startTime: session?.startTime || 0,
    durationMinutes: quiz?.settings.durationMinutes ?? 45,
    onTimeUp: () => {
      toast.warning("Hết giờ làm bài! Hệ thống tự động nộp bài.", "Hết thời gian");
      handleFinalSubmit();
    },
  });

  // Handle Option Select
  const handleSelectOption = (optId: OptionId) => {
    if (!quiz || !currentQuestion) return;
    selectAnswer({
      quizId: quiz.id,
      questionId: currentQuestion.id,
      optionId: optId,
      isMultipleChoice: currentQuestion.type === "multiple_choice",
    });
  };

  const handleToggleFlag = () => {
    if (!quiz || !currentQuestion) return;
    toggleFlagQuestion(quiz.id, currentQuestion.id);
  };

  const handleClearCurrent = () => {
    if (!quiz || !currentQuestion) return;
    clearAnswer(quiz.id, currentQuestion.id);
  };

  if (!quiz || !session) {
    return (
      <div className="text-center py-20 space-y-4">
        <AlertCircle className="h-10 w-10 text-rose-600 mx-auto" />
        <h2 className="text-xl font-bold text-neutral-900">
          Đang khởi tạo bài thi...
        </h2>
        <Button variant="outline" onClick={() => navigate("/student")}>
          Quay về sảnh chính
        </Button>
      </div>
    );
  }

  const answeredCount = Object.keys(session.answers || {}).length;
  const flaggedCount = session.flaggedQuestionIds?.length || 0;

  return (
    <div className="flex flex-col min-h-screen bg-neutral-100/60 pb-12">
      {/* Top Fixed Exam Header Bar */}
      <header className="sticky top-0 z-40 theme-surface-raised backdrop-blur-md border-b theme-border shadow-2xs">
        <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
          {/* Quiz Title & Subject */}
          <div className="flex items-center gap-3 min-w-0">
            <Badge variant="secondary" size="sm" className="hidden sm:inline-flex">
              {quiz.subject}
            </Badge>
            <h1 className="font-bold text-sm sm:text-base text-neutral-900 truncate">
              {quiz.title}
            </h1>
          </div>

          {/* Center / Right Toolbar: Timer, Cloud Save, Submit */}
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            {/* Auto-Save Buffer Cloud Icon */}
            <div
              title={saveStatus === 'error' ? 'Chưa thể lưu. Hệ thống sẽ thử lại khi có mạng.' : 'Đáp án được lưu tự động'}
              className={`items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border hidden md:flex ${
                saveStatus === 'error'
                  ? 'text-rose-700 bg-rose-50 border-rose-200'
                  : saveStatus === 'saving'
                    ? 'text-amber-700 bg-amber-50 border-amber-200'
                    : 'text-emerald-600 bg-emerald-50 border-emerald-100'
              }`}
            >
              {saveStatus === 'error' ? (
                <CloudOff className="h-4 w-4" />
              ) : saveStatus === 'saving' ? (
                <Cloud className="h-4 w-4 animate-pulse" />
              ) : (
                <CloudCheck className="h-4 w-4" />
              )}
              <span>{saveStatus === 'error' ? 'Lỗi lưu' : saveStatus === 'saving' ? 'Đang lưu...' : 'Đã lưu'}</span>
            </div>

            {/* Countdown Timer Badge */}
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono text-sm font-bold border transition ${
                isCritical
                  ? "bg-rose-50 border-rose-300 text-rose-700 animate-pulse"
                  : isWarning
                  ? "bg-amber-50 border-amber-300 text-amber-800"
                  : "bg-indigo-50 border-indigo-200 text-indigo-950"
              }`}
            >
              <Clock
                className={`h-4 w-4 ${
                  isCritical
                    ? "text-rose-600"
                    : isWarning
                    ? "text-amber-600"
                    : "text-indigo-600"
                }`}
              />
              <span>{isUnlimited ? `∞ ${formattedTime}` : formattedTime}</span>
            </div>

            {/* Submit Button */}
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsSubmitModalOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-700 font-bold shadow-xs px-3 sm:px-4"
              leftIcon={<Send className="h-3.5 w-3.5" />}
            >
              Nộp bài
            </Button>
          </div>
        </div>
      </header>

      {/* Main Exam Body: 2 Columns (Question Area + Question Navigator) */}
      <main className="w-full px-4 sm:px-6 lg:px-8 py-6 flex-1">
        <div className={isNavigatorCollapsed
          ? "grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_3rem]"
          : "grid grid-cols-1 items-start gap-6 lg:grid-cols-12"}>
          {/* LEFT: Current Question Content & Options (8 cols) */}
          <div className={isNavigatorCollapsed ? "min-w-0 space-y-4" : "min-w-0 space-y-4 lg:col-span-8"}>
            {incorrectQuestionIds && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 px-4 text-xs text-amber-900 flex items-center justify-between font-medium shadow-2xs">
                <span>Chế độ luyện tập: Làm lại các câu sai ({questions.length} câu)</span>
                <Badge variant="warning" size="sm">Làm lại câu sai</Badge>
              </div>
            )}
            {currentQuestion ? (
              <QuestionFrame
                questionNumber={currentIndex + 1}
                questionCount={questions.length}
                headerMeta={(
                  <span className="text-xs text-neutral-400">
                    ({Number((currentQuestion.points || 1).toFixed(2))} điểm)
                  </span>
                )}
                headerActions={(
                  <>
                    <button
                      type="button"
                      onClick={handleToggleFlag}
                      className={isCurrentFlagged
                        ? "flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-950 ring-2 ring-amber-400/40 shadow-xs transition cursor-pointer"
                        : "flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-600 transition hover:border-neutral-300 hover:bg-neutral-50 cursor-pointer"}
                    >
                      <Flag className={isCurrentFlagged
                        ? "h-3.5 w-3.5 fill-amber-500 text-amber-600"
                        : "h-3.5 w-3.5 text-neutral-400"} />
                      <span>{isCurrentFlagged ? "Đã gắn cờ" : "Gắn cờ"}</span>
                    </button>

                    {currentAnswers.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearCurrent}
                        title="Bỏ chọn đáp án"
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-neutral-500 transition hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Bỏ chọn</span>
                      </button>
                    )}
                  </>
                )}
                prompt={<MathRenderer content={currentQuestion.content} />}
                footer={(
                  <div className="flex items-center justify-between border-t border-neutral-100 pt-6">
                    <Button
                      variant="outline"
                      disabled={currentIndex === 0}
                      onClick={() => setQuestionIndex(quiz.id, Math.max(0, currentIndex - 1))}
                      leftIcon={<ChevronLeft className="h-4 w-4" />}
                    >
                      Câu trước
                    </Button>

                    {currentIndex < questions.length - 1 ? (
                      <Button
                        variant="primary"
                        onClick={() => setQuestionIndex(quiz.id, Math.min(questions.length - 1, currentIndex + 1))}
                        rightIcon={<ChevronRight className="h-4 w-4" />}
                      >
                        Câu tiếp theo
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        onClick={() => setIsSubmitModalOpen(true)}
                        leftIcon={<Send className="h-4 w-4" />}
                        className="bg-emerald-600 hover:bg-emerald-700 font-bold"
                      >
                        Hoàn tất &amp; Nộp bài
                      </Button>
                    )}
                  </div>
                )}
              >
                {currentQuestion.options.map((opt, index) => {
                  const isSelected = currentAnswers.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSelectOption(opt.id)}
                      className={isSelected
                        ? "flex w-full cursor-pointer items-start gap-4 rounded-lg border border-blue-600 bg-blue-50 p-4 text-left ring-2 ring-blue-100 transition-colors sm:p-5"
                        : "flex w-full cursor-pointer items-start gap-4 rounded-lg border border-neutral-200 bg-white p-4 text-left transition-colors hover:border-indigo-300 hover:bg-neutral-50/80 sm:p-5"}
                    >
                      <span
                        className={isSelected
                          ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-indigo-600 text-xs font-bold text-white shadow-2xs transition sm:text-sm"
                          : "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-neutral-100 text-xs font-bold text-neutral-700 transition sm:text-sm"}
                      >
                        {String.fromCharCode(65 + index)}
                      </span>

                      <div className="flex-1 pt-0.5 text-sm font-normal text-neutral-900 sm:text-base">
                        <MathRenderer content={opt.content} />
                      </div>

                      {isSelected && (
                        <CheckCircle2 className="ml-auto mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
                      )}
                    </button>
                  );
                })}
              </QuestionFrame>
            ) : null}
          </div>

          {/* RIGHT: Question Matrix Navigator (4 cols) */}
          <aside id="quiz-question-navigator" className={isNavigatorCollapsed ? "ml-auto w-12 lg:ml-0" : "space-y-4 lg:col-span-4"}>
            {isNavigatorCollapsed ? (
              <button
                type="button"
                onClick={() => setIsNavigatorCollapsed(false)}
                aria-label="Mở danh sách câu hỏi"
                aria-controls="quiz-question-navigator"
                aria-expanded="false"
                title="Mở danh sách câu hỏi"
                className="flex min-h-32 w-full flex-col items-center gap-3 rounded-xl border theme-border theme-surface px-2 py-4 theme-text-secondary shadow-xs transition-colors hover:bg-neutral-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 lg:min-h-[32rem]"
              >
                <PanelRightOpen className="h-4 w-4 shrink-0" />
                <span className="[writing-mode:vertical-rl] text-xs font-semibold tracking-wide">Danh sách câu hỏi</span>
              </button>
            ) : (
              <Card className="border-neutral-200/90 shadow-xs bg-white">
                <CardHeader className="pb-3 border-b border-neutral-100">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex min-w-0 items-center gap-1.5 text-sm font-bold sm:text-base">
                      <ListChecks className="h-4 w-4 shrink-0 text-blue-600" />
                      <span className="truncate">Danh sách câu hỏi</span>
                    </CardTitle>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="text-xs font-semibold text-neutral-500">
                        {answeredCount}/{questions.length} đã làm
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 shrink-0 p-0"
                        onClick={() => setIsNavigatorCollapsed(true)}
                        aria-label="Thu nhỏ danh sách câu hỏi"
                        aria-controls="quiz-question-navigator"
                        aria-expanded="true"
                        title="Thu nhỏ danh sách câu hỏi"
                      >
                        <PanelRightClose className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-4 space-y-4">
                {/* Status Legend */}
                <div className="flex flex-wrap items-center gap-3 text-[11px] font-medium text-neutral-600 pb-1 border-b border-neutral-100">
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-md bg-emerald-500" />
                    <span>Đã làm</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-md bg-amber-400" />
                    <span>Gắn cờ</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-md bg-neutral-200" />
                    <span>Chưa làm</span>
                  </div>
                </div>

                {/* Grid Matrix of Question Numbers */}
                <div className="max-h-[404px] overflow-y-auto pr-1">
                  <div className="grid grid-cols-5 gap-2">
                    {questions.map((q, idx) => {
                      const isAnswered = (session.answers?.[q.id] || []).length > 0;
                      const isFlagged = (
                        session.flaggedQuestionIds || []
                      ).includes(q.id);
                      const isCurrent = idx === currentIndex;

                      let bgClass = "bg-neutral-100 text-neutral-700 hover:bg-neutral-200";
                      if (isAnswered) {
                        bgClass = "bg-emerald-500 text-white font-bold";
                      }
                      if (isFlagged) {
                        bgClass = "bg-amber-400 text-amber-950 font-bold ring-1 ring-amber-500";
                      }

                      return (
                        <button
                          key={q.id || idx}
                          type="button"
                          onClick={() => setQuestionIndex(quiz.id, idx)}
                          className={`h-10 w-full rounded-xl text-xs flex items-center justify-center font-mono transition cursor-pointer relative ${bgClass} ${
                            isCurrent
                              ? "ring-2 ring-indigo-600 ring-offset-2 scale-105 shadow-xs z-10"
                              : ""
                          }`}
                        >
                          {idx + 1}
                          {isFlagged && (
                            <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-rose-500" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Submit CTA in Sidebar */}
                <div className="pt-3 border-t border-neutral-100">
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full font-bold h-10"
                    onClick={() => setIsSubmitModalOpen(true)}
                    leftIcon={<Send className="h-4 w-4" />}
                  >
                    Nộp bài thi ngay
                  </Button>
                </div>
                </CardContent>
              </Card>
            )}
          </aside>
        </div>
      </main>

      {/* Submit Confirmation Modal */}
      <SubmitConfirmModal
        isOpen={isSubmitModalOpen}
        onClose={() => setIsSubmitModalOpen(false)}
        onConfirm={handleFinalSubmit}
        totalQuestions={questions.length}
        answeredCount={answeredCount}
        flaggedCount={flaggedCount}
        isLoading={isSubmitting}
      />
    </div>
  );
}

export default QuizRoom;
