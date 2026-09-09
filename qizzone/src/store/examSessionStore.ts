import { create } from 'zustand';
import type { OptionId, Quiz } from '@/types/quiz';
import type { ExamResult, ExamSession } from '@/types/exam';
import { errorMessage, rpc } from '@/lib/cloud';

type CloudSession = ExamSession & { id: string; revision: number; questionOrder?: string[]; optionOrder?: Record<string, string[]> };
export type SessionSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const saving = new Map<string, Promise<void>>();
let generation = 0;

export function isSessionInProgress(session?: ExamSession): boolean {
  if (!session || session.isSubmitted) return false;
  if (session.durationMinutes === 0) return true;
  return Date.now() < session.endTime;
}

function asSession(value: unknown): CloudSession {
  if (!value || typeof value !== 'object') throw new Error('Phiên làm bài không hợp lệ.');
  return value as CloudSession;
}

function asResults(value: unknown): ExamResult[] {
  return Array.isArray(value) ? value as ExamResult[] : [];
}

interface ExamSessionState {
  activeSessions: Record<string, CloudSession>;
  results: ExamResult[];
  saveStatus: Record<string, SessionSaveStatus>;
  isSubmitting: boolean;
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  retry: () => Promise<void>;
  reset: () => void;
  initSession: (params: { quiz: Quiz; studentId: string; studentName: string; studentClass?: string }) => Promise<ExamSession>;
  getSession: (quizId: string) => ExamSession | undefined;
  selectAnswer: (params: { quizId: string; questionId: string; optionId: OptionId; isMultipleChoice?: boolean }) => void;
  toggleFlagQuestion: (quizId: string, questionId: string) => void;
  clearAnswer: (quizId: string, questionId: string) => void;
  setQuestionIndex: (quizId: string, index: number) => void;
  flushSession: (quizId: string) => Promise<void>;
  submitExam: (params: { quiz: Quiz; studentId: string; studentName: string; studentClass?: string }) => Promise<ExamResult>;
  checkAndAutoSubmitExpired: () => Promise<void>;
  getResultById: (resultId: string) => ExamResult | undefined;
  getResultsByStudent: (studentId: string) => ExamResult[];
  getResultsByQuiz: (quizId: string) => ExamResult[];
}

function buildAnswers(session: CloudSession) {
  return session.answers || {};
}

