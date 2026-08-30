import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { OptionId, Quiz } from "@/types/quiz";
import type { ExamResult, ExamSession } from "@/types/exam";
import { gradeExamSubmission } from "@/utils/gradingEngine";

export function isSessionInProgress(session?: ExamSession): boolean {
  if (!session || session.isSubmitted) return false;
  if (session.durationMinutes === 0) return true; // 0 = unlimited
  return Date.now() < session.endTime;
}

const DEFAULT_RESULTS: ExamResult[] = [
  {
    id: "res-seed-001",
    quizId: "quiz-001",
    quizTitle: "Kiểm tra Giải tích 12: Đạo hàm & Ứng dụng hình học",
    subject: "Toán học 12",
    roomCode: "QZ9821",
    studentId: "user-stu-001",
    studentName: "Trần Bảo Nam",
    studentClass: "12A1",
    totalQuestions: 4,
    answeredCount: 4,
    correctCount: 4,
    incorrectCount: 0,
    skippedCount: 0,
    score: 10.0,
    totalPointsEarned: 10,
    maxTotalPoints: 10,
    percentage: 100,
    isPassed: true,
    passPercentage: 50,
    academicRank: "Xuất sắc",
    timeSpentSeconds: 1240,
    details: [
      {
        questionId: "q-01",
        order: 1,
        content: "Cho hàm số $f(x) = x^3 - 3x + 2$. Điểm cực tiểu của đồ thị hàm số là điểm nào sau đây?",
        options: [
          { id: "A", content: "$A(-1; 4)$" },
          { id: "B", content: "$B(1; 0)$" },
          { id: "C", content: "$C(0; 2)$" },
          { id: "D", content: "$D(2; 4)$" },
        ],
        selectedAnswers: ["B"],
        correctAnswers: ["B"],
        isCorrect: true,
        pointsEarned: 2.5,
        maxPoints: 2.5,
        explanation: "Ta có $f'(x) = 3x^2 - 3 = 0 \\Leftrightarrow x = \\pm 1$. Điểm cực tiểu là $B(1; 0)$.",
      },
      {
        questionId: "q-02",
        order: 2,
        content: "Tính tích phân $I = \\int_{0}^{1} (2x + 1)e^x dx$ ta được kết quả có dạng $a \\cdot e + b$. Tính giá trị của $S = a + b$.",
        options: [
          { id: "A", content: "$S = 1$" },
          { id: "B", content: "$S = 2$" },
          { id: "C", content: "$S = 0$" },
          { id: "D", content: "$S = -1$" },
        ],
        selectedAnswers: ["A"],
        correctAnswers: ["A"],
        isCorrect: true,
        pointsEarned: 2.5,
        maxPoints: 2.5,
        explanation: "Sử dụng tích phân từng phần: $S = 2$.",
      },
      {
        questionId: "q-03",
        order: 3,
        content: "Trong không gian $Oxyz$, cho mặt phẳng $(\\alpha): 2x - y + 2z - 6 = 0$. Khoảng cách từ điểm $M(1; -2; 3)$ đến $(\\alpha)$ bằng:",
        options: [
          { id: "A", content: "$d = 1$" },
          { id: "B", content: "$d = 2$" },
          { id: "C", content: "$d = \\frac{4}{3}$" },
          { id: "D", content: "$d = \\frac{8}{3}$" },
        ],
        selectedAnswers: ["C"],
        correctAnswers: ["C"],
        isCorrect: true,
        pointsEarned: 2.5,
        maxPoints: 2.5,
        explanation: "$d(M, \\alpha) = \\frac{|2(1) - (-2) + 2(3) - 6|}{\\sqrt{2^2 + (-1)^2 + 2^2}} = \\frac{4}{3}$.",
      },
      {
        questionId: "q-04",
        order: 4,
        content: "Nghiệm của phương trình $\\log_2(x - 1) + \\log_2(x + 1) = 3$ là:",
        options: [
          { id: "A", content: "$x = 3$" },
          { id: "B", content: "$x = \\pm 3$" },
          { id: "C", content: "$x = \\sqrt{10}$" },
          { id: "D", content: "$x = 4$" },
        ],
        selectedAnswers: ["A"],
        correctAnswers: ["A"],
        isCorrect: true,
        pointsEarned: 2.5,
        maxPoints: 2.5,
        explanation: "Điều kiện $x > 1$. Phương trình $\\log_2(x^2 - 1) = 3 \\Leftrightarrow x^2 - 1 = 8 \\Rightarrow x = 3$.",
      },
    ],
    submittedAt: "2026-08-30T10:15:00.000Z",
  },
  {
    id: "res-seed-002",
    quizId: "quiz-001",
    quizTitle: "Kiểm tra Giải tích 12: Đạo hàm & Ứng dụng hình học",
    subject: "Toán học 12",
    roomCode: "QZ9821",
    studentId: "stu-seed-002",
    studentName: "Lê Thị Mai",
    studentClass: "12A1",
    totalQuestions: 4,
    answeredCount: 4,
    correctCount: 3,
    incorrectCount: 1,
    skippedCount: 0,
    score: 7.5,
    totalPointsEarned: 7.5,
    maxTotalPoints: 10,
    percentage: 75,
    isPassed: true,
    passPercentage: 50,
    academicRank: "Khá",
    timeSpentSeconds: 1580,
    details: [],
    submittedAt: "2026-08-30T10:22:00.000Z",
  },
  {
    id: "res-seed-003",
    quizId: "quiz-001",
    quizTitle: "Kiểm tra Giải tích 12: Đạo hàm & Ứng dụng hình học",
    subject: "Toán học 12",
    roomCode: "QZ9821",
    studentId: "stu-seed-003",
    studentName: "Phạm Minh Đức",
    studentClass: "12A2",
    totalQuestions: 4,
    answeredCount: 4,
    correctCount: 4,
    incorrectCount: 0,
    skippedCount: 0,
    score: 10.0,
    totalPointsEarned: 10,
    maxTotalPoints: 10,
    percentage: 100,
    isPassed: true,
    passPercentage: 50,
    academicRank: "Xuất sắc",
    timeSpentSeconds: 980,
    details: [],
    submittedAt: "2026-08-30T10:30:00.000Z",
  },
  {
    id: "res-seed-004",
    quizId: "quiz-001",
    quizTitle: "Kiểm tra Giải tích 12: Đạo hàm & Ứng dụng hình học",
    subject: "Toán học 12",
    roomCode: "QZ9821",
    studentId: "stu-seed-004",
    studentName: "Hoàng Nhật Anh",
    studentClass: "12A1",
    totalQuestions: 4,
    answeredCount: 3,
    correctCount: 2,
    incorrectCount: 1,
    skippedCount: 1,
    score: 5.0,
    totalPointsEarned: 5.0,
    maxTotalPoints: 10,
    percentage: 50,
    isPassed: true,
    passPercentage: 50,
    academicRank: "Trung bình",
    timeSpentSeconds: 2100,
    details: [],
    submittedAt: "2026-08-30T10:45:00.000Z",
  },
  {
    id: "res-seed-005",
    quizId: "quiz-001",
    quizTitle: "Kiểm tra Giải tích 12: Đạo hàm & Ứng dụng hình học",
    subject: "Toán học 12",
    roomCode: "QZ9821",
    studentId: "stu-seed-005",
    studentName: "Đỗ Phương Thảo",
    studentClass: "12A3",
    totalQuestions: 4,
    answeredCount: 4,
    correctCount: 3,
    incorrectCount: 1,
    skippedCount: 0,
    score: 7.5,
    totalPointsEarned: 7.5,
    maxTotalPoints: 10,
    percentage: 75,
    isPassed: true,
    passPercentage: 50,
    academicRank: "Khá",
    timeSpentSeconds: 1420,
    details: [],
    submittedAt: "2026-08-30T11:00:00.000Z",
  },
];

