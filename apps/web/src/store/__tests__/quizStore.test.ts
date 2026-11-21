import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/cloud', () => ({
  errorMessage: (error: unknown) => error instanceof Error ? error.message : 'error',
}));
vi.mock('@/services/quizService', () => ({
  quizService: {
    list: vi.fn(), save: vi.fn(), delete: vi.fn(), setStatus: vi.fn(),
  },
}));

import { quizService } from '@/services/quizService';
import { useQuizStore } from '@/store/quizStore';
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

describe('Supabase quiz store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQuizStore.getState().reset();
  });

  it('loads and creates quizzes through the repository', async () => {
    vi.mocked(quizService.list).mockResolvedValue([quiz]);
    vi.mocked(quizService.save).mockResolvedValue(quiz.id);
    await useQuizStore.getState().load();
    expect(useQuizStore.getState().quizzes).toEqual([quiz]);

    const created = await useQuizStore.getState().createQuiz({ ...quiz, status: 'draft' });
    expect(quizService.save).toHaveBeenCalledWith(expect.objectContaining({ title: quiz.title }));
    expect(created.id).toBe(quiz.id);
  });

  it('keeps a localized error and succeeds when retried', async () => {
    vi.mocked(quizService.list)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([quiz]);
    await expect(useQuizStore.getState().load()).rejects.toThrow('offline');
    expect(useQuizStore.getState().error).toBe('offline');
    await useQuizStore.getState().retry();
    expect(useQuizStore.getState().error).toBeNull();
    expect(useQuizStore.getState().quizzes).toEqual([quiz]);
  });

  it('uses the server status mutation instead of editing local storage', async () => {
    useQuizStore.setState({ quizzes: [quiz] });
    vi.mocked(quizService.setStatus).mockResolvedValue(undefined);
    vi.mocked(quizService.list).mockResolvedValue([{ ...quiz, status: 'closed' }]);
    const updated = await useQuizStore.getState().togglePublishStatus(quiz.id);
    expect(quizService.setStatus).toHaveBeenCalledWith(quiz.id, 'closed');
    expect(updated.status).toBe('closed');
  });
});
