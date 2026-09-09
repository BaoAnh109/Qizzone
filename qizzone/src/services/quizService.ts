import { rpc } from '@/lib/cloud';
import type { Quiz } from '@/types/quiz';

export type QuizInput = Omit<Quiz, 'id' | 'createdAt' | 'updatedAt' | 'code' | 'totalQuestions' | 'totalPoints'> & Partial<Pick<Quiz, 'code' | 'totalQuestions' | 'totalPoints'>>;
export const quizService = {
  list: () => rpc<Quiz[]>('list_quizzes'),
  save: (data: QuizInput, id?: string, legacyId?: string) => rpc<string>('save_quiz', { p_data: data, p_id: id || null, p_legacy_id: legacyId || null }),
  delete: (id: string) => rpc<void>('delete_quiz', { p_id: id }),
  setStatus: (id: string, status: Quiz['status']) => rpc<void>('set_quiz_status', { p_id: id, p_status: status }),
};