interface ExamSessionState {
  activeSessions: Record<string, ExamSession>; // keyed by quizId
  results: ExamResult[];
  isSubmitting: boolean;

  // Actions
  initSession: (params: {
    quiz: Quiz;
    studentId: string;
    studentName: string;
    studentClass?: string;
  }) => ExamSession;

  getSession: (quizId: string) => ExamSession | undefined;

  selectAnswer: (params: {
    quizId: string;
    questionId: string;
    optionId: OptionId;
    isMultipleChoice?: boolean;
  }) => void;

  toggleFlagQuestion: (quizId: string, questionId: string) => void;

  clearAnswer: (quizId: string, questionId: string) => void;

  setQuestionIndex: (quizId: string, index: number) => void;

  submitExam: (params: {
    quiz: Quiz;
    studentId: string;
    studentName: string;
    studentClass?: string;
  }) => ExamResult;

  checkAndAutoSubmitExpired: (quizzes: Quiz[]) => void;

  getResultById: (resultId: string) => ExamResult | undefined;
  getResultsByStudent: (studentId: string) => ExamResult[];
  getResultsByQuiz: (quizId: string) => ExamResult[];
}

export const useExamSessionStore = create<ExamSessionState>()(
  persist(
    (set, get) => ({
      activeSessions: {},
      results: DEFAULT_RESULTS,
      isSubmitting: false,

      initSession: ({ quiz, studentId, studentName, studentClass }) => {
        const existing = get().activeSessions[quiz.id];
        const now = Date.now();

        // If session exists and has not expired, resume it
        if (existing && !existing.isSubmitted) {
          // If duration > 0 and expired, auto finalize
          if (existing.durationMinutes > 0 && now >= existing.endTime) {
            const timeSpentSeconds = existing.durationMinutes * 60;
            const result = gradeExamSubmission({
              quiz,
              studentId: existing.studentId,
              studentName: existing.studentName,
              studentClass: existing.studentClass,
              answers: existing.answers,
              timeSpentSeconds,
            });

            set((state) => ({
              results: [result, ...state.results],
              activeSessions: {
                ...state.activeSessions,
                [quiz.id]: {
                  ...existing,
                  isSubmitted: true,
                },
              },
            }));
          } else {
            return existing;
          }
        }

        const durationMinutes = quiz.settings.durationMinutes || 0;
        const endTime =
          durationMinutes > 0 ? now + durationMinutes * 60 * 1000 : 0;

        const newSession: ExamSession = {
          quizId: quiz.id,
          studentId,
          studentName,
          studentClass,
          startTime: now,
          endTime,
          durationMinutes,
          answers: {},
          flaggedQuestionIds: [],
          currentQuestionIndex: 0,
          isSubmitted: false,
          lastSavedAt: new Date().toISOString(),
        };

        set((state) => ({
          activeSessions: {
            ...state.activeSessions,
            [quiz.id]: newSession,
          },
        }));

        return newSession;
      },

      getSession: (quizId: string) => {
        return get().activeSessions[quizId];
      },

      selectAnswer: ({ quizId, questionId, optionId, isMultipleChoice }) => {
        set((state) => {
          const session = state.activeSessions[quizId];
          if (!session) return state;

          const currentAnswers = session.answers[questionId] || [];
          let updated: OptionId[];

          if (isMultipleChoice) {
            if (currentAnswers.includes(optionId)) {
              updated = currentAnswers.filter((id) => id !== optionId);
            } else {
              updated = [...currentAnswers, optionId];
            }
          } else {
            updated = [optionId];
          }

          const updatedSession: ExamSession = {
            ...session,
            answers: {
              ...session.answers,
              [questionId]: updated,
            },
            lastSavedAt: new Date().toISOString(),
          };

          return {
            activeSessions: {
              ...state.activeSessions,
              [quizId]: updatedSession,
            },
          };
        });
      },

      toggleFlagQuestion: (quizId, questionId) => {
        set((state) => {
          const session = state.activeSessions[quizId];
          if (!session) return state;

          const flagged = session.flaggedQuestionIds || [];
          const isFlagged = flagged.includes(questionId);
          const updatedFlagged = isFlagged
            ? flagged.filter((id) => id !== questionId)
            : [...flagged, questionId];

          return {
            activeSessions: {
              ...state.activeSessions,
              [quizId]: {
                ...session,
                flaggedQuestionIds: updatedFlagged,
                lastSavedAt: new Date().toISOString(),
              },
            },
          };
        });
      },

      clearAnswer: (quizId, questionId) => {
        set((state) => {
          const session = state.activeSessions[quizId];
          if (!session) return state;

          const newAnswers = { ...session.answers };
          delete newAnswers[questionId];

          return {
            activeSessions: {
              ...state.activeSessions,
              [quizId]: {
                ...session,
                answers: newAnswers,
                lastSavedAt: new Date().toISOString(),
              },
            },
          };
        });
      },

      setQuestionIndex: (quizId, index) => {
        set((state) => {
          const session = state.activeSessions[quizId];
          if (!session) return state;

          return {
            activeSessions: {
              ...state.activeSessions,
              [quizId]: {
                ...session,
                currentQuestionIndex: index,
              },
            },
          };
        });
      },

      submitExam: ({ quiz, studentId, studentName, studentClass }) => {
        set({ isSubmitting: true });

        const session = get().activeSessions[quiz.id];
        const answers = session ? session.answers : {};
        const startTime = session ? session.startTime : Date.now();
        const durationSeconds = (quiz.settings.durationMinutes || 0) * 60;
        const elapsed = Math.max(1, Math.floor((Date.now() - startTime) / 1000));
        const timeSpentSeconds =
          durationSeconds > 0 ? Math.min(elapsed, durationSeconds) : elapsed;

        const result = gradeExamSubmission({
          quiz,
          studentId,
          studentName,
          studentClass,
          answers,
          timeSpentSeconds,
        });

        // Store result and mark session submitted
        set((state) => {
          const updatedSessions = { ...state.activeSessions };
          if (updatedSessions[quiz.id]) {
            updatedSessions[quiz.id] = {
              ...updatedSessions[quiz.id],
              isSubmitted: true,
            };
          }

          return {
            results: [result, ...state.results],
            activeSessions: updatedSessions,
            isSubmitting: false,
          };
        });

        return result;
      },

      checkAndAutoSubmitExpired: (quizzes: Quiz[]) => {
        const now = Date.now();
        const sessions = get().activeSessions;
        let hasChanges = false;
        const newResults: ExamResult[] = [];
        const updatedSessions = { ...sessions };

        quizzes.forEach((quiz) => {
          const s = updatedSessions[quiz.id];
          if (s && !s.isSubmitted && s.durationMinutes > 0 && now >= s.endTime) {
            hasChanges = true;
            const timeSpentSeconds = s.durationMinutes * 60;
            const res = gradeExamSubmission({
              quiz,
              studentId: s.studentId,
              studentName: s.studentName,
              studentClass: s.studentClass,
              answers: s.answers,
              timeSpentSeconds,
            });
            newResults.push(res);
            updatedSessions[quiz.id] = {
              ...s,
              isSubmitted: true,
            };
          }
        });

        if (hasChanges) {
          set((state) => ({
            results: [...newResults, ...state.results],
            activeSessions: updatedSessions,
          }));
        }
      },

      getResultById: (resultId) => {
        return get().results.find((r) => r.id === resultId);
      },

      getResultsByStudent: (studentId) => {
        return get().results.filter((r) => r.studentId === studentId);
      },

      getResultsByQuiz: (quizId) => {
        return get().results.filter((r) => r.quizId === quizId);
      },
    }),
    {
      name: "qizzone_exam_sessions_db",
      storage: createJSONStorage(() => localStorage),
    }
  )
);

export default useExamSessionStore;
