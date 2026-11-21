import { create } from 'zustand';
import type { OptionId, Quiz } from '@/types/quiz';
import type { ExamResult, ExamSession } from '@/types/exam';
import { examSessionService } from '@/services/examSessionService';

type CloudSession = ExamSession & { id: string; revision: number; questionOrder?: string[]; optionOrder?: Record<string, string[]> };
export type SessionSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const saving = new Map<string, Promise<void>>();
const revisionConflicts = new Set<string>();
let generation = 0;
let inFlightSessionLoad: Promise<void> | null = null;

interface LocalExamDraft {
  attemptId: string;
  studentId: string;
  revision: number;
  answers: Record<string, OptionId[]>;
  flaggedQuestionIds: string[];
  currentQuestionIndex: number;
  updatedAt: number;
}

function localDraftKey(session: CloudSession): string {
  return `qizzone:exam-draft:${session.studentId}:${session.id}`;
}

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function storeLocalDraft(session: CloudSession): string | undefined {
  const storage = browserStorage();
  if (!storage) return undefined;
  const value: LocalExamDraft = {
    attemptId: session.id,
    studentId: session.studentId,
    revision: session.revision,
    answers: session.answers || {},
    flaggedQuestionIds: session.flaggedQuestionIds || [],
    currentQuestionIndex: session.currentQuestionIndex,
    updatedAt: Date.now(),
  };
  try {
    const serialized = JSON.stringify(value);
    storage.setItem(localDraftKey(session), serialized);
    return serialized;
  } catch {
    return undefined;
  }
}

function clearLocalDraft(session: CloudSession): void {
  try {
    browserStorage()?.removeItem(localDraftKey(session));
  } catch {
    // Local storage can be unavailable in private browsing or restricted contexts.
  }
}

function clearLocalDraftIfUnchanged(session: CloudSession, snapshot?: string): void {
  if (!snapshot) return;
  try {
    const storage = browserStorage();
    if (storage?.getItem(localDraftKey(session)) === snapshot) {
      storage.removeItem(localDraftKey(session));
    }
  } catch {
    // Keep the server save successful even if local cleanup is unavailable.
  }
}

function readLocalDraft(session: CloudSession): LocalExamDraft | undefined {
  try {
    const raw = browserStorage()?.getItem(localDraftKey(session));
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<LocalExamDraft>;
    const allowedQuestions = new Set(session.questionOrder || []);
    const validAnswers = value.answers && typeof value.answers === 'object' && !Array.isArray(value.answers)
      && Object.entries(value.answers).every(([questionId, selected]) =>
        allowedQuestions.has(questionId) && Array.isArray(selected) && selected.length <= 4
        && selected.every(optionId => typeof optionId === 'string'));
    const validFlags = Array.isArray(value.flaggedQuestionIds)
      && value.flaggedQuestionIds.every(questionId => typeof questionId === 'string' && allowedQuestions.has(questionId));
    if (value.attemptId !== session.id || value.studentId !== session.studentId
      || !Number.isInteger(value.revision) || !validAnswers || !validFlags
      || !Number.isInteger(value.currentQuestionIndex) || !Number.isFinite(value.updatedAt)) {
      return undefined;
    }
    return value as LocalExamDraft;
  } catch {
    return undefined;
  }
}

function recoverLocalDraft(session: CloudSession): { session: CloudSession; restored: boolean; conflict: boolean } {
  const draft = readLocalDraft(session);
  if (!draft) return { session, restored: false, conflict: false };
  if (draft.revision !== session.revision) {
    revisionConflicts.add(session.quizId);
    return { session, restored: false, conflict: true };
  }
  revisionConflicts.delete(session.quizId);
  const maxIndex = Math.max(0, (session.questionOrder?.length || 1) - 1);
  return {
    session: {
      ...session,
      answers: draft.answers,
      flaggedQuestionIds: draft.flaggedQuestionIds,
      currentQuestionIndex: Math.max(0, Math.min(maxIndex, draft.currentQuestionIndex)),
    },
    restored: true,
    conflict: false,
  };
}

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

function storeErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'Dịch vụ phản hồi quá lâu. Vui lòng thử lại.';
  }
  return error instanceof Error ? error.message : 'Không thể tải dữ liệu phiên làm bài.';
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
        if (revisionConflicts.has(quizId)) {
          throw new Error('Bài làm đã được cập nhật trên thiết bị khác. Bản nháp trên thiết bị này được giữ lại.');
        }
        const draftSnapshot = storeLocalDraft(session);
        const saved = asSession(await examSessionService.saveAttempt({
          attemptId: session.id,
          revision: session.revision,
          answers: buildAnswers(session),
          flaggedQuestionIds: session.flaggedQuestionIds || [],
          currentQuestionIndex: session.currentQuestionIndex,
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
        clearLocalDraftIfUnchanged(session, draftSnapshot);
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
    if (!revisionConflicts.has(quizId)) storeLocalDraft(session);
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
      inFlightSessionLoad = null;
      timers.forEach(timer => clearTimeout(timer)); timers.clear(); saving.clear();
      revisionConflicts.clear();
      set({ activeSessions: {}, results: [], saveStatus: {}, isLoading: false, isSubmitting: false, error: null });
    },
    load: async () => {
      if (inFlightSessionLoad) return inFlightSessionLoad;
      set({ isLoading: true, error: null });
      inFlightSessionLoad = (async () => {
        try {
          const [sessions, results] = await Promise.all([
            examSessionService.listSessions(), examSessionService.listResults(),
          ]);
          revisionConflicts.clear();
          const records: Record<string, CloudSession> = {};
          const statuses: Record<string, SessionSaveStatus> = {};
          const recoveredQuizIds: string[] = [];
          let hasConflict = false;
          for (const item of Array.isArray(sessions) ? sessions : []) {
            const recovery = recoverLocalDraft(asSession(item));
            records[recovery.session.quizId] = recovery.session;
            statuses[recovery.session.quizId] = recovery.conflict ? 'error' : 'saved';
            if (recovery.restored) recoveredQuizIds.push(recovery.session.quizId);
            if (recovery.conflict) hasConflict = true;
          }
          set({
            activeSessions: records,
            results: asResults(results),
            saveStatus: statuses,
            isLoading: false,
            error: hasConflict ? 'Bài làm đã được cập nhật trên thiết bị khác. Bản nháp cục bộ được giữ lại và chưa ghi đè lên máy chủ.' : null,
          });
          recoveredQuizIds.forEach(queueSave);
        } catch (error) {
          set({ isLoading: false, error: storeErrorMessage(error) });
          throw error;
        } finally {
          inFlightSessionLoad = null;
        }
      })();
      return inFlightSessionLoad;
    },
    retry: () => get().load(),
    initSession: async ({ quiz, studentClass }) => {
      const existing = get().activeSessions[quiz.id];
      if (existing && !existing.isSubmitted) return existing;
      const recovery = recoverLocalDraft(asSession(await examSessionService.startAttempt(quiz.id, studentClass)));
      const session = recovery.session;
      set(state => ({
        activeSessions: { ...state.activeSessions, [quiz.id]: session },
        saveStatus: { ...state.saveStatus, [quiz.id]: recovery.conflict ? 'error' : 'saved' },
        error: recovery.conflict ? 'Bài làm đã được cập nhật trên thiết bị khác. Bản nháp cục bộ được giữ lại và chưa ghi đè lên máy chủ.' : state.error,
      }));
      if (recovery.restored) queueSave(quiz.id);
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
      if (revisionConflicts.has(quiz.id)) {
        throw new Error('Bài làm đã được cập nhật trên thiết bị khác. Bản nháp trên thiết bị này được giữ lại.');
      }
      set({ isSubmitting: true });
      try {
        try {
          await flushSave(quiz.id);
        } catch (error) {
          // At the deadline the database rejects further writes, but submission must
          // still finalize the answers that were saved before time expired.
          if (!(error instanceof Error) || !/hết giờ/i.test(error.message)) throw error;
        }
        const rawResult = await examSessionService.submitAttempt(session.id);
        clearLocalDraft(session);
        revisionConflicts.delete(quiz.id);
        const result: ExamResult = {
          ...rawResult,
          flaggedQuestionIds: session.flaggedQuestionIds || [],
        };
        set(state => {
          const current = state.activeSessions[quiz.id] || session;
          return {
            results: [result, ...state.results.filter(item => item.id !== result.id)],
            activeSessions: { ...state.activeSessions, [quiz.id]: { ...current, isSubmitted: true, flaggedQuestionIds: session.flaggedQuestionIds || [] } },
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
      await examSessionService.finalizeExpired();
      await get().load();
    },
    getResultById: resultId => get().results.find(result => result.id === resultId),
    getResultsByStudent: studentId => get().results.filter(result => result.studentId === studentId),
    getResultsByQuiz: quizId => get().results.filter(result => result.quizId === quizId),
  };
});

export default useExamSessionStore;
