import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/practiceService', () => ({
  practiceService: {
    start: vi.fn(),
    getSession: vi.fn(),
    checkAnswer: vi.fn(),
    finish: vi.fn(),
    listHistory: vi.fn(),
  },
}));

import { practiceService } from '@/services/practiceService';
import { usePracticeStore } from '@/store/practiceStore';

const session = {
  id: 'practice-1', quizId: 'quiz-1', quizTitle: 'Ôn tập', subject: 'Toán', studentId: 'student-1',
  startedAt: '2026-10-26T10:00:00.000Z', status: 'in_progress',
  questionOrder: ['question-1', 'question-2'],
  optionOrder: { 'question-1': ['A', 'B'], 'question-2': ['A', 'B'] },
  showExplanation: true, answerCount: 0,
};

const answer = {
  questionId: 'question-1', selectedAnswers: ['A'], isCorrect: false,
  correctAnswers: ['B'], explanation: 'B mới là đáp án đúng.', checkedAt: '2026-10-26T10:01:00.000Z', locked: true,
};

const drafts = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => drafts.get(key) ?? null,
  setItem: (key: string, value: string) => { drafts.set(key, value); },
  removeItem: (key: string) => { drafts.delete(key); },
};

describe('practice store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drafts.clear();
    vi.stubGlobal('window', { localStorage: localStorageMock });
    usePracticeStore.getState().reset();
  });

  afterEach(() => {
    usePracticeStore.getState().reset();
    vi.unstubAllGlobals();
    drafts.clear();
  });

  it('starts a separate session and locks an answer after the server checks it', async () => {
    vi.mocked(practiceService.start).mockResolvedValue(session as never);
    vi.mocked(practiceService.checkAnswer).mockResolvedValue(answer as never);

    const started = await usePracticeStore.getState().start('quiz-1', null, true);
    expect(started.id).toBe('practice-1');
    expect(usePracticeStore.getState().sessions['practice-1']).toBeDefined();
    usePracticeStore.getState().selectAnswer('practice-1', 'question-1', 'A', false);
    const checked = await usePracticeStore.getState().checkAnswer('practice-1', 'question-1');

    expect(checked.isCorrect).toBe(false);
    usePracticeStore.getState().selectAnswer('practice-1', 'question-1', 'B', false);
    expect(usePracticeStore.getState().sessions['practice-1'].answers['question-1']).toEqual(['A']);
    expect(usePracticeStore.getState().sessions['practice-1'].checkedAnswers['question-1'].correctAnswers).toEqual(['B']);
    expect(practiceService.checkAnswer).toHaveBeenCalledWith('practice-1', 'question-1', ['A']);
  });

  it('recovers unchecked choices and flags after reload while restoring checked answers from the server', async () => {
    vi.mocked(practiceService.start).mockResolvedValue(session as never);
    vi.mocked(practiceService.getSession).mockResolvedValue({ ...session, answers: [answer] } as never);
    await usePracticeStore.getState().start('quiz-1', null, true);
    usePracticeStore.getState().selectAnswer('practice-1', 'question-2', 'B', false);
    usePracticeStore.getState().toggleFlag('practice-1', 'question-2');

    usePracticeStore.getState().reset();
    const outcome = await usePracticeStore.getState().open('practice-1');
    expect(outcome.status).toBe('in_progress');
    if (outcome.status !== 'in_progress') throw new Error('Expected an active practice session.');
    const restored = outcome.session;

    expect(restored.answers['question-2']).toEqual(['B']);
    expect(restored.flaggedQuestionIds).toEqual(['question-2']);
    expect(restored.checkedAnswers['question-1'].correctAnswers).toEqual(['B']);
    expect(restored.checkedAnswers['question-2']).toBeUndefined();
  });

  it('does not expose keys when an in-progress session has no checked answers', async () => {
    vi.mocked(practiceService.getSession).mockResolvedValue({ ...session, answers: [] } as never);
    const outcome = await usePracticeStore.getState().open('practice-1');
    expect(outcome.status).toBe('in_progress');
    if (outcome.status !== 'in_progress') throw new Error('Expected an active practice session.');
    expect(outcome.session.checkedAnswers).toEqual({});
    expect(JSON.stringify(outcome.session)).not.toContain('correctAnswers');
  });

  it('loads a finished result directly after a page reload', async () => {
    vi.mocked(practiceService.finish).mockResolvedValue({
      id: 'practice-1', sessionId: 'practice-1', quizId: 'quiz-1', quizTitle: 'Ôn tập', subject: 'Toán',
      studentId: 'student-1', startedAt: session.startedAt, finishedAt: '2026-10-26T10:05:00.000Z',
      totalQuestions: 1, answeredCount: 1, correctCount: 1, incorrectCount: 0, skippedCount: 0,
      percentage: 100, durationSeconds: 300,
      details: [{ questionId: 'question-1', order: 1, content: '$2+2$', type: 'single_choice',
        options: [{ id: 'A', content: '3' }, { id: 'B', content: '4' }], optionOrder: ['A', 'B'],
        selectedAnswers: ['B'], correctAnswers: ['B'], isCorrect: true, checked: true, explanation: 'B' }],
    } as never);

    const result = await usePracticeStore.getState().finish('practice-1');

    expect(result.correctCount).toBe(1);
    expect(result.details[0].correctAnswers).toEqual(['B']);
    expect(practiceService.finish).toHaveBeenCalledWith('practice-1');
  });
});
