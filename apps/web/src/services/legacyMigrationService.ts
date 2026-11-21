import type { User } from '@/types/auth';
import type { Quiz } from '@/types/quiz';
import { rpc } from '@/lib/cloud';
import { quizService } from '@/services/quizService';
import { firebaseAuthService } from '@/services/firebaseAuthService';

const KEYS = {
  users: 'qizzone_users_db',
  session: 'qizzone_auth_session',
  quizzes: 'qizzone_quizzes_db',
  exams: 'qizzone_exam_sessions_db',
  gemini: 'qizzone_gemini_api_key',
} as const;

type LegacyRecord = Record<string, unknown>;
type LegacyExamData = {
  activeSessions?: LegacyRecord[] | Record<string, LegacyRecord>;
  results?: LegacyRecord[];
};
type LegacyUser = { id?: string; email?: string; fullName?: string };

export interface LegacyMigrationPreview {
  hasLegacyData: boolean;
  hasMatchingProfile: boolean;
  profileCount: number;
  quizCount: number;
  attemptCount: number;
  resultCount: number;
  skippedCount: number;
  hasUnsafeGeminiKey: boolean;
  hasObsoleteSession: boolean;
}

let running: Promise<void> | undefined;

function read<T>(key: string): T | null {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : null;
  } catch {
    return null;
  }
}

function has(key: string): boolean {
  try { return window.localStorage.getItem(key) !== null; } catch { return false; }
}

function remove(key: string) {
  try { window.localStorage.removeItem(key); } catch { /* Storage can be unavailable in private mode. */ }
}

function oldUserFor(user: User): LegacyUser | undefined {
  const users = read<LegacyUser[]>(KEYS.users) || [];
  return users.find(candidate => candidate.email?.toLowerCase() === user.email.toLowerCase());
}

function oldQuizzes(): unknown[] {
  const stored = read<unknown>(KEYS.quizzes);
  if (Array.isArray(stored)) return stored;
  const state = stored && typeof stored === 'object' ? (stored as { state?: { quizzes?: unknown[] } }).state : undefined;
  return Array.isArray(state?.quizzes) ? state.quizzes : [];
}

function isQuiz(value: unknown): value is Quiz {
  if (!value || typeof value !== 'object') return false;
  const quiz = value as Partial<Quiz>;
  const settings = quiz.settings;
  return typeof quiz.id === 'string'
    && typeof quiz.teacherId === 'string'
    && typeof quiz.title === 'string' && quiz.title.trim().length > 0
    && typeof quiz.subject === 'string' && quiz.subject.trim().length > 0
    && ['draft', 'published', 'closed'].includes(quiz.status || '')
    && Boolean(settings)
    && Number.isInteger(settings?.durationMinutes) && settings!.durationMinutes >= 0
    && Number.isInteger(settings?.maxAttempts) && settings!.maxAttempts >= 0
    && typeof settings?.passPercentage === 'number' && settings.passPercentage >= 0 && settings.passPercentage <= 100
    && Array.isArray(quiz.questions) && quiz.questions.length > 0
    && quiz.questions.every(question => {
      const optionIds = new Set(question.options?.map(option => option.id));
      return typeof question.id === 'string' && typeof question.content === 'string' && question.content.trim().length > 0
        && ['single_choice', 'multiple_choice', 'true_false'].includes(question.type)
        && Array.isArray(question.options) && question.options.length >= 2 && question.options.length <= 4
        && optionIds.size === question.options.length
        && question.options.every(option => ['A', 'B', 'C', 'D'].includes(option.id) && option.content.trim().length > 0)
        && Array.isArray(question.correctAnswers) && question.correctAnswers.length > 0
        && question.correctAnswers.every(answer => optionIds.has(answer))
        && typeof question.points === 'number' && question.points > 0;
    });
}

function oldExamData(): { sessions: LegacyRecord[]; results: LegacyRecord[] } {
  const stored = read<LegacyExamData | { state?: LegacyExamData }>(KEYS.exams);
  const oldExam: LegacyExamData | null | undefined = stored && 'state' in stored
    ? stored.state
    : stored as LegacyExamData | null;
  const sessions = Array.isArray(oldExam?.activeSessions)
    ? oldExam.activeSessions
    : Object.values(oldExam?.activeSessions || {});
  return { sessions, results: Array.isArray(oldExam?.results) ? oldExam.results : [] };
}

function hasValidAttemptShape(record: LegacyRecord, legacyUserId: string): boolean {
  const startTime = record.startTime;
  const answers = record.answers;
  return record.studentId === legacyUserId
    && typeof record.quizId === 'string' && record.quizId.length > 0
    && (startTime === undefined || (typeof startTime === 'number' && Number.isFinite(startTime)))
    && (answers === undefined || (typeof answers === 'object' && answers !== null && !Array.isArray(answers)));
}

function hasValidResultShape(record: LegacyRecord, legacyUserId: string): boolean {
  return record.studentId === legacyUserId
    && typeof record.id === 'string' && record.id.length > 0
    && typeof record.quizId === 'string' && record.quizId.length > 0
    && (record.details === undefined || Array.isArray(record.details));
}

