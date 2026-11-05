import { create } from 'zustand';
import type { Quiz } from '@/types/quiz';
import { quizService, type QuizInput } from '@/services/quizService';
import { errorMessage } from '@/lib/cloud';
import { useAuthStore } from '@/store/authStore';
import { assertPublishable } from '@/lib/validations/quizSave';

let loadVersion = 0;
let inFlightQuizLoad: Promise<void> | null = null;

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
  updateQuizAssignments: (id: string, assignedClasses: string[], assignedEmails: string[]) => Promise<Quiz>;
  deleteQuiz: (id: string) => Promise<void>;
  togglePublishStatus: (id: string) => Promise<Quiz>;
  duplicateQuiz: (id: string) => Promise<Quiz>;
}

export const useQuizStore = create<QuizState>((set, get) => ({
  quizzes: [],
  isLoading: false,
  error: null,
  reset: () => {
    loadVersion += 1;
    inFlightQuizLoad = null;
    set({ quizzes: [], isLoading: false, error: null });
  },
  load: async () => {
    if (inFlightQuizLoad) return inFlightQuizLoad;
    const version = loadVersion;
    set({ isLoading: true, error: null });
    inFlightQuizLoad = (async () => {
      try {
        const quizzes = await quizService.list();
        if (version === loadVersion) set({ quizzes, error: null });
      } catch (error) {
        if (version === loadVersion) set({ error: errorMessage(error) });
        throw error;
      } finally {
        if (version === loadVersion) set({ isLoading: false });
        inFlightQuizLoad = null;
      }
    })();
    return inFlightQuizLoad;
  },
  retry: () => get().load(),
  getQuizById: id => get().quizzes.find(q => q.id === id),
  getQuizByCode: code => get().quizzes.find(q => q.code.toUpperCase() === code.trim().toUpperCase() || q.id.toLowerCase() === code.trim().toLowerCase()),
  createQuiz: async data => {
    // Bước 08 (choke point): mọi đường tạo đề đều qua đây — xuất bản
    // thì bắt buộc câu hỏi hợp lệ, nháp thì cho qua (chỉ cảnh báo ở UI).
    // Không có đường nào vòng qua được guard này để xuất bản lén.
    if (data.status === 'published') {
      assertPublishable(data.questions);
    }
    const id = await quizService.save(data);
    await get().load();
    const saved = get().getQuizById(id);
    if (!saved) throw new Error('Đã lưu đề nhưng chưa tải được dữ liệu mới.');
    return saved;
  },
  updateQuiz: async (id, data) => {
    const existing = get().getQuizById(id);
    if (!existing) throw new Error('Không tìm thấy đề.');
    const user = useAuthStore.getState().user;
    if (user && user.role !== 'admin' && existing.teacherId && existing.teacherId !== user.id) {
      throw new Error('Bạn không có quyền chỉnh sửa đề thi của giáo viên khác.');
    }
    // Bước 08: cập nhật mà đích đến là published cũng phải qua gate —
    // không sửa đề nháp thiếu đáp án rồi lật sang published ở tầng dưới.
    const merged = { ...existing, ...data };
    if (merged.status === 'published') {
      assertPublishable(merged.questions);
    }
    await quizService.save({ ...existing, ...data }, id);
    await get().load();
    return get().getQuizById(id)!;
  },
  updateQuizAssignments: async (id, assignedClasses, assignedEmails) => {
    const existing = get().getQuizById(id);
    if (!existing) throw new Error('Không tìm thấy đề.');
    const user = useAuthStore.getState().user;
    if (user && user.role !== 'admin' && existing.teacherId && existing.teacherId !== user.id) {
      throw new Error('Bạn không có quyền giao đề thi của giáo viên khác.');
    }
    await quizService.setAssignments(id, assignedClasses, assignedEmails);
    await get().load();
    return get().getQuizById(id)!;
  },
  deleteQuiz: async id => {
    const existing = get().getQuizById(id);
    if (existing) {
      const user = useAuthStore.getState().user;
      if (user && user.role !== 'admin' && existing.teacherId && existing.teacherId !== user.id) {
        throw new Error('Bạn không có quyền xóa đề thi của giáo viên khác.');
      }
    }
    await quizService.delete(id);
    await get().load();
  },
  togglePublishStatus: async id => {
    const existing = get().getQuizById(id);
    if (!existing) throw new Error('Không tìm thấy đề.');
    const user = useAuthStore.getState().user;
    if (user && user.role !== 'admin' && existing.teacherId && existing.teacherId !== user.id) {
      throw new Error('Bạn không có quyền thay đổi trạng thái đề thi của giáo viên khác.');
    }
    const status = existing.status === 'published' ? 'closed' : 'published';
    // Bước 08: ĐÂY LÀ LỖ HỔNG XUẤT BẢN trước bước này — QuizList và nút
    // "xuất bản ngay" ở JoinByLink đều gọi hàm này mà không kiểm tra
    // gì, nên đề nháp thiếu đáp án vẫn xuất bản được. Đóng đề (về
    // closed) thì không cần kiểm tra; mở xuất bản thì bắt buộc gate.
    if (status === 'published') {
      assertPublishable(existing.questions);
    }
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
