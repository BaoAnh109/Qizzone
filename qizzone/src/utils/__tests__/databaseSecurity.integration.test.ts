import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

type Claims = { sub: string; role: 'authenticated'; app_role: 'student' | 'teacher' | 'admin' };

function json<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

describe('Supabase migration, RLS, and server-side grading', () => {
  it('enforces tenant roles and never exposes answer keys to students', async () => {
    const db = new PGlite();
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create function auth.jwt() returns jsonb language sql stable as
        $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant execute on function auth.jwt() to anon, authenticated, service_role;
    `);
    const migrationsDirectory = fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url));
    for (const migration of readdirSync(migrationsDirectory).filter(name => name.endsWith('.sql')).sort()) {
      await db.exec(readFileSync(`${migrationsDirectory}/${migration}`, 'utf8'));
    }
    const seedPath = fileURLToPath(new URL('../../../../supabase/seed.sql', import.meta.url));
    await db.exec(readFileSync(seedPath, 'utf8'));
    await db.exec(`
      insert into public.profiles(firebase_uid,email,full_name,role) values
        ('teacher-a','teacher-a@example.test','Teacher A','teacher'),
        ('teacher-b','teacher-b@example.test','Teacher B','teacher'),
        ('student-a','student-a@example.test','Student A','student'),
        ('student-b','student-b@example.test','Student B','student'),
        ('admin-a','admin-a@example.test','Admin A','admin'),
        ('teacher-pending','teacher-pending@example.test','Pending Teacher','teacher');
      update public.profiles set approval_status='pending' where firebase_uid='teacher-pending';
    `);

    const asAuthenticated = async <T extends Record<string, unknown>>(
      claims: Claims,
      sql: string,
      params: unknown[] = [],
    ): Promise<T[]> => {
      await db.exec('reset role');
      await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
      await db.exec('set role authenticated');
      try {
        return (await db.query<T>(sql, params)).rows;
      } finally {
        await db.exec('reset role');
      }
    };

    const teacherA: Claims = { sub: 'teacher-a', role: 'authenticated', app_role: 'teacher' };
    const teacherB: Claims = { sub: 'teacher-b', role: 'authenticated', app_role: 'teacher' };
    const studentA: Claims = { sub: 'student-a', role: 'authenticated', app_role: 'student' };
    const studentB: Claims = { sub: 'student-b', role: 'authenticated', app_role: 'student' };
    const admin: Claims = { sub: 'admin-a', role: 'authenticated', app_role: 'admin' };
    const pendingTeacher: Claims = { sub: 'teacher-pending', role: 'authenticated', app_role: 'teacher' };
    const quizInput = {
      title: 'Security test', subject: 'Math', description: '', status: 'published',
      settings: { durationMinutes: 10, shuffleQuestions: true, shuffleOptions: true, allowReview: true, maxAttempts: 2, passPercentage: 50 },
      questions: [{
        id: 'legacy-question-1', content: '2 + 2 = ?', type: 'single_choice', points: 10,
        options: [{ id: 'A', content: '3' }, { id: 'B', content: '4' }],
        correctAnswers: ['B'], explanation: '2 + 2 = 4',
      }],
    };
    const saved = await asAuthenticated<{ id: string }>(
      teacherA,
      'select public.save_quiz($1::jsonb, null, null) as id',
      [JSON.stringify(quizInput)],
    );
    const quizId = saved[0].id;

    await expect(asAuthenticated(teacherB, 'select public.set_quiz_status($1, $2)', [quizId, 'closed']))
      .rejects.toThrow(/quyền/i);
    await expect(asAuthenticated(studentA, 'select public.save_quiz($1::jsonb, null, null)', [JSON.stringify(quizInput)]))
      .rejects.toThrow(/giáo viên/i);
    await expect(asAuthenticated(pendingTeacher, 'select public.save_quiz($1::jsonb, null, null)', [JSON.stringify(quizInput)]))
      .rejects.toThrow(/giáo viên/i);
    await expect(asAuthenticated(studentA, "update public.profiles set role='teacher' where firebase_uid='student-a'"))
      .rejects.toThrow();
    await expect(asAuthenticated(
      { sub: 'student-a', role: 'authenticated', app_role: 'teacher' },
      'select public.save_quiz($1::jsonb, null, null)',
      [JSON.stringify(quizInput)],
    )).rejects.toThrow(/giáo viên/i);

    const studentQuizRows = await asAuthenticated<{ payload: unknown }>(studentA, 'select public.list_quizzes() as payload');
    const studentQuizzes = json<Array<{ id: string; questions: Array<{ id: string; correctAnswers: string[]; explanation: string | null }> }>>(studentQuizRows[0].payload);
    expect(studentQuizzes[0].questions[0].correctAnswers).toEqual([]);
    expect(studentQuizzes[0].questions[0].explanation).toBeNull();
    expect(await asAuthenticated(studentA, 'select * from public.question_answer_keys')).toEqual([]);

    const startRows = await asAuthenticated<{ payload: unknown }>(studentA, 'select public.start_attempt($1, null) as payload', [quizId]);
    const session = json<{ id: string; revision: number; questionOrder: string[] }>(startRows[0].payload);
    await expect(asAuthenticated(studentB, 'select public.save_attempt($1,$2,$3::jsonb,$4::jsonb,$5)', [session.id, 0, '{}', '[]', 0]))
      .rejects.toThrow(/quyền|phiên/i);
    await expect(asAuthenticated(
      studentA,
      "insert into public.exam_results(id,attempt_id,payload) values('30000000-0000-4000-8000-000000000001',$1,'{\"score\":10}'::jsonb)",
      [session.id],
    )).rejects.toThrow();

    const firstSaveRows = await asAuthenticated<{ payload: unknown }>(
      studentA,
      'select public.save_attempt($1,$2,$3::jsonb,$4::jsonb,$5) as payload',
      [session.id, session.revision, JSON.stringify({ [session.questionOrder[0]]: ['A'] }), '[]', 0],
    );
    const firstSave = json<{ revision: number }>(firstSaveRows[0].payload);
    const answers = JSON.stringify({ [session.questionOrder[0]]: ['B'] });
    await expect(asAuthenticated(studentA, 'select public.save_attempt($1,$2,$3::jsonb,$4::jsonb,$5)', [session.id, session.revision, answers, '[]', 0]))
      .rejects.toThrow(/CONFLICT/);
    await asAuthenticated(studentA, 'select public.save_attempt($1,$2,$3::jsonb,$4::jsonb,$5)', [session.id, firstSave.revision, answers, '[]', 0]);
    const resultRows = await asAuthenticated<{ payload: unknown }>(studentA, 'select public.submit_attempt($1) as payload', [session.id]);
    const result = json<{ score: number; correctCount: number }>(resultRows[0].payload);
    expect(result.score).toBe(10);
    expect(result.correctCount).toBe(1);

    expect(await asAuthenticated(studentB, 'select * from public.exam_attempts')).toEqual([]);
    const otherResults = await asAuthenticated<{ payload: unknown }>(studentB, 'select public.list_results() as payload');
    expect(json(otherResults[0].payload)).toEqual([]);

    await asAuthenticated(
      teacherA,
      'select public.save_quiz($1::jsonb, null, $2)',
      [JSON.stringify(quizInput), 'legacy-quiz-shared'],
    );
    await asAuthenticated(
      studentB,
      'select public.import_legacy_attempt($1,$2,$3::jsonb)',
      ['legacy-active', 'legacy-quiz-shared', JSON.stringify({ isSubmitted: false, answers: {} })],
    );
    const importedResult = await asAuthenticated<{ payload: unknown }>(
      studentB,
      'select public.import_legacy_attempt($1,$2,$3::jsonb) as payload',
      ['legacy-result', 'legacy-quiz-shared', JSON.stringify({ isSubmitted: true, answers: { 'legacy-question-1': ['B'] } })],
    );
    expect(json<{ isSubmitted: boolean }>(importedResult[0].payload).isSubmitted).toBe(true);
    const importedAgain = await asAuthenticated<{ payload: unknown }>(
      studentB,
      'select public.import_legacy_attempt($1,$2,$3::jsonb) as payload',
      ['legacy-result', 'legacy-quiz-shared', JSON.stringify({ isSubmitted: true })],
    );
    expect(json<{ id: string }>(importedAgain[0].payload).id).toBe(json<{ id: string }>(importedResult[0].payload).id);

    const adminRows = await asAuthenticated<{ payload: unknown }>(admin, 'select public.list_quizzes() as payload');
    const adminQuizzes = json<Array<{ questions: Array<{ correctAnswers: string[] }> }>>(adminRows[0].payload);
    expect(adminQuizzes[0].questions[0].correctAnswers).toEqual(['B']);

    await db.exec("set role anon");
    await expect(db.query('select public.list_quizzes()')).rejects.toThrow();
    await db.exec('reset role');
    await db.close();
  }, 30_000);
});
