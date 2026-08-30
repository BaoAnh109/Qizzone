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
}

export const useExamSessionStore = create<ExamSessionState>()(
  persist(
    (set, get) => ({
      activeSessions: {},
      results: [],
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
            // Toggle selection for multiple choice
            if (currentAnswers.includes(optionId)) {
              updated = currentAnswers.filter((id) => id !== optionId);
            } else {
              updated = [...currentAnswers, optionId];
            }
          } else {
            // Single choice replaces existing selection
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
    }),
    {
      name: "qizzone_exam_sessions_db",
      storage: createJSONStorage(() => localStorage),
    }
  )
);

export default useExamSessionStore;