function eligibleData(user: User) {
  const oldUser = oldUserFor(user);
  const rawQuizzes = oldQuizzes();
  const quizzes = rawQuizzes.filter(isQuiz);
  const ownedQuizzes = user.role !== 'student' && oldUser?.id
    ? quizzes.filter(quiz => quiz.teacherId === oldUser.id)
    : [];
  const exams = oldExamData();
  const sessions = user.role === 'student' && oldUser?.id
    ? exams.sessions.filter(session => hasValidAttemptShape(session, oldUser.id!))
    : [];
  const results = user.role === 'student' && oldUser?.id
    ? exams.results.filter(result => hasValidResultShape(result, oldUser.id!))
    : [];
  return {
    oldUser,
    ownedQuizzes,
    sessions,
    results,
    skippedCount: Math.max(0, rawQuizzes.length - ownedQuizzes.length)
      + Math.max(0, exams.sessions.length - sessions.length)
      + Math.max(0, exams.results.length - results.length),
  };
}

export function getLegacyMigrationPreview(user: User): LegacyMigrationPreview {
  const data = eligibleData(user);
  return {
    hasLegacyData: Object.values(KEYS).some(has),
    hasMatchingProfile: Boolean(data.oldUser),
    profileCount: data.oldUser ? 1 : 0,
    quizCount: data.ownedQuizzes.length,
    attemptCount: data.sessions.length,
    resultCount: data.results.length,
    skippedCount: data.skippedCount,
    hasUnsafeGeminiKey: has(KEYS.gemini),
    hasObsoleteSession: has(KEYS.session),
  };
}

function answersFromDetails(details: Array<{ questionId?: string; selectedAnswers?: string[] }> | undefined) {
  return Object.fromEntries((details || [])
    .filter(detail => detail.questionId)
    .map(detail => [detail.questionId!, detail.selectedAnswers || []]));
}

/** Downloads a backup without old passwords, mock tokens, or the exposed Gemini key. */
export function exportLegacyBackup(user: User): void {
  const data = eligibleData(user);
  const backup = {
    format: 'qizzone-sanitized-legacy-backup-v1',
    exportedAt: new Date().toISOString(),
    profile: data.oldUser ? { email: data.oldUser.email, fullName: data.oldUser.fullName } : null,
    quizzes: oldQuizzes(),
    exams: oldExamData(),
    omitted: ['passwords', 'mock auth token', 'Gemini API key'],
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `qizzone-legacy-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Imports only records linked to the current Firebase user's matching legacy email/id. */
export async function migrateLegacyData(user: User): Promise<void> {
  if (running) return running;
  const preview = getLegacyMigrationPreview(user);
  if (!preview.hasLegacyData) return;
  running = (async () => {
    const data = eligibleData(user);
    const report: Record<string, number | string> = { skipped: data.skippedCount, failed: 0 };
    try {
      if (data.oldUser?.fullName?.trim()) {
        await firebaseAuthService.updateProfile({ fullName: data.oldUser.fullName.trim() });
        report.profiles = 1;
      }
      let quizCount = 0;
      for (const quiz of data.ownedQuizzes) {
        await quizService.save({ ...quiz, teacherId: user.id, teacherName: user.fullName }, undefined, quiz.id);
        quizCount++;
      }
      report.quizzes = quizCount;

      const submittedSessionQuizzes = new Set<string>();
      let attemptCount = 0;
      for (const session of data.sessions) {
        const quizId = String(session.quizId);
        const id = `legacy-session-${quizId}-${String(session.startTime || '')}`;
        const wasSubmitted = Boolean(session.isSubmitted);
        await rpc('import_legacy_attempt', {
          p_legacy_id: id,
          p_quiz_legacy_id: quizId,
          p_data: { ...session, answers: session.answers || {}, isSubmitted: wasSubmitted },
        });
        if (wasSubmitted) submittedSessionQuizzes.add(quizId);
        attemptCount++;
      }
      for (const result of data.results) {
        const quizId = String(result.quizId);
        if (submittedSessionQuizzes.has(quizId)) continue;
        await rpc('import_legacy_attempt', {
          p_legacy_id: `legacy-result-${String(result.id)}`,
          p_quiz_legacy_id: quizId,
          p_data: {
            startTime: result.submittedAt ? Date.parse(String(result.submittedAt)) : Date.now(),
            isSubmitted: true,
            studentClass: result.studentClass,
            answers: answersFromDetails(result.details as Array<{ questionId?: string; selectedAnswers?: string[] }> | undefined),
          },
        });
        attemptCount++;
      }
      report.attempts = attemptCount;
      report.success = Number(report.profiles || 0) + quizCount + attemptCount;
      await rpc('mark_data_migration', { p_source_id: 'legacy-browser-v1', p_status: 'completed', p_report: report });
      Object.values(KEYS).forEach(remove);
    } catch (error) {
      report.failed = 1;
      await rpc('mark_data_migration', {
        p_source_id: 'legacy-browser-v1',
        p_status: 'partial',
        p_report: { ...report, error: error instanceof Error ? error.message.slice(0, 200) : 'unknown' },
      }).catch(() => undefined);
      throw error;
    } finally {
      running = undefined;
    }
  })();
  return running;
}
