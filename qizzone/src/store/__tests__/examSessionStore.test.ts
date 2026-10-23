import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/cloud', () => ({
  rpc: vi.fn(),
  errorMessage: (error: unknown) => error instanceof Error ? error.message : 'error',
}));

import { rpc } from '@/lib/cloud';
import { useExamSessionStore } from '@/store/examSessionStore';
import type { Quiz } from '@/types/quiz';

const quiz: Quiz = {
  id: 'quiz-1', title: 'Quiz', subject: 'Math', description: '', teacherId: 'teacher', teacherName: 'Teacher',
  code: 'ABC123', status: 'published', totalQuestions: 1, totalPoints: 10,
  createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z',
  settings: { durationMinutes: 10, shuffleQuestions: false, shuffleOptions: false, allowReview: true, maxAttempts: 1, passPercentage: 50 },
  questions: [{
    id: 'question-1', order: 1, content: '2 + 2?', type: 'single_choice', points: 10,
    options: [{ id: 'A', content: '3' }, { id: 'B', content: '4' }], correctAnswers: ['B'],
  }],
};

const session = {
  id: 'attempt-1', quizId: quiz.id, studentId: 'student-1', studentName: 'Student',
  startTime: Date.now(), endTime: Date.now() + 600_000, durationMinutes: 10,
  answers: {}, flaggedQuestionIds: [], currentQuestionIndex: 0, isSubmitted: false,
  questionOrder: ['question-1'],
  lastSavedAt: '2026-09-09T00:00:00.000Z', revision: 0,
};

const localDrafts = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => localDrafts.get(key) ?? null,
  setItem: (key: string, value: string) => { localDrafts.set(key, value); },
  removeItem: (key: string) => { localDrafts.delete(key); },
};
const draftKey = 'qizzone:exam-draft:student-1:attempt-1';

describe('cloud exam session store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localDrafts.clear();
    vi.stubGlobal('window', { localStorage: localStorageMock });
    useExamSessionStore.getState().reset();
    useExamSessionStore.setState({ activeSessions: { [quiz.id]: { ...session } } });
  });

  afterEach(() => {
    useExamSessionStore.getState().reset();
    vi.unstubAllGlobals();
    localDrafts.clear();
    vi.useRealTimers();
  });

  it('debounces answer changes and persists only the newest selection', async () => {
    vi.mocked(rpc).mockImplementation(async (name) => {
      if (name !== 'save_attempt') return [];
      return { ...session, answers: { 'question-1': ['B'] }, revision: 1, lastSavedAt: '2026-09-09T00:00:01.000Z' };
    });

    const store = useExamSessionStore.getState();
    store.selectAnswer({ quizId: quiz.id, questionId: 'question-1', optionId: 'A' });
    store.selectAnswer({ quizId: quiz.id, questionId: 'question-1', optionId: 'B' });
    expect(useExamSessionStore.getState().saveStatus[quiz.id]).toBe('saving');
    await vi.advanceTimersByTimeAsync(449);
    expect(rpc).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledOnce());
    expect(rpc).toHaveBeenCalledWith('save_attempt', expect.objectContaining({
      p_revision: 0,
      p_answers: { 'question-1': ['B'] },
    }));
    expect(useExamSessionStore.getState().saveStatus[quiz.id]).toBe('saved');
  });

  it('recovers offline edits after reload and clears the draft only after a server save', async () => {
    let saveAttempts = 0;
    vi.mocked(rpc).mockImplementation(async (name) => {
      if (name === 'save_attempt') {
        saveAttempts += 1;
        if (saveAttempts === 1) throw new Error('Failed to fetch');
        return { ...session, answers: { 'question-1': ['B'] }, revision: 1 };
      }
      if (name === 'list_sessions') return [{ ...session, answers: {}, revision: 0 }];
      if (name === 'list_results') return [];
      return [];
    });

    useExamSessionStore.getState().selectAnswer({ quizId: quiz.id, questionId: 'question-1', optionId: 'B' });
    await vi.advanceTimersByTimeAsync(450);
    expect(saveAttempts).toBe(1);
    expect(localDrafts.has(draftKey)).toBe(true);

    useExamSessionStore.getState().reset();
    await useExamSessionStore.getState().load();
    expect(useExamSessionStore.getState().activeSessions[quiz.id].answers).toEqual({ 'question-1': ['B'] });

    await vi.advanceTimersByTimeAsync(450);
    await vi.waitFor(() => expect(saveAttempts).toBe(2));
    expect(localDrafts.has(draftKey)).toBe(false);
  });

  it('keeps a stale local draft without overwriting a newer server revision', async () => {
    localDrafts.set(draftKey, JSON.stringify({
      attemptId: session.id,
      studentId: session.studentId,
      revision: 0,
      answers: { 'question-1': ['A'] },
      flaggedQuestionIds: [],
      currentQuestionIndex: 0,
      updatedAt: Date.now(),
    }));
    vi.mocked(rpc).mockImplementation(async (name) => {
      if (name === 'list_sessions') return [{ ...session, answers: { 'question-1': ['B'] }, revision: 1 }];
      if (name === 'list_results') return [];
      return [];
    });

    await useExamSessionStore.getState().load();
    expect(useExamSessionStore.getState().activeSessions[quiz.id].answers).toEqual({ 'question-1': ['B'] });
    expect(useExamSessionStore.getState().saveStatus[quiz.id]).toBe('error');
    expect(localDrafts.has(draftKey)).toBe(true);

    await expect(useExamSessionStore.getState().flushSession(quiz.id)).rejects.toThrow(/thiết bị khác/i);
    expect(vi.mocked(rpc).mock.calls.some(call => call[0] === 'save_attempt')).toBe(false);
    expect(localDrafts.has(draftKey)).toBe(true);
  });

  it('still finalizes server-saved answers when autosave is rejected at the deadline', async () => {
    vi.mocked(rpc).mockImplementation(async (name) => {
      if (name === 'save_attempt') throw new Error('Hết giờ: nộp các đáp án đã lưu');
      if (name === 'submit_attempt') return { id: 'result-1', quizId: quiz.id, score: 5 };
      return [];
    });

    const result = await useExamSessionStore.getState().submitExam({
      quiz, studentId: 'student-1', studentName: 'Student',
    });
    expect(result.id).toBe('result-1');
    expect(vi.mocked(rpc).mock.calls.map(call => call[0])).toEqual(['save_attempt', 'submit_attempt']);
    expect(useExamSessionStore.getState().activeSessions[quiz.id].isSubmitted).toBe(true);
  });
});
