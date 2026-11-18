import { isQizzoneApiConfigured, qizzoneApi, rpc } from '@/lib/cloud';
import type { Quiz } from '@/types/quiz';

export type QuizInput = Omit<Quiz, 'id' | 'createdAt' | 'updatedAt' | 'code' | 'totalQuestions' | 'totalPoints'> & Partial<Pick<Quiz, 'code' | 'totalQuestions' | 'totalPoints'>>;
export const quizService = {
  list: () => isQizzoneApiConfigured
    ? qizzoneApi<Quiz[]>('/api/v1/quizzes/')
    : rpc<Quiz[]>('list_quizzes'),
  save: async (data: QuizInput, id?: string, legacyId?: string) => {
    if (isQizzoneApiConfigured) {
      const quiz = await qizzoneApi<Quiz>(id ? `/api/v1/quizzes/${id}` : '/api/v1/quizzes/', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify({ ...data, legacyId: legacyId ?? null }),
      });
      return quiz.id;
    }
    return rpc<string>('save_quiz', { p_data: data, p_id: id || null, p_legacy_id: legacyId || null });
  },
  setAssignments: (id: string, assignedClasses: string[], assignedEmails: string[]) => isQizzoneApiConfigured
    ? qizzoneApi<void>(`/api/v1/quizzes/${id}/assignments`, {
      method: 'PUT',
      body: JSON.stringify({ assignedClasses, assignedEmails }),
    })
    : rpc<void>('set_quiz_assignments', {
      p_id: id,
      p_assigned_classes: assignedClasses,
      p_assigned_emails: assignedEmails,
    }),
  delete: (id: string) => isQizzoneApiConfigured
    ? qizzoneApi<void>(`/api/v1/quizzes/${id}`, { method: 'DELETE' })
    : rpc<void>('delete_quiz', { p_id: id }),
  setStatus: (id: string, status: Quiz['status']) => isQizzoneApiConfigured
    ? qizzoneApi<void>(`/api/v1/quizzes/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
    : rpc<void>('set_quiz_status', { p_id: id, p_status: status }),
  getByCode: async (code: string) => {
    const quizzes = await quizService.list();
    return quizzes.find((q) => q.code.toUpperCase() === code.trim().toUpperCase());
  },
};
