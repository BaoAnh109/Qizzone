import { isQizzoneApiConfigured, qizzoneApi, rpc } from '@/lib/cloud';
import type { OptionId } from '@/types/quiz';

export const practiceService = {
  start: (quizId: string, questionCount: number | null, showExplanation: boolean) =>
    isQizzoneApiConfigured
      ? qizzoneApi<unknown>('/api/v1/practice-sessions/', {
        method: 'POST',
        body: JSON.stringify({ quizId, questionCount, showExplanation }),
      })
      : rpc<unknown>('start_practice', {
      p_quiz_id: quizId,
      p_question_count: questionCount,
      p_show_explanation: showExplanation,
    }),
  retry: (sessionId: string, mode: 'wrong' | 'all') =>
    isQizzoneApiConfigured
      ? qizzoneApi<unknown>(`/api/v1/practice-sessions/${sessionId}/retry`, { method: 'POST', body: JSON.stringify({ mode }) })
      : rpc<unknown>('start_practice_retry', {
      p_source_session_id: sessionId,
      p_mode: mode,
    }),
  getSession: (sessionId: string) =>
    isQizzoneApiConfigured
      ? qizzoneApi<unknown>(`/api/v1/practice-sessions/${sessionId}`)
      : rpc<unknown>('get_practice_session', { p_session_id: sessionId }),
  checkAnswer: (sessionId: string, questionId: string, selectedAnswers: OptionId[]) =>
    isQizzoneApiConfigured
      ? qizzoneApi<unknown>(`/api/v1/practice-sessions/${sessionId}/answers/${questionId}`, {
        method: 'POST',
        body: JSON.stringify({ selectedAnswers }),
      })
      : rpc<unknown>('check_practice_answer', {
      p_session_id: sessionId,
      p_question_id: questionId,
      p_selected_answers: selectedAnswers,
    }),
  finish: (sessionId: string) =>
    isQizzoneApiConfigured
      ? qizzoneApi<unknown>(`/api/v1/practice-sessions/${sessionId}/finish`, { method: 'POST' })
      : rpc<unknown>('finish_practice', { p_session_id: sessionId }),
  listHistory: () => isQizzoneApiConfigured
    ? qizzoneApi<unknown[]>('/api/v1/practice-sessions/history')
    : rpc<unknown>('list_practice_history'),
};
