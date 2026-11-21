import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/cloud', () => ({ rpc: vi.fn() }));

import { rpc } from '@/lib/cloud';
import { practiceService } from '@/services/practiceService';

describe('practiceService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps practice operations to the isolated practice RPCs', async () => {
    await practiceService.start('quiz-1', null, true);
    await practiceService.start('quiz-1', 5, false);
    await practiceService.retry('session-1', 'wrong');
    await practiceService.getSession('session-1');
    await practiceService.checkAnswer('session-1', 'question-1', ['B']);
    await practiceService.finish('session-1');
    await practiceService.listHistory();

    expect(rpc).toHaveBeenNthCalledWith(1, 'start_practice', {
      p_quiz_id: 'quiz-1', p_question_count: null, p_show_explanation: true,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'start_practice', {
      p_quiz_id: 'quiz-1', p_question_count: 5, p_show_explanation: false,
    });
    expect(rpc).toHaveBeenNthCalledWith(3, 'start_practice_retry', {
      p_source_session_id: 'session-1', p_mode: 'wrong',
    });
    expect(rpc).toHaveBeenNthCalledWith(4, 'get_practice_session', { p_session_id: 'session-1' });
    expect(rpc).toHaveBeenNthCalledWith(5, 'check_practice_answer', {
      p_session_id: 'session-1', p_question_id: 'question-1', p_selected_answers: ['B'],
    });
    expect(rpc).toHaveBeenNthCalledWith(6, 'finish_practice', { p_session_id: 'session-1' });
    expect(rpc).toHaveBeenNthCalledWith(7, 'list_practice_history');
  });
});
