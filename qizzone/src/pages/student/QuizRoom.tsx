import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Clock,
  Send,
  Flag,
  ChevronLeft,
  ChevronRight,
  CloudCheck,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useQuizStore } from "@/store/quizStore";
import { useExamSessionStore } from "@/store/examSessionStore";
import { useExamTimer } from "@/hooks/useExamTimer";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MathRenderer } from "@/components/common/MathRenderer";
import { SubmitConfirmModal } from "@/components/student/SubmitConfirmModal";
import { useToast } from "@/hooks/useToast";
import type { OptionId, Question } from "@/types/quiz";

function cleanStudentName(rawName?: string): string {
  if (!rawName) return "Học sinh";
  return rawName.replace(/^(Em|Học sinh|Thầy|Cô)\s+/i, "").trim() || rawName;
}

export function QuizRoom() {
  const { quizId } = useParams();
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
  const isSubmitting = useExamSessionStore((state) => state.isSubmitting);

  const toast = useToast();

  const quiz = quizId ? getQuizById(quizId) : undefined;
  const session = quizId ? activeSessions[quizId] : undefined;

  // Auto-init session on mount if not exists
  useEffect(() => {
    if (quiz && !session) {
      initSession({
        quiz,
        studentId: user?.id || "guest-student",
        studentName: cleanStudentName(user?.fullName || user?.name),
      });
    }
  }, [quiz, session, initSession, user]);

  const [currentIndex, setCurrentIndex] = useState(
    session?.currentQuestionIndex || 0
  );
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);

  const questions: Question[] = useMemo(() => {
    if (!quiz) return [];
    return quiz.questions;
  }, [quiz]);

  const currentQuestion: Question | undefined = questions[currentIndex];

  const currentAnswers: OptionId[] =
    session && currentQuestion ? session.answers[currentQuestion.id] || [] : [];

  const isCurrentFlagged =
    session && currentQuestion
      ? (session.flaggedQuestionIds || []).includes(currentQuestion.id)
      : false;

  // Submit Handler
  const handleFinalSubmit = useCallback(() => {
    if (!quiz || !session) return;
    try {
      const result = submitExam({
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

  // Keep question index synced in session store
  useEffect(() => {
    if (quiz) {
      setQuestionIndex(quiz.id, currentIndex);
    }
  }, [currentIndex, quiz, setQuestionIndex]);

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
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-neutral-200/90 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
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
              title="Đáp án được lưu tự động"
              className="flex items-center gap-1 text-xs text-emerald-600 font-medium px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-100 hidden md:flex"
            >
              <CloudCheck className="h-4 w-4 text-emerald-600" />
              <span>Đã lưu</span>
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 w-full flex-1">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT: Current Question Content & Options (8 cols) */}
          <div className="lg:col-span-8 space-y-4">
            {currentQuestion ? (
              <Card className="border-neutral-200/90 shadow-sm overflow-hidden bg-white">
                {/* Question Header */}
                <CardHeader className="bg-neutral-50/70 border-b border-neutral-200/60 p-4 sm:p-5 flex flex-row items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="primary" size="md">
                      Câu {currentIndex + 1} / {questions.length}
                    </Badge>
                    <span className="text-xs text-neutral-400">
                      ({currentQuestion.points || 1} điểm)
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleToggleFlag}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                        isCurrentFlagged
                          ? "bg-amber-100 border-amber-300 text-amber-950 ring-2 ring-amber-400/40 shadow-xs"
                          : "bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50 hover:border-neutral-300"
                      }`}
                    >
                      <Flag
                        className={`h-3.5 w-3.5 ${
                          isCurrentFlagged
                            ? "fill-amber-500 text-amber-600"
                            : "text-neutral-400"
                        }`}
                      />
                      <span>{isCurrentFlagged ? "Đã gắn cờ" : "Gắn cờ"}</span>
                    </button>

                    {currentAnswers.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearCurrent}
                        title="Bỏ chọn đáp án"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-neutral-500 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Bỏ chọn</span>
                      </button>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="p-5 sm:p-7 space-y-6">
                  {/* Question Prompt with KaTeX */}
                  <div className="text-base sm:text-lg font-medium text-neutral-900 leading-relaxed">
                    <MathRenderer content={currentQuestion.content} />
                  </div>

                  {/* 4 Option Buttons */}
                  <div className="space-y-3 pt-2">
                    {currentQuestion.options.map((opt) => {
                      const isSelected = currentAnswers.includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleSelectOption(opt.id)}
                          className={`w-full text-left flex items-start gap-4 rounded-2xl border p-4 sm:p-5 transition cursor-pointer ${
                            isSelected
                              ? "border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-500/40 shadow-xs"
                              : "border-neutral-200 bg-white hover:border-indigo-300 hover:bg-neutral-50/80"
                          }`}
                        >
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl font-bold text-xs sm:text-sm transition ${
                              isSelected
                                ? "bg-indigo-600 text-white shadow-2xs"
                                : "bg-neutral-100 text-neutral-700 border border-neutral-200"
                            }`}
                          >
                            {opt.id}
                          </span>

                          <div className="flex-1 pt-0.5 text-sm sm:text-base font-normal text-neutral-900">
                            <MathRenderer content={opt.content} />
                          </div>

                          {isSelected && (
                            <CheckCircle2 className="h-5 w-5 text-indigo-600 shrink-0 ml-auto mt-0.5" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Prev / Next Navigation Controls */}
                  <div className="flex items-center justify-between pt-6 border-t border-neutral-100">
                    <Button
                      variant="outline"
                      disabled={currentIndex === 0}
                      onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                      leftIcon={<ChevronLeft className="h-4 w-4" />}
                    >
                      Câu trước
                    </Button>

                    {currentIndex < questions.length - 1 ? (
                      <Button
                        variant="primary"
                        onClick={() =>
                          setCurrentIndex((prev) =>
                            Math.min(questions.length - 1, prev + 1)
                          )
                        }
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
                        Hoàn tất & Nộp bài
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>

          {/* RIGHT: Question Matrix Navigator (4 cols) */}
          <div className="lg:col-span-4 space-y-4">
            <Card className="border-neutral-200/90 shadow-xs bg-white">
              <CardHeader className="pb-3 border-b border-neutral-100">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-bold flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-indigo-600" />
                    <span>Danh sách câu hỏi</span>
                  </CardTitle>
                  <span className="text-xs font-semibold text-neutral-500">
                    {answeredCount}/{questions.length} đã làm
                  </span>
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
                        onClick={() => setCurrentIndex(idx)}
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
          </div>
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
