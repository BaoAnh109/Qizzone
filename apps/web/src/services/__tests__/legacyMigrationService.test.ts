import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rpc } from '@/lib/cloud';
import { quizService } from '@/services/quizService';
import { getLegacyMigrationPreview, migrateLegacyData } from '@/services/legacyMigrationService';
import type { User } from '@/types/auth';

vi.mock('@/lib/cloud', () => ({ rpc: vi.fn() }));
vi.mock('@/services/quizService', () => ({
  quizService: { save: vi.fn() },
}));
vi.mock('@/services/firebaseAuthService', () => ({
  firebaseAuthService: { updateProfile: vi.fn().mockResolvedValue(undefined) },
}));

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const teacher: User = {
  id: 'firebase-teacher', email: 'teacher@example.test', fullName: 'Teacher', name: 'Teacher',
  role: 'teacher', approvalStatus: 'approved', createdAt: '2026-09-05T00:00:00.000Z',
};

const quiz = {
  id: 'legacy-quiz-1', teacherId: 'legacy-teacher', teacherName: 'Old Teacher',
  title: 'Legacy quiz', subject: 'Math', description: '', code: 'OLD001', status: 'draft',
  settings: { durationMinutes: 10, shuffleQuestions: false, shuffleOptions: false, allowReview: true, maxAttempts: 1, passPercentage: 50 },
  totalQuestions: 1, totalPoints: 10, createdAt: '2026-01-01', updatedAt: '2026-01-01',
  questions: [{
    id: 'q1', order: 1, content: '1 + 1?', type: 'single_choice', points: 10,
    options: [{ id: 'A', content: '1' }, { id: 'B', content: '2' }], correctAnswers: ['B'],
  }],
};

describe('legacy migration assistant', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    vi.clearAllMocks();
    vi.mocked(rpc).mockResolvedValue(undefined);
    vi.mocked(quizService.save).mockResolvedValue('new-quiz-id');
    storage.setItem('qizzone_users_db', JSON.stringify([
      { id: 'legacy-teacher', email: teacher.email, fullName: 'Old Teacher', passwordHash: 'must-not-upload' },
    ]));
    storage.setItem('qizzone_quizzes_db', JSON.stringify({ state: { quizzes: [quiz] }, version: 0 }));
    storage.setItem('qizzone_auth_session', JSON.stringify({ state: { token: 'mock-token' } }));
    storage.setItem('qizzone_gemini_api_key', JSON.stringify('old-secret'));
  });

  it('previews Zustand-wrapped data and imports only owned records', async () => {
    expect(getLegacyMigrationPreview(teacher)).toMatchObject({
      hasLegacyData: true, hasMatchingProfile: true, profileCount: 1, quizCount: 1,
      hasUnsafeGeminiKey: true, hasObsoleteSession: true, skippedCount: 0,
    });

    await migrateLegacyData(teacher);
    expect(quizService.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'legacy-quiz-1', teacherId: teacher.id }),
      undefined,
      'legacy-quiz-1',
    );
    expect(rpc).toHaveBeenCalledWith('mark_data_migration', expect.objectContaining({ p_status: 'completed' }));
    expect(storage.getItem('qizzone_quizzes_db')).toBeNull();
    expect(storage.getItem('qizzone_gemini_api_key')).toBeNull();
  });

  it('keeps every old key after a failed import so the user can retry', async () => {
    vi.mocked(quizService.save).mockRejectedValueOnce(new Error('offline'));
    await expect(migrateLegacyData(teacher)).rejects.toThrow('offline');
    expect(storage.getItem('qizzone_quizzes_db')).not.toBeNull();
    expect(storage.getItem('qizzone_auth_session')).not.toBeNull();

    await migrateLegacyData(teacher);
    expect(storage.getItem('qizzone_quizzes_db')).toBeNull();
  });
});
