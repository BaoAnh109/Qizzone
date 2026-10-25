import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

type Claims = { sub: string; role: 'authenticated'; app_role: 'student' | 'teacher' };

function json<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

describe('practice RPC security and isolation', () => {
  it('checks one locked question at a time and keeps practice out of exam data', async () => {
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
        ('practice-teacher','practice-teacher@example.test','Practice Teacher','teacher'),
        ('practice-student-a','practice-a@example.test','Practice A','student'),
        ('practice-student-b','practice-b@example.test','Practice B','student');
    `);

    const asUser = async <T extends Record<string, unknown>>(
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
    const teacher: Claims = { sub: 'practice-teacher', role: 'authenticated', app_role: 'teacher' };
    const studentA: Claims = { sub: 'practice-student-a', role: 'authenticated', app_role: 'student' };
    const studentB: Claims = { sub: 'practice-student-b', role: 'authenticated', app_role: 'student' };
    const questionSet = [
      { id: 'single', content: 'Chọn B', type: 'single_choice', points: 1, options: [{ id: 'A', content: 'Sai' }, { id: 'B', content: 'Đúng' }], correctAnswers: ['B'], explanation: 'B là đáp án đúng.' },
      { id: 'multi', content: 'Chọn A và C', type: 'multiple_choice', points: 1, options: [{ id: 'A', content: 'A' }, { id: 'B', content: 'B' }, { id: 'C', content: 'C' }], correctAnswers: ['A', 'C'], explanation: 'Cần chọn đủ A và C.' },
      { id: 'boolean', content: 'Mệnh đề đúng/sai', type: 'true_false', points: 1, options: [{ id: 'A', content: 'Đúng' }, { id: 'B', content: 'Sai' }], correctAnswers: ['A'], explanation: 'Mệnh đề đúng.' },
    ];
    const createQuiz = async (options: { status?: string; settings?: Record<string, unknown>; questions?: typeof questionSet } = {}) => {
      const input = {
        title: 'Luyện tập bảo mật', subject: 'Toán', description: '', status: options.status || 'published',
        settings: { durationMinutes: 30, shuffleQuestions: false, shuffleOptions: true, allowReview: true, maxAttempts: 1, passPercentage: 50, ...options.settings },
        questions: options.questions || questionSet,
      };
      const rows = await asUser<{ id: string }>(teacher, 'select public.save_quiz($1::jsonb, null, null) as id', [JSON.stringify(input)]);
      return rows[0].id;
    };
    const quizId = await createQuiz();
    const questionIds = (await db.query<{ id: string }>('select id from public.questions where quiz_id=$1 order by ordinal', [quizId])).rows.map(row => row.id);

    const quizRows = await asUser<{ payload: unknown }>(studentA, 'select public.list_quizzes() as payload');
    const listed = json<Array<{ id: string; questions: Array<{ correctAnswers: string[]; explanation: string | null }> }>>(quizRows[0].payload).find(item => item.id === quizId)!;
    expect(listed.questions.map(question => question.correctAnswers)).toEqual([[], [], []]);
    expect(listed.questions.every(question => question.explanation === null)).toBe(true);
    expect(await asUser(studentA, 'select * from public.question_answer_keys')).toEqual([]);

    const startRows = await asUser<{ payload: unknown }>(studentA, 'select public.start_practice($1, null, true) as payload', [quizId]);
    const session = json<{ id: string; questionOrder: string[]; optionOrder: Record<string, string[]> }>(startRows[0].payload);
    expect(session.questionOrder).toEqual(questionIds);
    expect(Object.keys(session.optionOrder)).toHaveLength(3);
    const emptyStateRows = await asUser<{ payload: unknown }>(studentA, 'select public.get_practice_session($1) as payload', [session.id]);
    const emptyState = json<Record<string, unknown>>(emptyStateRows[0].payload);
    expect(emptyState.answers).toEqual([]);
    expect(JSON.stringify(emptyState)).not.toContain('correctAnswers');
    await expect(asUser(studentA, 'select * from public.practice_sessions')).rejects.toThrow();
    await expect(asUser(studentA, 'select * from public.practice_answers')).rejects.toThrow();
    await expect(asUser(studentB, 'select public.get_practice_session($1)', [session.id])).rejects.toThrow(/quyền|không tìm thấy/i);
    await expect(asUser(studentB, 'select public.check_practice_answer($1,$2,$3::jsonb)', [session.id, questionIds[0], '["B"]']))
      .rejects.toThrow(/quyền|phiên/i);
    await expect(asUser(studentA, 'select public.check_practice_answer($1,$2,$3::jsonb)', [session.id, '20000000-0000-4000-8000-000000000002', '["A"]']))
      .rejects.toThrow(/câu hỏi|đề/i);

    const singleRows = await asUser<{ payload: unknown }>(studentA, 'select public.check_practice_answer($1,$2,$3::jsonb) as payload', [session.id, questionIds[0], '["B"]']);
    const single = json<{ isCorrect: boolean; correctAnswers: string[]; explanation: string; selectedAnswers: string[] }>(singleRows[0].payload);
    expect(single.isCorrect).toBe(true);
    expect(single.correctAnswers).toEqual(['B']);
    expect(single.explanation).toBe('B là đáp án đúng.');
    const repeatedRows = await asUser<{ payload: unknown }>(studentA, 'select public.check_practice_answer($1,$2,$3::jsonb) as payload', [session.id, questionIds[0], '["A"]']);
    const repeated = json<typeof single>(repeatedRows[0].payload);
    expect(repeated).toEqual(single);
    const multiRows = await asUser<{ payload: unknown }>(studentA, 'select public.check_practice_answer($1,$2,$3::jsonb) as payload', [session.id, questionIds[1], '["A"]']);
    const multi = json<{ isCorrect: boolean; correctAnswers: string[] }>(multiRows[0].payload);
    expect(multi.isCorrect).toBe(false);
    expect(multi.correctAnswers).toEqual(['A', 'C']);
    const trueFalseRows = await asUser<{ payload: unknown }>(studentA, 'select public.check_practice_answer($1,$2,$3::jsonb) as payload', [session.id, questionIds[2], '["A"]']);
    expect(json<{ isCorrect: boolean }>(trueFalseRows[0].payload).isCorrect).toBe(true);

    const resultRows = await asUser<{ payload: unknown }>(studentA, 'select public.finish_practice($1) as payload', [session.id]);
    const result = json<{ correctCount: number; totalQuestions: number; details: Array<{ correctAnswers: string[] }> }>(resultRows[0].payload);
    expect(result.correctCount).toBe(2);
    expect(result.totalQuestions).toBe(3);
    expect(result.details).toHaveLength(3);
    const repeatedFinish = await asUser<{ payload: unknown }>(studentA, 'select public.finish_practice($1) as payload', [session.id]);
    expect(json(repeatedFinish[0].payload)).toEqual(result);

    const wrongSingleSessionRows = await asUser<{ payload: unknown }>(studentA, 'select public.start_practice($1, null, true) as payload', [quizId]);
    const wrongSingleSession = json<{ id: string }>(wrongSingleSessionRows[0].payload);
    const wrongSingleRows = await asUser<{ payload: unknown }>(studentA, 'select public.check_practice_answer($1,$2,$3::jsonb) as payload', [wrongSingleSession.id, questionIds[0], '["A"]']);
    expect(json<{ isCorrect: boolean; correctAnswers: string[] }>(wrongSingleRows[0].payload)).toEqual({
      questionId: questionIds[0], selectedAnswers: ['A'], isCorrect: false, correctAnswers: ['B'],
      explanation: 'B là đáp án đúng.', checkedAt: expect.any(String), locked: true,
    });
    await asUser(studentA, 'select public.finish_practice($1)', [wrongSingleSession.id]);

    await expect(asUser(studentA, 'select public.start_practice($1, 0, true)', [quizId])).rejects.toThrow(/số câu/i);
    await expect(asUser(studentA, 'select public.start_practice($1, 4, true)', [quizId])).rejects.toThrow(/số câu/i);
    const partialRows = await asUser<{ payload: unknown }>(studentA, 'select public.start_practice($1, 1, false) as payload', [quizId]);
    const partial = json<{ id: string; questionOrder: string[] }>(partialRows[0].payload);
    expect(partial.questionOrder).toHaveLength(1);
    const partialStateRows = await asUser<{ payload: unknown }>(studentA, 'select public.get_practice_session($1) as payload', [partial.id]);
    const partialState = json<{ answers: unknown[] }>(partialStateRows[0].payload);
    expect(partialState.answers).toEqual([]);
    expect(JSON.stringify(partialState)).not.toContain('correctAnswers');
    const studentBHistory = await asUser<{ payload: unknown }>(studentB, 'select public.list_practice_history() as payload');
    expect(json(studentBHistory[0].payload)).toEqual([]);
    const partialQuestionIndex = questionIds.indexOf(partial.questionOrder[0]);
    const correctByQuestion = [['B'], ['A', 'C'], ['A']];
    const partialCheckRows = await asUser<{ payload: unknown }>(studentA, 'select public.check_practice_answer($1,$2,$3::jsonb) as payload', [partial.id, partial.questionOrder[0], JSON.stringify(correctByQuestion[partialQuestionIndex])]);
    expect(json<{ isCorrect: boolean; explanation: string | null }>(partialCheckRows[0].payload)).toMatchObject({ isCorrect: true, explanation: null });
    const partialResultRows = await asUser<{ payload: unknown }>(studentA, 'select public.finish_practice($1) as payload', [partial.id]);
    expect(json<{ details: Array<{ explanation: string }> }>(partialResultRows[0].payload).details[0].explanation).not.toBe('');

    const historyRows = await asUser<{ payload: unknown }>(studentA, 'select public.list_practice_history() as payload');
    const history = json<Array<Record<string, unknown>>>(historyRows[0].payload);
    expect(history.length).toBe(3);
    expect(JSON.stringify(history)).not.toContain('correctAnswers');
    expect(JSON.stringify(history)).not.toContain('explanation');
    const examResultsBefore = await asUser<{ payload: unknown }>(studentA, 'select public.list_results() as payload');
    expect(json(examResultsBefore[0].payload)).toEqual([]);
    expect((await db.query('select * from public.exam_attempts where quiz_id=$1', [quizId])).rows).toEqual([]);
    expect((await db.query('select * from public.exam_results')).rows).toEqual([]);

    const examRows = await asUser<{ payload: unknown }>(studentA, 'select public.start_attempt($1, null) as payload', [quizId]);
    const exam = json<{ id: string }>(examRows[0].payload);
    await asUser(studentA, 'select public.submit_attempt($1)', [exam.id]);
    const examResultsAfter = await asUser<{ payload: unknown }>(studentA, 'select public.list_results() as payload');
    expect(json<Array<{ quizId: string }>>(examResultsAfter[0].payload).map(item => item.quizId)).toEqual([quizId]);
    await expect(asUser(studentA, 'select public.start_attempt($1, null)', [quizId])).rejects.toThrow(/hết lượt/i);

    const draftId = await createQuiz({ status: 'draft' });
    const closedId = await createQuiz({ status: 'closed' });
    const disabledId = await createQuiz({ settings: { practiceEnabled: false } });
    await expect(asUser(studentA, 'select public.start_practice($1, null, true)', [draftId])).rejects.toThrow(/chưa xuất bản|đã đóng/i);
    await expect(asUser(studentA, 'select public.start_practice($1, null, true)', [closedId])).rejects.toThrow(/chưa xuất bản|đã đóng/i);
    await expect(asUser(studentA, 'select public.start_practice($1, null, true)', [disabledId])).rejects.toThrow(/tắt chức năng luyện tập/i);

    const closedMidwayId = await createQuiz();
    const midwayRows = await asUser<{ payload: unknown }>(studentA, 'select public.start_practice($1, null, true) as payload', [closedMidwayId]);
    const midway = json<{ id: string }>(midwayRows[0].payload);
    await asUser(teacher, 'select public.set_quiz_status($1, $2)', [closedMidwayId, 'closed']);
    const invalidatedRows = await asUser<{ payload: unknown }>(studentA, 'select public.get_practice_session($1) as payload', [midway.id]);
    expect(json<{ status: string; message: string }>(invalidatedRows[0].payload)).toMatchObject({ status: 'invalidated' });

    const editedQuizId = await createQuiz();
    const editedSessionRows = await asUser<{ payload: unknown }>(studentA, 'select public.start_practice($1, null, true) as payload', [editedQuizId]);
    const editedSession = json<{ id: string }>(editedSessionRows[0].payload);
    await asUser(teacher, 'select public.save_quiz($1::jsonb, $2, null)', [JSON.stringify({
      title: 'Đề đã sửa', subject: 'Toán', description: '', status: 'published',
      settings: { durationMinutes: 30, shuffleQuestions: false, shuffleOptions: true, allowReview: true, maxAttempts: 1, passPercentage: 50 },
      questions: questionSet,
    }), editedQuizId]);
    const editedStateRows = await asUser<{ payload: unknown }>(studentA, 'select public.get_practice_session($1) as payload', [editedSession.id]);
    expect(json<{ status: string; message: string }>(editedStateRows[0].payload)).toMatchObject({ status: 'invalidated' });

    const deletedQuizId = await createQuiz();
    const deletedSessionRows = await asUser<{ payload: unknown }>(studentA, 'select public.start_practice($1, null, true) as payload', [deletedQuizId]);
    const deletedSession = json<{ id: string }>(deletedSessionRows[0].payload);
    await asUser(teacher, 'select public.delete_quiz($1)', [deletedQuizId]);
    const deletedStateRows = await asUser<{ payload: unknown }>(studentA, 'select public.get_practice_session($1) as payload', [deletedSession.id]);
    expect(json<{ status: string; message: string }>(deletedStateRows[0].payload)).toMatchObject({ status: 'invalidated' });

    const emptyQuizRows = await db.query<{ id: string }>(
      `insert into public.quizzes(teacher_uid,title,subject,status,settings)
       values ('practice-teacher','Đề rỗng','Toán','published',
         '{"durationMinutes":0,"shuffleQuestions":false,"shuffleOptions":false,"allowReview":true,"maxAttempts":1,"passPercentage":50}'::jsonb)
       returning id`,
    );
    await expect(asUser(studentA, 'select public.start_practice($1, null, true)', [emptyQuizRows.rows[0].id])).rejects.toThrow(/chưa có câu hỏi/i);

    await db.close();
  }, 30_000);
});
