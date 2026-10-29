import { rpc } from '@/lib/cloud';
import type { OptionId } from '@/types/quiz';

export const practiceService = {
  start: (quizId: string, questionCount: number | null, showExplanation: boolean) =>
    rpc<unknown>('start_practice', {
      p_quiz_id: quizId,
      p_question_count: questionCount,
      p_show_explanation: showExplanation,
    }),
  retry: (sessionId: string, mode: 'wrong' | 'all') =>
    rpc<unknown>('start_practice_retry', {
      p_source_session_id: sessionId,
      p_mode: mode,
    }),
  getSession: (sessionId: string) =>
    rpc<unknown>('get_practice_session', { p_session_id: sessionId }),
  checkAnswer: (sessionId: string, questionId: string, selectedAnswers: OptionId[]) =>
    rpc<unknown>('check_practice_answer', {
      p_session_id: sessionId,
      p_question_id: questionId,
      p_selected_answers: selectedAnswers,
    }),
  finish: (sessionId: string) =>
    rpc<unknown>('finish_practice', { p_session_id: sessionId }),
  listHistory: () => rpc<unknown>('list_practice_history'),
};
