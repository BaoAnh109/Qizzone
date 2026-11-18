import { create } from 'zustand';
import type { OptionId, Quiz } from '@/types/quiz';
import type { ExamResult, ExamSession } from '@/types/exam';
import { examSessionService } from '@/services/examSessionService';
import {
  acknowledgeExamMutation,
  clearExamAutosave,
  persistExamSnapshot,
  releaseExamAutosaveWriter,
  readExamAutosave,
  reserveNextExamMutation,
  retryExamMutation,
  type PendingExamMutation,
} from '@/store/examAutosavePersistence';

type CloudSession = ExamSession & { id: string; revision: number; mutationId?: string | null; questionOrder?: string[]; optionOrder?: Record<string, string[]> };
export type SessionSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'local-error';
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const saving = new Map<string, Promise<void>>();
const persisting = new Map<string, Promise<void>>();
const revisionConflicts = new Set<string>();
const persistenceErrors = new Map<string, unknown>();
const saveVersions = new Map<string, number>();
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

function clearLocalDraft(session: CloudSession): void {
  try {
    browserStorage()?.removeItem(localDraftKey(session));
  } catch {
    // Local storage can be unavailable in private browsing or restricted contexts.
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
        allowedQuestions.has(questionId) && Array.isArray(selected) && selected.length <= 5
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

function restoreSnapshot(session: CloudSession, draft: PendingExamMutation): CloudSession {
  const allowedQuestions = new Set(session.questionOrder || []);
  const answers = Object.fromEntries(Object.entries(draft.answers || {}).filter(([questionId, selected]) =>
    allowedQuestions.has(questionId) && Array.isArray(selected) && selected.length <= 5
      && selected.every(optionId => typeof optionId === 'string')).map(([questionId, selected]) =>
    [questionId, selected as OptionId[]]));
  const flaggedQuestionIds = (draft.flaggedQuestionIds || []).filter(questionId => allowedQuestions.has(questionId));
  const maxIndex = Math.max(0, (session.questionOrder?.length || 1) - 1);
  return {
    ...session,
    answers,
    flaggedQuestionIds,
    currentQuestionIndex: Math.max(0, Math.min(maxIndex, draft.currentQuestionIndex)),
  };
}

async function recoverExamDraft(session: CloudSession): Promise<{ session: CloudSession; restored: boolean; conflict: boolean; hasPendingMutation: boolean }> {
  const persisted = await readExamAutosave(session.id);
  if (persisted?.draft) {
    const hasPendingMutation = persisted.mutations.length > 0;
    if (hasPendingMutation || persisted.draft.revision === session.revision) {
      revisionConflicts.delete(session.quizId);
      return { session: restoreSnapshot(session, persisted.draft), restored: true, conflict: false, hasPendingMutation };
    }
    revisionConflicts.add(session.quizId);
    return { session, restored: false, conflict: true, hasPendingMutation: false };
  }
  if (persisted) {
    clearLocalDraft(session);
    revisionConflicts.delete(session.quizId);
    return { session, restored: false, conflict: false, hasPendingMutation: false };
  }

  const legacy = recoverLocalDraft(session);
  return { ...legacy, hasPendingMutation: false };
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
  saveErrors: Record<string, string>;
  isSubmitting: boolean;
  isLoading: boolean;
  error: string | null;
  submissionWarning: string | null;
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
  const persistSnapshot = (session: CloudSession): Promise<void> => {
    const currentGeneration = generation;
    const previous = persisting.get(session.quizId) || Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => {
      if (currentGeneration !== generation) return;
      await persistExamSnapshot({
        attemptId: session.id,
        studentId: session.studentId,
        revision: get().activeSessions[session.quizId]?.revision ?? session.revision,
        answers: buildAnswers(session),
        flaggedQuestionIds: session.flaggedQuestionIds || [],
        currentQuestionIndex: session.currentQuestionIndex,
        updatedAt: Date.now(),
      });
      clearLocalDraft(session);
      persistenceErrors.delete(session.quizId);
      set(state => {
        if (!state.saveErrors[session.quizId]) return state;
        const saveErrors = { ...state.saveErrors };
        delete saveErrors[session.quizId];
        return { saveErrors };
      });
    }).catch(error => {
      persistenceErrors.set(session.quizId, error);
      if (currentGeneration === generation) {
        set(state => ({
          saveStatus: { ...state.saveStatus, [session.quizId]: 'local-error' },
          saveErrors: {
            ...state.saveErrors,
            [session.quizId]: error instanceof Error
              ? error.message
              : 'Không thể lưu bản nháp trên thiết bị. Hãy kiểm tra dung lượng hoặc quyền lưu trữ của trình duyệt.',
          },
        }));
      }
      throw error;
    });
    persisting.set(session.quizId, task);
    void task.finally(() => {
      if (persisting.get(session.quizId) === task) persisting.delete(session.quizId);
    }).catch(() => undefined);
    return task;
  };

  const scheduleRetry = (quizId: string, retryCount: number) => {
    if (retryCount > 5 || retryTimers.has(quizId)) return;
    const delay = Math.min(30_000, 1_000 * (2 ** Math.max(0, retryCount - 1)));
    retryTimers.set(quizId, setTimeout(() => {
      retryTimers.delete(quizId);
      void saveNow(quizId).catch(() => undefined);
    }, delay));
  };

  const saveNow = (quizId: string): Promise<void> => {
    const currentGeneration = generation;
    const requestVersion = saveVersions.get(quizId) || 0;
    const previous = saving.get(quizId) || Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => {
      if (currentGeneration !== generation) return;
      const session = get().activeSessions[quizId];
      if (!session || session.isSubmitted) return;
      set(state => ({ saveStatus: { ...state.saveStatus, [quizId]: 'saving' } }));
      try {
        await persisting.get(quizId);
        if (persistenceErrors.has(quizId)) throw persistenceErrors.get(quizId);
        if (revisionConflicts.has(quizId)) {
          throw new Error('Bài làm đã được cập nhật trên thiết bị khác. Bản nháp trên thiết bị này được giữ lại.');
        }
        let retryCount = 0;
        const waitStartedAt = Date.now();
        while (currentGeneration === generation) {
          const mutation = await reserveNextExamMutation(session.id);
          if (!mutation) {
            const pending = await readExamAutosave(session.id);
            if (!pending?.mutations.length) break;
            const activeSend = pending.mutations.find(item => item.status === 'sending' && (item.leaseUntil || 0) > Date.now());
            if (!activeSend) continue;
            if (Date.now() - waitStartedAt > 10_000) {
              throw new Error('Đang chờ một thẻ khác đồng bộ bài làm. Vui lòng thử lại.');
            }
            await new Promise(resolve => setTimeout(resolve, 100));
            continue;
          }

          try {
            const saved = asSession(await examSessionService.saveAttempt({
              attemptId: mutation.attemptId,
              revision: mutation.revision,
              answers: mutation.answers as Record<string, OptionId[]>,
              flaggedQuestionIds: mutation.flaggedQuestionIds,
              currentQuestionIndex: mutation.currentQuestionIndex,
              mutationId: mutation.mutationId,
              clientSequence: mutation.clientSequence,
              writerSessionId: mutation.writerSessionId,
            }));
            if (saved.mutationId && saved.mutationId !== mutation.mutationId) {
              throw new Error('Phản hồi lưu bài không khớp với mutation đang chờ.');
            }
            await acknowledgeExamMutation(mutation.mutationId, saved.revision);
            if (currentGeneration !== generation) return;
            set(state => {
              const latest = state.activeSessions[quizId];
              if (!latest) return state;
              return {
                activeSessions: {
                  ...state.activeSessions,
                  [quizId]: { ...latest, revision: saved.revision, lastSavedAt: saved.lastSavedAt },
                },
              };
            });
            retryCount = 0;
          } catch (error) {
            await retryExamMutation(mutation.mutationId);
            const message = error instanceof Error ? error.message : '';
            if (/thiết bị khác|another device|changed on another|reload before saving/i.test(message)) {
              revisionConflicts.add(quizId);
            } else if (!/hết giờ|time has ended|already been submitted/i.test(message)) {
              retryCount = mutation.retryCount + 1;
              scheduleRetry(quizId, retryCount);
            }
            throw error;
          }
        }
        await persisting.get(quizId);
        const remaining = await readExamAutosave(session.id);
        if (currentGeneration === generation && saveVersions.get(quizId) === requestVersion) {
          set(state => ({ saveStatus: { ...state.saveStatus, [quizId]: remaining?.mutations.length ? 'pending' : 'saved' } }));
        }
      } catch (error) {
        if (currentGeneration === generation) {
          set(state => ({ saveStatus: { ...state.saveStatus, [quizId]: persistenceErrors.has(quizId) ? 'local-error' : 'error' } }));
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
    saveVersions.set(quizId, (saveVersions.get(quizId) || 0) + 1);
    void persistSnapshot(session).catch(() => undefined);
    const retryTimer = retryTimers.get(quizId);
    if (retryTimer) { clearTimeout(retryTimer); retryTimers.delete(quizId); }
    const oldTimer = timers.get(quizId);
    if (oldTimer) clearTimeout(oldTimer);
    timers.set(quizId, setTimeout(() => {
      timers.delete(quizId);
      void saveNow(quizId).catch(() => undefined);
    }, 250));
    set(state => ({ saveStatus: { ...state.saveStatus, [quizId]: 'pending' } }));
  };
  const flushSave = async (quizId: string) => {
    const oldTimer = timers.get(quizId);
    if (oldTimer) { clearTimeout(oldTimer); timers.delete(quizId); }
    await saveNow(quizId);
  };

  return {
    activeSessions: {}, results: [], saveStatus: {}, saveErrors: {}, isSubmitting: false, isLoading: false, error: null, submissionWarning: null,
    reset: () => {
      Object.values(get().activeSessions).forEach(session => {
        void releaseExamAutosaveWriter(session.id);
      });
      generation++;
      inFlightSessionLoad = null;
      timers.forEach(timer => clearTimeout(timer)); timers.clear(); saving.clear();
      retryTimers.forEach(timer => clearTimeout(timer)); retryTimers.clear();
      persisting.clear(); persistenceErrors.clear(); saveVersions.clear();
      revisionConflicts.clear();
      set({ activeSessions: {}, results: [], saveStatus: {}, saveErrors: {}, isLoading: false, isSubmitting: false, error: null, submissionWarning: null });
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
          const recoveredQuizIds: Array<{ quizId: string; hasPendingMutation: boolean }> = [];
          let hasConflict = false;
          for (const item of Array.isArray(sessions) ? sessions : []) {
            const recovery = await recoverExamDraft(asSession(item));
            records[recovery.session.quizId] = recovery.session;
            statuses[recovery.session.quizId] = recovery.conflict ? 'error' : recovery.hasPendingMutation ? 'pending' : 'saved';
            if (recovery.restored) recoveredQuizIds.push({ quizId: recovery.session.quizId, hasPendingMutation: recovery.hasPendingMutation });
            if (recovery.conflict) hasConflict = true;
          }
          set({
            activeSessions: records,
            results: asResults(results),
            saveStatus: statuses,
            isLoading: false,
            error: hasConflict ? 'Bài làm đã được cập nhật trên thiết bị khác. Bản nháp cục bộ được giữ lại và chưa ghi đè lên máy chủ.' : null,
          });
          recoveredQuizIds.forEach(({ quizId, hasPendingMutation }) => {
            if (hasPendingMutation) {
              timers.set(quizId, setTimeout(() => {
                timers.delete(quizId);
                void saveNow(quizId).catch(() => undefined);
              }, 0));
            } else {
              queueSave(quizId);
            }
          });
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
      const recovery = await recoverExamDraft(asSession(await examSessionService.startAttempt(quiz.id, studentClass)));
      const session = recovery.session;
      set(state => ({
        activeSessions: { ...state.activeSessions, [quiz.id]: session },
        saveStatus: { ...state.saveStatus, [quiz.id]: recovery.conflict ? 'error' : recovery.hasPendingMutation ? 'pending' : 'saved' },
        error: recovery.conflict ? 'Bài làm đã được cập nhật trên thiết bị khác. Bản nháp cục bộ được giữ lại và chưa ghi đè lên máy chủ.' : state.error,
      }));
      if (recovery.restored) {
        if (recovery.hasPendingMutation) void saveNow(quiz.id).catch(() => undefined);
        else queueSave(quiz.id);
      }
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
    },
    flushSession: flushSave,
    submitExam: async ({ quiz }) => {
      const session = get().activeSessions[quiz.id];
      if (!session) throw new Error('Không tìm thấy phiên làm bài.');
      if (revisionConflicts.has(quiz.id)) {
        throw new Error('Bài làm đã được cập nhật trên thiết bị khác. Bản nháp trên thiết bị này được giữ lại.');
      }
      set({ isSubmitting: true, submissionWarning: null });
      try {
        try {
          await flushSave(quiz.id);
        } catch (error) {
          // At the deadline the database rejects further writes, but submission must
          // still finalize the answers that were saved before time expired.
          if (!(error instanceof Error) || !/hết giờ|time has ended/i.test(error.message)) throw error;
          const pending = await readExamAutosave(session.id).catch(() => undefined);
          if (pending?.mutations.length || persistenceErrors.has(quiz.id)) {
            set({ submissionWarning: 'Hết giờ trước khi mọi đáp án được đồng bộ. Kết quả sử dụng bản đã lưu trên máy chủ.' });
          }
        }
        const rawResult = await examSessionService.submitAttempt(session.id);
        clearLocalDraft(session);
        await clearExamAutosave(session.id).catch(() => undefined);
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

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    const { activeSessions, flushSession } = useExamSessionStore.getState();
    if (Object.keys(activeSessions).length === 0) {
      void useExamSessionStore.getState().load().catch(() => undefined);
    } else {
      Object.keys(activeSessions).forEach(quizId => { void flushSession(quizId).catch(() => undefined); });
    }
  });
}
