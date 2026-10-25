import { create } from 'zustand';
import { practiceService } from '@/services/practiceService';
import type {
  PracticeAnswer,
  PracticeHistoryItem,
  PracticeOpenResult,
  PracticeResult,
  PracticeResultDetail,
  PracticeSession,
  PracticeSessionStatus,
} from '@/types/practice';
import type { OptionId, OptionItem, QuestionType } from '@/types/quiz';

const OPTION_IDS: OptionId[] = ['A', 'B', 'C', 'D'];
type UnknownRecord = Record<string, unknown>;

interface LocalPracticeDraft {
  sessionId: string;
  studentId: string;
  answers: Record<string, OptionId[]>;
  flaggedQuestionIds: string[];
  currentQuestionIndex: number;
  updatedAt: number;
}

interface PracticeState {
  sessions: Record<string, PracticeSession>;
  results: Record<string, PracticeResult>;
  history: PracticeHistoryItem[];
  historyOwnerId: string | null;
  loadingSessions: Record<string, boolean>;
  checkingAnswers: Record<string, boolean>;
  finishingSessions: Record<string, boolean>;
  isStarting: boolean;
  isLoadingHistory: boolean;
  historyError: string | null;
  reset: () => void;
  start: (quizId: string, questionCount: number | null, showExplanation: boolean) => Promise<PracticeSession>;
  retry: (sessionId: string, mode: 'wrong' | 'all') => Promise<PracticeSession>;
  open: (sessionId: string) => Promise<PracticeOpenResult>;
  selectAnswer: (sessionId: string, questionId: string, optionId: OptionId, multipleChoice: boolean) => void;
  toggleFlag: (sessionId: string, questionId: string) => void;
  setQuestionIndex: (sessionId: string, index: number) => void;
  checkAnswer: (sessionId: string, questionId: string) => Promise<PracticeAnswer>;
  finish: (sessionId: string) => Promise<PracticeResult>;
  loadHistory: (studentId: string) => Promise<void>;
  getSession: (sessionId: string) => PracticeSession | undefined;
  getResult: (sessionId: string) => PracticeResult | undefined;
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asOptionIds(value: unknown): OptionId[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is OptionId => typeof item === 'string' && OPTION_IDS.includes(item as OptionId));
}

function asOptionOrder(value: unknown): Record<string, OptionId[]> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([id, order]) => [id, asOptionIds(order)]));
}

function asStatus(value: unknown): PracticeSessionStatus {
  return value === 'completed' || value === 'invalidated' ? value : 'in_progress';
}

function asActiveSession(value: unknown): PracticeSession {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.quizId !== 'string'
    || typeof value.studentId !== 'string' || !Array.isArray(value.questionOrder)) {
    throw new Error('Dữ liệu lượt luyện tập không hợp lệ. Vui lòng quay lại mục Luyện tập.');
  }
  const questionOrder = value.questionOrder.filter((id): id is string => typeof id === 'string');
  if (questionOrder.length === 0) throw new Error('Đề không còn câu hỏi để luyện tập.');
  return {
    id: value.id,
    quizId: value.quizId,
    quizTitle: typeof value.quizTitle === 'string' ? value.quizTitle : 'Đề luyện tập',
    subject: typeof value.subject === 'string' ? value.subject : '',
    studentId: value.studentId,
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : new Date(Number(value.startedAt) || Date.now()).toISOString(),
    status: asStatus(value.status),
    questionOrder,
    optionOrder: asOptionOrder(value.optionOrder),
    showExplanation: value.showExplanation !== false,
    answers: {},
    checkedAnswers: {},
    flaggedQuestionIds: [],
    currentQuestionIndex: 0,
  };
}

function asPracticeAnswer(value: unknown): PracticeAnswer {
  if (!isRecord(value) || typeof value.questionId !== 'string' || typeof value.isCorrect !== 'boolean') {
    throw new Error('Kết quả kiểm tra câu hỏi không hợp lệ. Vui lòng thử lại.');
  }
  return {
    questionId: value.questionId,
    selectedAnswers: asOptionIds(value.selectedAnswers),
    isCorrect: value.isCorrect,
    correctAnswers: asOptionIds(value.correctAnswers),
    explanation: typeof value.explanation === 'string' ? value.explanation : null,
    checkedAt: typeof value.checkedAt === 'string' ? value.checkedAt : undefined,
    locked: true,
  };
}

function asQuestionType(value: unknown): QuestionType {
  return value === 'multiple_choice' || value === 'true_false' ? value : 'single_choice';
}

