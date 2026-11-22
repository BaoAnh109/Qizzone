import { rpc } from '@/lib/cloud';
import type { Quiz, QuizSettings } from '@/types/quiz';

export type QuizInput = Omit<Quiz, 'id' | 'createdAt' | 'updatedAt' | 'code' | 'totalQuestions' | 'totalPoints'> & Partial<Pick<Quiz, 'code' | 'totalQuestions' | 'totalPoints'>>;
export const quizService = {
  list: () => rpc<Quiz[]>('list_quizzes'),
  save: (data: QuizInput, id?: string, legacyId?: string) => rpc<string>('save_quiz', { p_data: data, p_id: id || null, p_legacy_id: legacyId || null }),
  setAssignments: (id: string, assignedClasses: string[], assignedEmails: string[]) =>
    rpc<void>('set_quiz_assignments', {
      p_id: id,
      p_assigned_classes: assignedClasses,
      p_assigned_emails: assignedEmails,
    }),
  delete: (id: string) => rpc<void>('delete_quiz', { p_id: id }),
  setStatus: (id: string, status: Quiz['status']) => rpc<void>('set_quiz_status', { p_id: id, p_status: status }),
  getByCode: async (code: string) => {
    const quizzes = await quizService.list();
    return quizzes.find((q) => q.code.toUpperCase() === code.trim().toUpperCase());
  },
  joinByCode: (code: string) =>
    rpc<Quiz>('join_quiz_by_code', {
      p_code: code.trim().toUpperCase(),
    }),
  updatePublishSettings: (
    quizId: string,
    settings: Partial<QuizSettings>,
    status?: Quiz['status'] | null,
  ) =>
    rpc<Quiz>('update_quiz_publish_settings', {
      p_quiz_id: quizId,
      p_settings: settings,
      p_status: status ?? null,
    }),
};
