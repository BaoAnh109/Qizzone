import { create } from 'zustand';
import type { Quiz } from '@/types/quiz';
import { quizService, type QuizInput } from '@/services/quizService';
import { errorMessage } from '@/lib/cloud';

let loadVersion = 0;
interface QuizState {
  quizzes: Quiz[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  retry: () => Promise<void>;
  reset: () => void;
  getQuizById: (id: string) => Quiz | undefined;
  getQuizByCode: (code: string) => Quiz | undefined;
  createQuiz: (data: QuizInput) => Promise<Quiz>;
  updateQuiz: (id: string, data: Partial<Quiz>) => Promise<Quiz>;
  deleteQuiz: (id: string) => Promise<void>;
  togglePublishStatus: (id: string) => Promise<Quiz>;
  duplicateQuiz: (id: string) => Promise<Quiz>;
}

export const useQuizStore = create<QuizState>((set, get) => ({
  quizzes: [],
  isLoading: false,
  error: null,
  reset: () => { loadVersion += 1; set({ quizzes: [], isLoading: false, error: null }); },
  load: async () => {
    const version = loadVersion;
    set({ isLoading: true, error: null });
    try {
      const quizzes = await quizService.list();
      if (version === loadVersion) set({ quizzes, error: null });
    } catch (error) {
      if (version === loadVersion) set({ error: errorMessage(error) });
      throw error;
    } finally {
      if (version === loadVersion) set({ isLoading: false });
    }
  },
  retry: () => get().load(),
  getQuizById: id => get().quizzes.find(q => q.id === id),
  getQuizByCode: code => get().quizzes.find(q => q.code.toUpperCase() === code.trim().toUpperCase()),
  createQuiz: async data => {
    const id = await quizService.save(data);
    await get().load();
    const saved = get().getQuizById(id);
    if (!saved) throw new Error('Đã lưu đề nhưng chưa tải được dữ liệu mới.');
    return saved;
  },
  updateQuiz: async (id, data) => {
    const existing = get().getQuizById(id);
    if (!existing) throw new Error('Không tìm thấy đề.');
    await quizService.save({ ...existing, ...data }, id);
    await get().load();
    return get().getQuizById(id)!;
  },
  deleteQuiz: async id => { await quizService.delete(id); await get().load(); },
  togglePublishStatus: async id => {
    const existing = get().getQuizById(id);
    if (!existing) throw new Error('Không tìm thấy đề.');
    const status = existing.status === 'published' ? 'closed' : 'published';
    await quizService.setStatus(id, status);
    await get().load();
    return get().getQuizById(id)!;
  },
  duplicateQuiz: async id => {
    const source = get().getQuizById(id);
    if (!source) throw new Error('Không tìm thấy đề.');
    return get().createQuiz({ ...source, title: `${source.title} (Bản sao)`, status: 'draft' });
  },
}));

export default useQuizStore;