export const useExamSessionStore = create<ExamSessionState>((set, get) => {
  const saveNow = (quizId: string): Promise<void> => {
    const currentGeneration = generation;
    const previous = saving.get(quizId) || Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => {
      if (currentGeneration !== generation) return;
      const session = get().activeSessions[quizId];
      if (!session || session.isSubmitted) return;
      set(state => ({ saveStatus: { ...state.saveStatus, [quizId]: 'saving' } }));
      try {
        const saved = asSession(await rpc<unknown>('save_attempt', {
          p_id: session.id,
          p_revision: session.revision,
          p_answers: buildAnswers(session),
          p_flags: session.flaggedQuestionIds || [],
          p_index: session.currentQuestionIndex,
        }));
        if (currentGeneration !== generation) return;
        set(state => {
          const latest = state.activeSessions[quizId];
          if (!latest) return state;
          return {
            activeSessions: {
              ...state.activeSessions,
              [quizId]: { ...latest, revision: saved.revision, lastSavedAt: saved.lastSavedAt },
            },
            saveStatus: { ...state.saveStatus, [quizId]: 'saved' },
          };
        });
      } catch (error) {
        if (currentGeneration === generation) {
          set(state => ({ saveStatus: { ...state.saveStatus, [quizId]: 'error' } }));
        }
        throw error;
      }
    });
    saving.set(quizId, task);
    void task.finally(() => {
      if (saving.get(quizId) === task) saving.delete(quizId);
    }).catch(() => undefined);
    return task;
  };
  const queueSave = (quizId: string) => {
    const session = get().activeSessions[quizId];
    if (!session || session.isSubmitted) return;
    const oldTimer = timers.get(quizId);
    if (oldTimer) clearTimeout(oldTimer);
    timers.set(quizId, setTimeout(() => {
      timers.delete(quizId);
      void saveNow(quizId).catch(() => undefined);
    }, 450));
    set(state => ({ saveStatus: { ...state.saveStatus, [quizId]: 'saving' } }));
  };
  const flushSave = async (quizId: string) => {
    const oldTimer = timers.get(quizId);
    if (oldTimer) { clearTimeout(oldTimer); timers.delete(quizId); }
    await saveNow(quizId);
  };

  return {
    activeSessions: {}, results: [], saveStatus: {}, isSubmitting: false, isLoading: false, error: null,
    reset: () => {
      generation++;
      timers.forEach(timer => clearTimeout(timer)); timers.clear(); saving.clear();
      set({ activeSessions: {}, results: [], saveStatus: {}, isLoading: false, isSubmitting: false, error: null });
    },
    load: async () => {
      set({ isLoading: true, error: null });
      try {
        const [sessions, results] = await Promise.all([
          rpc<unknown>('list_sessions'), rpc<unknown>('list_results'),
        ]);
        const records = Object.fromEntries((Array.isArray(sessions) ? sessions : []).map(item => {
          const session = asSession(item);
          return [session.quizId, session];
        }));
        const statuses = Object.fromEntries(Object.keys(records).map(quizId => [quizId, 'saved' as const]));
        set({ activeSessions: records, results: asResults(results), saveStatus: statuses, isLoading: false, error: null });
      } catch (error) {
        set({ isLoading: false, error: errorMessage(error) });
        throw error;
      }
    },
    retry: () => get().load(),
    initSession: async ({ quiz, studentClass }) => {
      const existing = get().activeSessions[quiz.id];
      if (existing && !existing.isSubmitted) return existing;
      const session = asSession(await rpc<unknown>('start_attempt', { p_quiz_id: quiz.id, p_class: studentClass || null }));
      set(state => ({
        activeSessions: { ...state.activeSessions, [quiz.id]: session },
        saveStatus: { ...state.saveStatus, [quiz.id]: 'saved' },
      }));
      return session;
    },
    getSession: quizId => get().activeSessions[quizId],
    selectAnswer: ({ quizId, questionId, optionId, isMultipleChoice }) => {
      set(state => {
        const session = state.activeSessions[quizId];
        if (!session || session.isSubmitted) return state;
        const current = session.answers[questionId] || [];
        const answers = isMultipleChoice
          ? current.includes(optionId) ? current.filter(item => item !== optionId) : [...current, optionId]
          : [optionId];
        return { activeSessions: { ...state.activeSessions, [quizId]: { ...session, answers: { ...session.answers, [questionId]: answers }, lastSavedAt: new Date().toISOString() } } };
      });
      queueSave(quizId);
    },
    toggleFlagQuestion: (quizId, questionId) => {
      set(state => {
        const session = state.activeSessions[quizId];
        if (!session || session.isSubmitted) return state;
        const current = session.flaggedQuestionIds || [];
        const flags = current.includes(questionId) ? current.filter(item => item !== questionId) : [...current, questionId];
        return { activeSessions: { ...state.activeSessions, [quizId]: { ...session, flaggedQuestionIds: flags, lastSavedAt: new Date().toISOString() } } };
      });
      queueSave(quizId);
    },
    clearAnswer: (quizId, questionId) => {
      set(state => {
        const session = state.activeSessions[quizId];
        if (!session || session.isSubmitted) return state;
        const answers = { ...session.answers };
        delete answers[questionId];
        return { activeSessions: { ...state.activeSessions, [quizId]: { ...session, answers, lastSavedAt: new Date().toISOString() } } };
      });
      queueSave(quizId);
    },
    setQuestionIndex: (quizId, index) => {
      set(state => {
        const session = state.activeSessions[quizId];
        if (!session || session.isSubmitted) return state;
        return { activeSessions: { ...state.activeSessions, [quizId]: { ...session, currentQuestionIndex: index } } };
      });
      queueSave(quizId);
    },
    flushSession: flushSave,
    submitExam: async ({ quiz }) => {
      const session = get().activeSessions[quiz.id];
      if (!session) throw new Error('Không tìm thấy phiên làm bài.');
      set({ isSubmitting: true });
      try {
        try {
          await flushSave(quiz.id);
        } catch (error) {
          // At the deadline the database rejects further writes, but submission must
          // still finalize the answers that were saved before time expired.
          if (!(error instanceof Error) || !/hết giờ/i.test(error.message)) throw error;
        }
        const result = await rpc<ExamResult>('submit_attempt', { p_id: session.id });
        set(state => {
          const current = state.activeSessions[quiz.id] || session;
          return {
            results: [result, ...state.results.filter(item => item.id !== result.id)],
            activeSessions: { ...state.activeSessions, [quiz.id]: { ...current, isSubmitted: true } },
            saveStatus: { ...state.saveStatus, [quiz.id]: 'saved' },
            isSubmitting: false,
          };
        });
        return result;
      } catch (error) {
        set({ isSubmitting: false });
        throw error;
      }
    },
    checkAndAutoSubmitExpired: async () => {
      await rpc<void>('finalize_expired');
      await get().load();
    },
    getResultById: resultId => get().results.find(result => result.id === resultId),
    getResultsByStudent: studentId => get().results.filter(result => result.studentId === studentId),
    getResultsByQuiz: quizId => get().results.filter(result => result.quizId === quizId),
  };
});

export default useExamSessionStore;