function asOptions(value: unknown): OptionItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || !OPTION_IDS.includes(item.id as OptionId)
      || typeof item.content !== 'string') return [];
    return [{ id: item.id as OptionId, content: item.content }];
  });
}

function asResultDetail(value: unknown): PracticeResultDetail {
  if (!isRecord(value) || typeof value.questionId !== 'string') {
    throw new Error('Kết quả luyện tập bị thiếu dữ liệu câu hỏi.');
  }
  return {
    questionId: value.questionId,
    order: Number(value.order) || 0,
    content: typeof value.content === 'string' ? value.content : '',
    type: asQuestionType(value.type),
    options: asOptions(value.options),
    optionOrder: asOptionIds(value.optionOrder),
    selectedAnswers: asOptionIds(value.selectedAnswers),
    correctAnswers: asOptionIds(value.correctAnswers),
    isCorrect: value.isCorrect === true,
    checked: value.checked === true,
    explanation: typeof value.explanation === 'string' ? value.explanation : '',
  };
}

function asPracticeResult(value: unknown): PracticeResult {
  if (!isRecord(value) || typeof value.id !== 'string' || !Array.isArray(value.details)) {
    throw new Error('Không thể tải kết quả luyện tập. Vui lòng thử lại.');
  }
  return {
    id: value.id,
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : value.id,
    quizId: typeof value.quizId === 'string' ? value.quizId : '',
    quizTitle: typeof value.quizTitle === 'string' ? value.quizTitle : 'Đề luyện tập',
    subject: typeof value.subject === 'string' ? value.subject : '',
    studentId: typeof value.studentId === 'string' ? value.studentId : '',
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : '',
    finishedAt: typeof value.finishedAt === 'string' ? value.finishedAt : new Date().toISOString(),
    totalQuestions: Number(value.totalQuestions) || value.details.length,
    answeredCount: Number(value.answeredCount) || 0,
    correctCount: Number(value.correctCount) || 0,
    incorrectCount: Number(value.incorrectCount) || 0,
    skippedCount: Number(value.skippedCount) || 0,
    percentage: Number(value.percentage) || 0,
    durationSeconds: Number(value.durationSeconds) || 0,
    details: value.details.map(asResultDetail),
  };
}

function asHistory(value: unknown): PracticeHistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.quizId !== 'string') return [];
    return [{
      id: item.id,
      sessionId: typeof item.sessionId === 'string' ? item.sessionId : item.id,
      quizId: item.quizId,
      quizTitle: typeof item.quizTitle === 'string' ? item.quizTitle : 'Đề luyện tập',
      subject: typeof item.subject === 'string' ? item.subject : '',
      startedAt: typeof item.startedAt === 'string' ? item.startedAt : '',
      finishedAt: typeof item.finishedAt === 'string' ? item.finishedAt : null,
      status: asStatus(item.status),
      message: typeof item.message === 'string' ? item.message : null,
      totalQuestions: Number(item.totalQuestions) || 0,
      answeredCount: Number(item.answeredCount) || 0,
      correctCount: Number(item.correctCount) || 0,
      percentage: Number(item.percentage) || 0,
      durationSeconds: Number(item.durationSeconds) || 0,
    }];
  });
}

function localStorageIfAvailable(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function draftKey(session: PracticeSession): string {
  return `qizzone:practice-draft:${session.studentId}:${session.id}`;
}

function readDraft(session: PracticeSession): Partial<LocalPracticeDraft> | undefined {
  try {
    const raw = localStorageIfAvailable()?.getItem(draftKey(session));
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<LocalPracticeDraft>;
    const questionIds = new Set(session.questionOrder);
    const validAnswers = !!value.answers && typeof value.answers === 'object' && !Array.isArray(value.answers)
      && Object.entries(value.answers).every(([questionId, selected]) => questionIds.has(questionId)
        && Array.isArray(selected) && selected.length <= 4
        && selected.every(optionId => typeof optionId === 'string' && OPTION_IDS.includes(optionId as OptionId)));
    const validFlags = Array.isArray(value.flaggedQuestionIds)
      && value.flaggedQuestionIds.every(questionId => typeof questionId === 'string' && questionIds.has(questionId));
    if (value.sessionId !== session.id || value.studentId !== session.studentId || !validAnswers || !validFlags
      || !Number.isInteger(value.currentQuestionIndex) || !Number.isFinite(value.updatedAt)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function saveDraft(session: PracticeSession): void {
  const storage = localStorageIfAvailable();
  if (!storage) return;
  const uncheckedAnswers = Object.fromEntries(Object.entries(session.answers)
    .filter(([questionId]) => !session.checkedAnswers[questionId]));
  const draft: LocalPracticeDraft = {
    sessionId: session.id,
    studentId: session.studentId,
    answers: uncheckedAnswers,
    flaggedQuestionIds: session.flaggedQuestionIds,
    currentQuestionIndex: session.currentQuestionIndex,
    updatedAt: Date.now(),
  };
  try {
    storage.setItem(draftKey(session), JSON.stringify(draft));
  } catch {
    // Practice progress still works if browser storage is unavailable.
  }
}

function clearDraft(session: PracticeSession): void {
  try {
    localStorageIfAvailable()?.removeItem(draftKey(session));
  } catch {
    // Finishing a session must not fail because local storage is unavailable.
  }
}

function clearDraftByOwner(studentId: string, sessionId: string): void {
  try {
    localStorageIfAvailable()?.removeItem(`qizzone:practice-draft:${studentId}:${sessionId}`);
  } catch {
    // A cached result must remain usable even if local storage is unavailable.
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export const usePracticeStore = create<PracticeState>((set, get) => ({
  sessions: {},
  results: {},
  history: [],
  historyOwnerId: null,
  loadingSessions: {},
  checkingAnswers: {},
  finishingSessions: {},
  isStarting: false,
  isLoadingHistory: false,
  historyError: null,
  reset: () => set({
    sessions: {}, results: {}, history: [], historyOwnerId: null, loadingSessions: {}, checkingAnswers: {},
    finishingSessions: {}, isStarting: false, isLoadingHistory: false, historyError: null,
  }),
  start: async (quizId, questionCount, showExplanation) => {
    set({ isStarting: true });
    try {
      const session = asActiveSession(await practiceService.start(quizId, questionCount, showExplanation));
      set(state => ({ sessions: { ...state.sessions, [session.id]: session } }));
      saveDraft(session);
      return session;
    } finally {
      set({ isStarting: false });
    }
  },
  retry: async (sessionId, mode) => {
    set({ isStarting: true });
    try {
      const session = asActiveSession(await practiceService.retry(sessionId, mode));
      set(state => ({ sessions: { ...state.sessions, [session.id]: session } }));
      saveDraft(session);
      return session;
    } finally {
      set({ isStarting: false });
    }
  },
  open: async sessionId => {
    set(state => ({ loadingSessions: { ...state.loadingSessions, [sessionId]: true } }));
    try {
      const raw = await practiceService.getSession(sessionId);
      if (!isRecord(raw)) throw new Error('Không thể tải lượt luyện tập. Vui lòng thử lại.');
      if (raw.status === 'completed') return { status: 'completed' };
      if (raw.status === 'invalidated') {
        return { status: 'invalidated', message: typeof raw.message === 'string' ? raw.message : 'Lượt luyện tập đã thay đổi. Hãy quay lại mục Luyện tập.' };
      }
      const base = asActiveSession(raw);
      const checkedAnswers: Record<string, PracticeAnswer> = {};
      if (Array.isArray(raw.answers)) {
        for (const answerValue of raw.answers) {
          const answer = asPracticeAnswer(answerValue);
          if (base.questionOrder.includes(answer.questionId)) checkedAnswers[answer.questionId] = answer;
        }
      }
      const draft = readDraft(base);
      const answers = { ...(draft?.answers || {}) };
      Object.keys(checkedAnswers).forEach(questionId => delete answers[questionId]);
      const session: PracticeSession = {
        ...base,
        answers,
        checkedAnswers,
        flaggedQuestionIds: draft?.flaggedQuestionIds || [],
        currentQuestionIndex: Math.max(0, Math.min(base.questionOrder.length - 1, draft?.currentQuestionIndex || 0)),
      };
      set(state => ({ sessions: { ...state.sessions, [sessionId]: session } }));
      saveDraft(session);
      return { status: 'in_progress', session };
    } catch (error) {
      return { status: 'error', message: messageOf(error, 'Không thể tải lượt luyện tập. Vui lòng thử lại.') };
    } finally {
      set(state => ({ loadingSessions: { ...state.loadingSessions, [sessionId]: false } }));
    }
  },
  selectAnswer: (sessionId, questionId, optionId, multipleChoice) => {
    const session = get().sessions[sessionId];
    if (!session || session.status !== 'in_progress' || !session.questionOrder.includes(questionId)
      || session.checkedAnswers[questionId] || !OPTION_IDS.includes(optionId)) return;
    const current = session.answers[questionId] || [];
    const selected = multipleChoice
      ? current.includes(optionId) ? current.filter(item => item !== optionId) : [...current, optionId]
      : [optionId];
    const updated = { ...session, answers: { ...session.answers, [questionId]: selected } };
    set(state => ({ sessions: { ...state.sessions, [sessionId]: updated } }));
    saveDraft(updated);
  },
  toggleFlag: (sessionId, questionId) => {
    const session = get().sessions[sessionId];
    if (!session || session.status !== 'in_progress' || !session.questionOrder.includes(questionId)) return;
    const flags = session.flaggedQuestionIds.includes(questionId)
      ? session.flaggedQuestionIds.filter(item => item !== questionId)
      : [...session.flaggedQuestionIds, questionId];
    const updated = { ...session, flaggedQuestionIds: flags };
    set(state => ({ sessions: { ...state.sessions, [sessionId]: updated } }));
    saveDraft(updated);
  },
  setQuestionIndex: (sessionId, index) => {
    const session = get().sessions[sessionId];
    if (!session || session.status !== 'in_progress' || !Number.isInteger(index)) return;
    const updated = { ...session, currentQuestionIndex: Math.max(0, Math.min(session.questionOrder.length - 1, index)) };
    set(state => ({ sessions: { ...state.sessions, [sessionId]: updated } }));
    saveDraft(updated);
  },
  checkAnswer: async (sessionId, questionId) => {
    const session = get().sessions[sessionId];
    if (!session || session.status !== 'in_progress' || !session.questionOrder.includes(questionId)) {
      throw new Error('Không tìm thấy câu hỏi trong lượt luyện tập này.');
    }
    if (session.checkedAnswers[questionId]) return session.checkedAnswers[questionId];
    const selectedAnswers = session.answers[questionId] || [];
    if (selectedAnswers.length === 0) throw new Error('Hãy chọn đáp án trước khi kiểm tra.');
    set(state => ({ checkingAnswers: { ...state.checkingAnswers, [`${sessionId}:${questionId}`]: true } }));
    try {
      const raw = await practiceService.checkAnswer(sessionId, questionId, selectedAnswers);
      if (isRecord(raw) && raw.status === 'invalidated') {
        throw new Error(typeof raw.message === 'string' ? raw.message : 'Đề đã thay đổi. Hãy quay lại mục Luyện tập.');
      }
      const checked = asPracticeAnswer(raw);
      if (checked.questionId !== questionId) throw new Error('Kết quả kiểm tra không khớp câu hỏi hiện tại.');
      const latest = get().sessions[sessionId] || session;
      const updated: PracticeSession = {
        ...latest,
        answers: { ...latest.answers, [questionId]: checked.selectedAnswers },
        checkedAnswers: { ...latest.checkedAnswers, [questionId]: checked },
      };
      set(state => ({ sessions: { ...state.sessions, [sessionId]: updated } }));
      saveDraft(updated);
      return checked;
    } finally {
      set(state => ({ checkingAnswers: { ...state.checkingAnswers, [`${sessionId}:${questionId}`]: false } }));
    }
  },
  finish: async sessionId => {
    const session = get().sessions[sessionId];
    set(state => ({ finishingSessions: { ...state.finishingSessions, [sessionId]: true } }));
    try {
      const raw = await practiceService.finish(sessionId);
      if (isRecord(raw) && raw.status === 'invalidated') {
        throw new Error(typeof raw.message === 'string' ? raw.message : 'Đề đã thay đổi. Hãy quay lại mục Luyện tập.');
      }
      const result = asPracticeResult(raw);
      set(state => ({ results: { ...state.results, [sessionId]: result } }));
      if (session) clearDraft(session);
      else clearDraftByOwner(result.studentId, sessionId);
      return result;
    } finally {
      set(state => ({ finishingSessions: { ...state.finishingSessions, [sessionId]: false } }));
    }
  },
  loadHistory: async studentId => {
    set({ isLoadingHistory: true, historyError: null });
    try {
      const history = asHistory(await practiceService.listHistory());
      set({ history, historyOwnerId: studentId, historyError: null });
    } catch (error) {
      set({ historyError: messageOf(error, 'Không thể tải lịch sử luyện tập.') });
      throw error;
    } finally {
      set({ isLoadingHistory: false });
    }
  },
  getSession: sessionId => get().sessions[sessionId],
  getResult: sessionId => get().results[sessionId],
}));

export default usePracticeStore;
