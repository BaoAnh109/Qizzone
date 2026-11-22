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
      create schema storage;
      create table storage.buckets (
        id text primary key,
        name text not null,
        public boolean not null default false,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table storage.objects (bucket_id text not null, name text not null);
      alter table storage.objects enable row level security;
      grant select on storage.objects to anon, authenticated;
      grant insert on storage.objects to authenticated;
      create function auth.jwt() returns jsonb language sql stable as
        $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant usage on schema storage to anon, authenticated;
      grant execute on function auth.jwt() to anon, authenticated, service_role;
    `);
    const migrationsDirectory = fileURLToPath(new URL('../../../../../supabase/migrations/', import.meta.url));
    for (const migration of readdirSync(migrationsDirectory).filter(name => name.endsWith('.sql')).sort()) {
      await db.exec(readFileSync(`${migrationsDirectory}/${migration}`, 'utf8'));
    }
    const seedPath = fileURLToPath(new URL('../../../../../supabase/seed.sql', import.meta.url));
    await db.exec(readFileSync(seedPath, 'utf8'));
    await db.exec(`
      insert into public.profiles(firebase_uid,email,full_name,role) values
        ('teacher-a','teacher-a@example.test','Teacher A','teacher'),
        ('teacher-b','teacher-b@example.test','Teacher B','teacher'),
        ('student-a','student-a@example.test','Student A','student'),
        ('student-b','student-b@example.test','Student B','student'),
        ('student-c','student-c@example.test','Student C','student'),
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
    const studentC: Claims = { sub: 'student-c', role: 'authenticated', app_role: 'student' };
    const admin: Claims = { sub: 'admin-a', role: 'authenticated', app_role: 'admin' };
    const pendingTeacher: Claims = { sub: 'teacher-pending', role: 'authenticated', app_role: 'teacher' };
    const quizInput = {
      title: 'Security test', subject: 'Math', description: '', status: 'published',
      settings: {
        durationMinutes: 10, shuffleQuestions: true, shuffleOptions: true, allowReview: true,
        maxAttempts: 2, passPercentage: 50,
        assignedEmails: ['student-a@example.test', 'student-b@example.test', 'outsider@example.test'],
      },
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
    const studentQuizzes = json<Array<{
      id: string;
      code: string;
      settings: { assignedEmails: string[] };
      questions: Array<{ id: string; correctAnswers: string[]; explanation: string | null }>;
    }>>(studentQuizRows[0].payload);
    expect(studentQuizzes[0].questions[0].correctAnswers).toEqual([]);
    expect(studentQuizzes[0].questions[0].explanation).toBeNull();
    expect(studentQuizzes[0].settings.assignedEmails).toEqual(['student-a@example.test']);
    expect(JSON.stringify(studentQuizzes)).not.toContain('student-b@example.test');
    expect(JSON.stringify(studentQuizzes)).not.toContain('outsider@example.test');
    expect(await asAuthenticated(studentA, 'select * from public.question_answer_keys')).toEqual([]);

    const studentBQuizRows = await asAuthenticated<{ payload: unknown }>(studentB, 'select public.list_quizzes() as payload');
    const studentBQuizzes = json<Array<{ settings: { assignedEmails: string[] } }>>(studentBQuizRows[0].payload);
    expect(studentBQuizzes[0].settings.assignedEmails).toEqual(['student-b@example.test']);
    expect(JSON.stringify(studentBQuizzes)).not.toContain('student-a@example.test');
    expect(JSON.stringify(studentBQuizzes)).not.toContain('outsider@example.test');

    const studentCQuizRows = await asAuthenticated<{ payload: unknown }>(studentC, 'select public.list_quizzes() as payload');
    const studentCQuizzes = json<Array<{ code: string; settings: { assignedEmails: string[] } }>>(studentCQuizRows[0].payload);
    expect(studentCQuizzes[0].code).toBeDefined();
    expect(studentCQuizzes[0].settings.assignedEmails).toEqual([]);

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
    const adminQuizzes = json<Array<{
      settings: { assignedEmails: string[] };
      questions: Array<{ correctAnswers: string[] }>;
    }>>(adminRows[0].payload);
    expect(adminQuizzes[0].questions[0].correctAnswers).toEqual(['B']);
    expect(adminQuizzes[0].settings.assignedEmails).toEqual([
      'student-a@example.test', 'student-b@example.test', 'outsider@example.test',
    ]);

    await db.exec("set role anon");
    await expect(db.query('select public.list_quizzes()')).rejects.toThrow();
    await db.exec('reset role');

    // V3 checks: private.answer_keys isolation, 5-option quizzes, R2 materials/AI jobs RLS, idempotent finalize, notifications
    await expect(asAuthenticated(studentA, 'select * from private.answer_keys')).rejects.toThrow();

    const fiveOptQuiz = {
      title: 'Five option quiz', subject: 'Physics', description: '', status: 'published',
      settings: { durationMinutes: 20, shuffleQuestions: false, shuffleOptions: false, allowReview: true, maxAttempts: 2, passPercentage: 50 },
      questions: [{
        id: 'q-five-1', content: 'Chọn E', type: 'single_choice', points: 10,
        options: [
          { id: 'A', content: '1' }, { id: 'B', content: '2' }, { id: 'C', content: '3' },
          { id: 'D', content: '4' }, { id: 'E', content: '5' },
        ],
        correctAnswers: ['E'], explanation: 'Đáp án là E',
      }],
    };
    const fiveQuizSaved = await asAuthenticated<{ id: string }>(teacherA, 'select public.save_quiz($1::jsonb, null, null) as id', [JSON.stringify(fiveOptQuiz)]);
    const fiveStartRows = await asAuthenticated<{ payload: unknown }>(studentA, 'select public.start_attempt($1, null) as payload', [fiveQuizSaved[0].id]);
    const fiveSession = json<{ id: string; revision: number; questionOrder: string[] }>(fiveStartRows[0].payload);
    await asAuthenticated(studentA, 'select public.save_attempt($1,$2,$3::jsonb,$4::jsonb,$5)', [
      fiveSession.id, fiveSession.revision, JSON.stringify({ [fiveSession.questionOrder[0]]: ['E'] }), '[]', 0,
    ]);
    const fin1 = await asAuthenticated<{ payload: unknown }>(
      studentA,
      "select public.finalize_exam_attempt($1, 'idem-key-123456') as payload",
      [fiveSession.id],
    );
    const fin2 = await asAuthenticated<{ payload: unknown }>(
      studentA,
      "select public.finalize_exam_attempt($1, 'idem-key-123456') as payload",
      [fiveSession.id],
    );
    expect(json<{ score: number; status: string }>(fin1[0].payload)).toMatchObject({ score: 10, status: 'submitted' });
    expect(json<{ score: number; status: string }>(fin2[0].payload)).toEqual(json(fin1[0].payload));

    // Materials & AI Jobs RLS (IDOR protection)
    await expect(
      asAuthenticated(studentA, "insert into public.materials(owner_uid,object_key,file_name,mime_type,size_bytes) values ('student-a','materials/student-a/a.pdf','a.pdf','application/pdf',1024)"),
    ).rejects.toThrow();
    await asAuthenticated(
      teacherA,
      "insert into public.materials(id,owner_uid,object_key,file_name,mime_type,size_bytes,status) values ('40000000-0000-4000-8000-000000000001','teacher-a','materials/teacher-a/doc.pdf','doc.pdf','application/pdf',2048,'ready')",
    );
    expect(await asAuthenticated(teacherB, 'select * from public.materials')).toEqual([]);
    await asAuthenticated(teacherB, "update public.materials set status='deleted' where id='40000000-0000-4000-8000-000000000001'");
    const stillReady = await asAuthenticated<{ status: string }>(teacherA, "select status from public.materials where id='40000000-0000-4000-8000-000000000001'");
    expect(stillReady[0].status).toBe('ready');

    // Notification preferences opt-out & outbox idempotency (Asia/Ho_Chi_Minh)
    await asAuthenticated(studentA, "select public.update_notification_preferences('{\"examResultEmail\": false}'::jsonb)");
    await db.exec('reset role');
    const optOutOutbox = (await db.query<{ id: string }>(
      "select public.enqueue_notification('student-a','exam_result','exam_result','{\"quizTitle\":\"Toán\"}'::jsonb,'res-idem-1') as id",
    )).rows[0].id;
    const mandatoryOutbox = (await db.query<{ id: string }>(
      "select public.enqueue_notification('student-a','security_alert','security_alert','{\"message\":\"Mật khẩu đã đổi\"}'::jsonb,'sec-idem-1') as id",
    )).rows[0].id;
    const dupOutbox = (await db.query<{ id: string }>(
      "select public.enqueue_notification('student-a','security_alert','security_alert','{\"message\":\"Duplicate\"}'::jsonb,'sec-idem-1') as id",
    )).rows[0].id;
    expect(dupOutbox).toBe(mandatoryOutbox);
    const outboxStatuses = (await db.query<{ id: string; status: string }>(
      'select id, status from public.notification_outbox where id in ($1, $2)',
      [optOutOutbox, mandatoryOutbox],
    )).rows;
    expect(outboxStatuses.find(r => r.id === optOutOutbox)?.status).toBe('skipped');
    expect(outboxStatuses.find(r => r.id === mandatoryOutbox)?.status).toBe('pending');

    await db.close();
  }, 30_000);

  it('enforces classrooms, Azota publish scope/visibility, deadlines, notifications, and bug reports RBAC', async () => {
    const db = new PGlite();
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create schema storage;
      create table storage.buckets (
        id text primary key,
        name text not null,
        public boolean not null default false,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table storage.objects (bucket_id text not null, name text not null);
      alter table storage.objects enable row level security;
      grant select on storage.objects to anon, authenticated;
      grant insert on storage.objects to authenticated;
      create function auth.jwt() returns jsonb language sql stable as
        $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant usage on schema storage to anon, authenticated;
      grant execute on function auth.jwt() to anon, authenticated, service_role;
    `);
    const migrationsDirectory = fileURLToPath(new URL('../../../../../supabase/migrations/', import.meta.url));
    for (const migration of readdirSync(migrationsDirectory).filter(name => name.endsWith('.sql')).sort()) {
      await db.exec(readFileSync(`${migrationsDirectory}/${migration}`, 'utf8'));
    }
    const seedPath = fileURLToPath(new URL('../../../../../supabase/seed.sql', import.meta.url));
    await db.exec(readFileSync(seedPath, 'utf8'));
    await db.exec(`
      insert into public.profiles(firebase_uid,email,full_name,role) values
        ('teacher-a','teacher-a@example.test','Teacher A','teacher'),
        ('teacher-b','teacher-b@example.test','Teacher B','teacher'),
        ('student-a','student-a@example.test','Student A','student'),
        ('student-b','student-b@example.test','Student B','student'),
        ('student-c','student-c@example.test','Student C','student'),
        ('admin-a','admin-a@example.test','Admin A','admin');
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
    const studentC: Claims = { sub: 'student-c', role: 'authenticated', app_role: 'student' };
    const admin: Claims = { sub: 'admin-a', role: 'authenticated', app_role: 'admin' };

    // 1. Classroom CRUD, code join, bulk email import & student privacy
    const createdClsRows = await asAuthenticated<{ payload: unknown }>(
      teacherA,
      "select public.create_classroom('Lớp 12A1', 'Toán', '12', 'Ôn thi THPT') as payload",
    );
    const classroom = json<{ id: string; inviteCode: string; name: string }>(createdClsRows[0].payload);
    expect(classroom.name).toBe('Lớp 12A1');
    expect(classroom.inviteCode).toHaveLength(6);

    const regenRows = await asAuthenticated<{ code: string }>(
      teacherA,
      'select public.regenerate_classroom_code($1) as code',
      [classroom.id],
    );
    const newCode = regenRows[0].code;
    expect(newCode).toHaveLength(6);

    await expect(
      asAuthenticated(teacherB, 'select public.update_classroom($1, $2)', [classroom.id, 'Hack']),
    ).rejects.toThrow(/quyền/i);

    await asAuthenticated(
      studentA,
      "select public.join_classroom_by_code($1, 'code')",
      [newCode],
    );

    const bulkRows = await asAuthenticated<{ payload: unknown }>(
      teacherA,
      "select public.add_classroom_members_bulk($1, $2::text[], 'excel_import') as payload",
      [classroom.id, ['student-a@example.test', 'student-b@example.test', 'pending@example.test', 'bad-email']],
    );
    const bulkResult = json<{
      addedActive: number;
      addedPending: number;
      skippedExisting: number;
      invalidEmails: string[];
    }>(bulkRows[0].payload);
    expect(bulkResult).toEqual({
      addedActive: 1,
      addedPending: 1,
      skippedExisting: 1,
      invalidEmails: ['bad-email'],
    });

    // Teacher sees full roster; Student A sees only own row; Student C (outsider) is rejected
    const teacherDetailRows = await asAuthenticated<{ payload: unknown }>(
      teacherA,
      'select public.get_classroom_detail($1) as payload',
      [classroom.id],
    );
    const teacherDetail = json<{ members: Array<{ invitedEmail: string; status: string }> }>(teacherDetailRows[0].payload);
    expect(teacherDetail.members).toHaveLength(3);

    const studentADetailRows = await asAuthenticated<{ payload: unknown }>(
      studentA,
      'select public.get_classroom_detail($1) as payload',
      [classroom.id],
    );
    const studentADetail = json<{ members: Array<{ invitedEmail: string }> }>(studentADetailRows[0].payload);
    expect(studentADetail.members).toHaveLength(1);
    expect(studentADetail.members[0].invitedEmail).toBe('student-a@example.test');
    expect(JSON.stringify(studentADetail)).not.toContain('student-b@example.test');
    expect(JSON.stringify(studentADetail)).not.toContain('pending@example.test');

    await expect(
      asAuthenticated(studentC, 'select public.get_classroom_detail($1)', [classroom.id]),
    ).rejects.toThrow(/quyền/i);

    // 2. Azota class_only quiz isolation + post-attempt publish settings update
    const classQuizInput = {
      title: 'Kiểm tra 12A1',
      subject: 'Toán',
      description: '',
      status: 'published',
      settings: {
        durationMinutes: 15,
        shuffleQuestions: false,
        shuffleOptions: false,
        allowReview: true,
        maxAttempts: 2,
        passPercentage: 50,
        publishScope: 'class_only',
        scoreVisibility: 'never',
        answerVisibility: 'never',
      },
      questions: [{
        id: 'q-cls-1',
        content: '1 + 1 = ?',
        type: 'single_choice',
        points: 10,
        options: [{ id: 'A', content: '2' }, { id: 'B', content: '3' }],
        correctAnswers: ['A'],
        explanation: '1 + 1 = 2',
      }],
    };
    const qSaved = await asAuthenticated<{ id: string }>(
      teacherA,
      'select public.save_quiz($1::jsonb, null, null) as id',
      [JSON.stringify(classQuizInput)],
    );
    const classQuizId = qSaved[0].id;
    const quizCodeRows = await asAuthenticated<{ payload: unknown }>(teacherA, 'select public.list_quizzes() as payload');
    const classQuiz = json<Array<{ id: string; code: string }>>(quizCodeRows[0].payload).find(x => x.id === classQuizId)!;

    const pastDue = new Date(Date.now() - 120_000).toISOString();
    const futureDue = new Date(Date.now() + 3600_000).toISOString();
    const assignRows = await asAuthenticated<{ payload: unknown }>(
      teacherA,
      'select public.assign_quiz_to_classrooms($1, $2::jsonb) as payload',
      [classQuizId, JSON.stringify([{ classroomId: classroom.id, dueAt: futureDue, latePolicy: 'allow_late' }])],
    );
    const assignmentId = json<Array<{ id: string }>>(assignRows[0].payload)[0].id;

    // Student C (not in classroom) cannot see, join by code, start attempt, or practice class_only quiz
    const studentCVisible = json<Array<{ id: string }>>(
      (await asAuthenticated<{ payload: unknown }>(studentC, 'select public.list_quizzes() as payload'))[0].payload,
    );
    expect(studentCVisible.some(item => item.id === classQuizId)).toBe(false);
    await expect(asAuthenticated(studentC, 'select public.join_quiz_by_code($1)', [classQuiz.code])).rejects.toThrow(/lớp học/i);
    await expect(asAuthenticated(studentC, 'select public.start_attempt($1, null, null)', [classQuizId])).rejects.toThrow(/lớp học/i);
    await expect(asAuthenticated(studentC, 'select public.start_practice($1, 1, true)', [classQuizId])).rejects.toThrow(/quyền/i);

    // Student A can join by code, start attempt, submit, and scoreVisibility='never' hides score & answers
    const joinedQuiz = await asAuthenticated<{ payload: unknown }>(studentA, 'select public.join_quiz_by_code($1) as payload', [classQuiz.code]);
    expect(json<{ id: string }>(joinedQuiz[0].payload).id).toBe(classQuizId);

    const attemptRows = await asAuthenticated<{ payload: unknown }>(
      studentA,
      'select public.start_attempt($1, null, $2) as payload',
      [classQuizId, assignmentId],
    );
    const attempt = json<{ id: string; revision: number; questionOrder: string[] }>(attemptRows[0].payload);
    await asAuthenticated(studentA, 'select public.save_attempt($1,$2,$3::jsonb,$4::jsonb,$5)', [
      attempt.id, attempt.revision, JSON.stringify({ [attempt.questionOrder[0]]: ['A'] }), '[]', 0,
    ]);
    const subHiddenRows = await asAuthenticated<{ payload: unknown }>(
      studentA,
      "select public.finalize_exam_attempt($1, 'idem-cls-1') as payload",
      [attempt.id],
    );
    const subHidden = json<{
      score: number | null;
      result: { score: number | null; scoreHidden: boolean; answersHidden: boolean; details: unknown[] };
    }>(subHiddenRows[0].payload);
    expect(subHidden.score).toBeNull();
    expect(subHidden.result.score).toBeNull();
    expect(subHidden.result.scoreHidden).toBe(true);
    expect(subHidden.result.answersHidden).toBe(true);
    expect(subHidden.result.details).toEqual([]);

    // Teacher still sees full unredacted score & details
    const teacherResults = json<Array<{ score: number; scoreHidden: boolean; details: unknown[] }>>(
      (await asAuthenticated<{ payload: unknown }>(teacherA, 'select public.list_results() as payload'))[0].payload,
    );
    expect(teacherResults[0].score).toBe(10);
    expect(teacherResults[0].scoreHidden).toBe(false);
    expect(teacherResults[0].details).toHaveLength(1);

    // update_quiz_publish_settings works even after attempts exist; after_close unlocks once closesAt <= now
    const pastClose = new Date(Date.now() - 10_000).toISOString();
    await asAuthenticated(
      teacherA,
      'select public.update_quiz_publish_settings($1, $2::jsonb, null)',
      [classQuizId, JSON.stringify({ scoreVisibility: 'after_close', answerVisibility: 'after_close', closesAt: pastClose })],
    );
    const unlockedResults = json<Array<{ score: number; scoreHidden: boolean; answersHidden: boolean; details: unknown[] }>>(
      (await asAuthenticated<{ payload: unknown }>(studentA, 'select public.list_results() as payload'))[0].payload,
    );
    expect(unlockedResults[0].score).toBe(10);
    expect(unlockedResults[0].scoreHidden).toBe(false);
    expect(unlockedResults[0].answersHidden).toBe(false);
    expect(unlockedResults[0].details).toHaveLength(1);

    // 3. Deadline policies: allow_late marks isLate + lateSeconds; block_after_due rejects past due
    await asAuthenticated(
      teacherA,
      'select public.update_quiz_publish_settings($1, $2::jsonb, null)',
      [classQuizId, JSON.stringify({ closesAt: null, scoreVisibility: 'immediate', answerVisibility: 'immediate' })],
    );
    await asAuthenticated(
      teacherA,
      'select public.assign_quiz_to_classrooms($1, $2::jsonb)',
      [classQuizId, JSON.stringify([{ classroomId: classroom.id, dueAt: pastDue, latePolicy: 'allow_late' }])],
    );
    const lateStart = json<{ id: string; revision: number; questionOrder: string[] }>(
      (await asAuthenticated<{ payload: unknown }>(studentB, 'select public.start_attempt($1, null, $2) as payload', [classQuizId, assignmentId]))[0].payload,
    );
    await asAuthenticated(studentB, 'select public.save_attempt($1,$2,$3::jsonb,$4::jsonb,$5)', [
      lateStart.id, lateStart.revision, JSON.stringify({ [lateStart.questionOrder[0]]: ['A'] }), '[]', 0,
    ]);
    const lateResult = json<{ isLate: boolean; lateSeconds: number }>(
      (await asAuthenticated<{ payload: unknown }>(studentB, 'select public.submit_attempt($1) as payload', [lateStart.id]))[0].payload,
    );
    expect(lateResult.isLate).toBe(true);
    expect(lateResult.lateSeconds).toBeGreaterThan(0);

    // Tracking & Student assignments
    const tracking = json<{ summary: { total: number; submittedOnTime: number; submittedLate: number; notSubmitted: number } }>(
      (await asAuthenticated<{ payload: unknown }>(teacherA, 'select public.list_teacher_quiz_tracking($1, $2) as payload', [classQuizId, classroom.id]))[0].payload,
    );
    expect(tracking.summary).toMatchObject({ total: 3, submittedOnTime: 1, submittedLate: 1, notSubmitted: 1 });

    const studentAAssignments = json<Array<{ status: string; bestScore: number }>>(
      (await asAuthenticated<{ payload: unknown }>(studentA, 'select public.list_student_assignments($1) as payload', [classroom.id]))[0].payload,
    );
    expect(studentAAssignments[0].status).toBe('completed');
    expect(studentAAssignments[0].bestScore).toBe(10);

    // block_after_due rejects start_attempt when past due
    await asAuthenticated(
      teacherA,
      'select public.assign_quiz_to_classrooms($1, $2::jsonb)',
      [classQuizId, JSON.stringify([{ classroomId: classroom.id, dueAt: pastDue, latePolicy: 'block_after_due' }])],
    );
    await expect(
      asAuthenticated(studentA, 'select public.start_attempt($1, null, $2)', [classQuizId, assignmentId]),
    ).rejects.toThrow(/quá hạn/i);

    // 4. In-App Notifications & Bug Reports RBAC
    const studentBNotifs = json<{ unreadCount: number; items: Array<{ id: string; type: string; targetRoute: string }> }>(
      (await asAuthenticated<{ payload: unknown }>(studentB, 'select public.list_my_notifications(20, false) as payload'))[0].payload,
    );
    expect(studentBNotifs.unreadCount).toBeGreaterThanOrEqual(2);
    expect(studentBNotifs.items.some(n => n.targetRoute === `/student/classes/${classroom.id}`)).toBe(true);
    await asAuthenticated(studentB, 'select public.mark_notifications_read(null)');
    const afterReadNotifs = json<{ unreadCount: number }>(
      (await asAuthenticated<{ payload: unknown }>(studentB, 'select public.list_my_notifications(20, true) as payload'))[0].payload,
    );
    expect(afterReadNotifs.unreadCount).toBe(0);

    const createdBug = json<{ id: string; status: string }>(
      (await asAuthenticated<{ payload: unknown }>(
        studentA,
        "select public.create_bug_report('Lỗi hiển thị công thức', 'Công thức toán bị tràn khung trên màn hình nhỏ', 'ui', 'high', '/student/classes', '{}'::jsonb) as payload",
      ))[0].payload,
    );
    expect(createdBug.status).toBe('new');

    // Admin received notification; Student B cannot see Student A's bug report
    const adminNotifs = json<{ items: Array<{ type: string; targetRoute: string }> }>(
      (await asAuthenticated<{ payload: unknown }>(admin, 'select public.list_my_notifications(20, false) as payload'))[0].payload,
    );
    expect(adminNotifs.items.some(n => n.type === 'bug_report_created' && n.targetRoute === `/admin/bug-reports?reportId=${createdBug.id}`)).toBe(true);
    expect(json((await asAuthenticated<{ payload: unknown }>(studentB, 'select public.list_bug_reports(null, null) as payload'))[0].payload)).toEqual([]);
    await expect(
      asAuthenticated(studentA, "select public.update_bug_report_status($1, 'resolved', 'hack')", [createdBug.id]),
    ).rejects.toThrow(/quản trị viên/i);

    const updatedBug = json<{ status: string; adminResponse: string }>(
      (await asAuthenticated<{ payload: unknown }>(
        admin,
        "select public.update_bug_report_status($1, 'resolved', 'Đã sửa CSS wrap') as payload",
        [createdBug.id],
      ))[0].payload,
    );
    expect(updatedBug.status).toBe('resolved');
    expect(updatedBug.adminResponse).toBe('Đã sửa CSS wrap');

    const studentANotifs = json<{ items: Array<{ type: string; targetRoute: string }> }>(
      (await asAuthenticated<{ payload: unknown }>(studentA, 'select public.list_my_notifications(20, false) as payload'))[0].payload,
    );
    expect(
      studentANotifs.items.some(n => n.type === 'bug_report_updated' && n.targetRoute === `/student/bug-reports?reportId=${createdBug.id}`),
    ).toBe(true);

    // 5. Direct table RLS assertions (no 42501, strict row & write isolation)
    expect((await asAuthenticated<{ id: string }>(teacherA, 'select id from public.classrooms')).map(r => r.id)).toEqual([classroom.id]);
    expect(await asAuthenticated(teacherB, 'select id from public.classrooms')).toEqual([]);
    expect((await asAuthenticated<{ id: string }>(studentA, 'select id from public.classrooms')).map(r => r.id)).toEqual([classroom.id]);
    expect(await asAuthenticated(studentC, 'select id from public.classrooms')).toEqual([]);
    expect((await asAuthenticated<{ id: string }>(admin, 'select id from public.classrooms')).map(r => r.id)).toEqual([classroom.id]);
    await expect(
      asAuthenticated(teacherA, "insert into public.classrooms(teacher_uid, name) values ('teacher-a', 'Direct')"),
    ).rejects.toThrow();
    await expect(
      asAuthenticated(studentA, "update public.classrooms set name = 'Hacked' where id = $1", [classroom.id]),
    ).rejects.toThrow();

    expect(await asAuthenticated(teacherA, 'select id from public.classroom_members')).toHaveLength(3);
    expect(await asAuthenticated(teacherB, 'select id from public.classroom_members')).toEqual([]);
    const studentAMemberRows = await asAuthenticated<{ invited_email: string }>(
      studentA,
      'select invited_email from public.classroom_members',
    );
    expect(studentAMemberRows.map(r => r.invited_email)).toEqual(['student-a@example.test']);
    expect(await asAuthenticated(studentC, 'select id from public.classroom_members')).toEqual([]);
    expect(await asAuthenticated(admin, 'select id from public.classroom_members')).toHaveLength(3);
    await expect(
      asAuthenticated(
        studentA,
        "insert into public.classroom_members(classroom_id, invited_email, joined_via) values ($1, 'x@example.test', 'code')",
        [classroom.id],
      ),
    ).rejects.toThrow();

    expect((await asAuthenticated<{ id: string }>(teacherA, 'select id from public.quiz_assignments')).map(r => r.id)).toEqual([assignmentId]);
    expect(await asAuthenticated(teacherB, 'select id from public.quiz_assignments')).toEqual([]);
    expect((await asAuthenticated<{ id: string }>(studentA, 'select id from public.quiz_assignments')).map(r => r.id)).toEqual([assignmentId]);
    expect(await asAuthenticated(studentC, 'select id from public.quiz_assignments')).toEqual([]);
    expect((await asAuthenticated<{ id: string }>(admin, 'select id from public.quiz_assignments')).map(r => r.id)).toEqual([assignmentId]);
    await expect(
      asAuthenticated(
        teacherA,
        "insert into public.quiz_assignments(quiz_id, target_type, target_value, classroom_id) values ($1, 'class', '12A1', $2)",
        [classQuizId, classroom.id],
      ),
    ).rejects.toThrow();

    const studentADirectNotifs = await asAuthenticated<{ recipient_uid: string }>(
      studentA,
      'select recipient_uid from public.in_app_notifications',
    );
    expect(studentADirectNotifs.length).toBeGreaterThanOrEqual(1);
    expect(studentADirectNotifs.every(r => r.recipient_uid === 'student-a')).toBe(true);
    expect(await asAuthenticated(studentC, 'select id from public.in_app_notifications')).toEqual([]);
    await expect(
      asAuthenticated(studentA, "update public.in_app_notifications set title = 'Hacked'"),
    ).rejects.toThrow();
    await expect(
      asAuthenticated(
        studentA,
        "insert into public.in_app_notifications(recipient_uid, type, title, body, target_route) values ('student-a', 't', 't', 'b', '/')",
      ),
    ).rejects.toThrow();

    expect((await asAuthenticated<{ id: string }>(studentA, 'select id from public.bug_reports')).map(r => r.id)).toEqual([createdBug.id]);
    expect(await asAuthenticated(studentB, 'select id from public.bug_reports')).toEqual([]);
    expect(await asAuthenticated(teacherA, 'select id from public.bug_reports')).toEqual([]);
    expect((await asAuthenticated<{ id: string }>(admin, 'select id from public.bug_reports')).map(r => r.id)).toEqual([createdBug.id]);
    await expect(
      asAuthenticated(
        studentA,
        "insert into public.bug_reports(reporter_uid, reporter_role, title, description) values ('student-a', 'student', 'Direct', 'Direct insert attempt')",
      ),
    ).rejects.toThrow();

    await db.exec('set role anon');
    await expect(db.query('select public.list_my_classrooms()')).rejects.toThrow();
    await expect(db.query("select public.create_classroom('Anon', '', '', '')")).rejects.toThrow();
    await expect(db.query('select public.join_classroom_by_code($1)', [newCode])).rejects.toThrow();
    await expect(db.query('select public.join_quiz_by_code($1)', [classQuiz.code])).rejects.toThrow();
    await expect(db.query('select public.list_student_assignments(null)')).rejects.toThrow();
    await expect(db.query('select public.list_my_notifications(10, false)')).rejects.toThrow();
    await expect(db.query("select public.create_bug_report('Anon', 'Anon bug description')")).rejects.toThrow();
    await expect(db.query('select public.list_bug_reports(null, null)')).rejects.toThrow();
    await db.exec('reset role');

    // 6. Azota opensAt/closesAt enforcement on join_quiz_by_code + list_quizzes() redaction + allow_late overdue precedence
    const futureOpen = new Date(Date.now() + 3600_000).toISOString();
    const pastOpen = new Date(Date.now() - 7200_000).toISOString();
    const pastWindowClose = new Date(Date.now() - 120_000).toISOString();
    const futureHardClose = new Date(Date.now() + 7200_000).toISOString();

    const windowQuizInput = {
      title: 'Đề có khung giờ mở',
      subject: 'Lý',
      description: '',
      status: 'published',
      settings: {
        durationMinutes: 15,
        shuffleQuestions: false,
        shuffleOptions: false,
        allowReview: true,
        maxAttempts: 1,
        passPercentage: 50,
        publishScope: 'public',
        opensAt: futureOpen,
        closesAt: null,
      },
      questions: [{
        id: 'q-win-1',
        content: 'Câu hỏi bí mật trước giờ mở',
        type: 'single_choice',
        points: 10,
        options: [{ id: 'A', content: 'Đúng' }, { id: 'B', content: 'Sai' }],
        correctAnswers: ['A'],
        explanation: '',
      }],
    };
    const windowQuizId = (await asAuthenticated<{ id: string }>(
      teacherA,
      'select public.save_quiz($1::jsonb, null, null) as id',
      [JSON.stringify(windowQuizInput)],
    ))[0].id;
    const teacherWindowQuiz = json<Array<{ id: string; code: string; questions: unknown[] }>>(
      (await asAuthenticated<{ payload: unknown }>(teacherA, 'select public.list_quizzes() as payload'))[0].payload,
    ).find(item => item.id === windowQuizId)!;
    expect(teacherWindowQuiz.questions).toHaveLength(1);

    await expect(
      asAuthenticated(studentA, 'select public.join_quiz_by_code($1)', [teacherWindowQuiz.code]),
    ).rejects.toThrow(/chưa đến thời gian mở/i);

    const studentPreOpenQuiz = json<Array<{ id: string; title: string; totalQuestions: number; questions: unknown[] }>>(
      (await asAuthenticated<{ payload: unknown }>(studentA, 'select public.list_quizzes() as payload'))[0].payload,
    ).find(item => item.id === windowQuizId)!;
    expect(studentPreOpenQuiz.title).toBe('Đề có khung giờ mở');
    expect(studentPreOpenQuiz.totalQuestions).toBe(1);
    expect(studentPreOpenQuiz.questions).toEqual([]);

    await asAuthenticated(
      teacherA,
      'select public.update_quiz_publish_settings($1, $2::jsonb, null)',
      [windowQuizId, JSON.stringify({ opensAt: pastOpen, closesAt: pastWindowClose })],
    );
    await expect(
      asAuthenticated(studentA, 'select public.join_quiz_by_code($1)', [teacherWindowQuiz.code]),
    ).rejects.toThrow(/hết thời gian mở/i);

    await asAuthenticated(
      teacherA,
      'select public.update_quiz_publish_settings($1, $2::jsonb, null)',
      [windowQuizId, JSON.stringify({ opensAt: null, closesAt: null })],
    );
    await asAuthenticated(
      teacherA,
      'select public.assign_quiz_to_classrooms($1, $2::jsonb)',
      [
        windowQuizId,
        JSON.stringify([{
          classroomId: classroom.id,
          dueAt: pastDue,
          latePolicy: 'allow_late',
          hardCloseAt: futureHardClose,
        }]),
      ],
    );
    const studentAAssignmentsAfterOverdue = json<Array<{ quizId: string; status: string }>>(
      (await asAuthenticated<{ payload: unknown }>(studentA, 'select public.list_student_assignments($1) as payload', [classroom.id]))[0].payload,
    );
    expect(studentAAssignmentsAfterOverdue.find(a => a.quizId === windowQuizId)?.status).toBe('overdue');

    // 7. Classroom re-join after removal & email change with existing pending_invite for new email
    const studentBMemberId = (await asAuthenticated<{ id: string }>(
      teacherA,
      "select id from public.classroom_members where classroom_id = $1 and student_uid = 'student-b'",
      [classroom.id],
    ))[0].id;
    await asAuthenticated(teacherA, 'select public.remove_classroom_member($1, $2)', [classroom.id, studentBMemberId]);
    await asAuthenticated(
      teacherA,
      "select public.add_classroom_members_bulk($1, $2::text[], 'teacher_email')",
      [classroom.id, ['student-b-new@example.test']],
    );
    await db.exec('reset role');
    await db.exec("update public.profiles set email = 'student-b-new@example.test' where firebase_uid = 'student-b'");
    const rejoinedClass = json<{ id: string }>(
      (await asAuthenticated<{ payload: unknown }>(studentB, "select public.join_classroom_by_code($1, 'code') as payload", [newCode]))[0].payload,
    );
    expect(rejoinedClass.id).toBe(classroom.id);

    await db.close();
  }, 30_000);

  it('enforces M1 Iteration 2 hardening: direct table lockdown, practice gating, removed-member isolation, hard_close_at cutoffs, and save_quiz Azota validation', async () => {
    const db = new PGlite();
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create schema storage;
      create table storage.buckets (
        id text primary key,
        name text not null,
        public boolean not null default false,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table storage.objects (bucket_id text not null, name text not null);
      alter table storage.objects enable row level security;
      grant select on storage.objects to anon, authenticated;
      grant insert on storage.objects to authenticated;
      create function auth.jwt() returns jsonb language sql stable as
        $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant usage on schema storage to anon, authenticated;
      grant execute on function auth.jwt() to anon, authenticated, service_role;
    `);
    const migrationsDirectory = fileURLToPath(new URL('../../../../../supabase/migrations/', import.meta.url));
    for (const migration of readdirSync(migrationsDirectory).filter(name => name.endsWith('.sql')).sort()) {
      await db.exec(readFileSync(`${migrationsDirectory}/${migration}`, 'utf8'));
    }
    const seedPath = fileURLToPath(new URL('../../../../../supabase/seed.sql', import.meta.url));
    await db.exec(readFileSync(seedPath, 'utf8'));
    await db.exec(`
      insert into public.profiles(firebase_uid,email,full_name,role) values
        ('teacher-a','teacher-a@example.test','Teacher A','teacher'),
        ('student-a','student-a@example.test','Student A','student'),
        ('student-b','student-b@example.test','Student B','student'),
        ('admin-a','admin-a@example.test','Admin A','admin');
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
    const studentA: Claims = { sub: 'student-a', role: 'authenticated', app_role: 'student' };
    const studentB: Claims = { sub: 'student-b', role: 'authenticated', app_role: 'student' };
    const admin: Claims = { sub: 'admin-a', role: 'authenticated', app_role: 'admin' };

    const futureOpen = new Date(Date.now() + 3600_000).toISOString();
    const pastOpen = new Date(Date.now() - 7200_000).toISOString();
    const futureClose = new Date(Date.now() + 3600_000).toISOString();
    const pastClose = new Date(Date.now() - 120_000).toISOString();
    const withinGraceClose = new Date(Date.now() - 10_000).toISOString();

    const makeQuestions = (label: string) => ([{
      id: `q-${label}`,
      content: `Nội dung ${label}`,
      type: 'single_choice',
      points: 10,
      options: [
        { id: 'A', content: '1' },
        { id: 'B', content: '2' },
        { id: 'C', content: '3' },
        { id: 'D', content: '4' },
        { id: 'E', content: '5' },
      ],
      correctAnswers: ['E'],
      explanation: 'Giải thích',
    }]);

    // 1. Direct table lockdown & question_answer_keys [] parity
    const futureQuizId = (await asAuthenticated<{ id: string }>(
      teacherA,
      'select public.save_quiz($1::jsonb, null, null) as id',
      [JSON.stringify({
        title: 'Pre-open lockdown',
        subject: 'Toán',
        status: 'published',
        settings: {
          durationMinutes: 15, shuffleQuestions: false, shuffleOptions: false,
          allowReview: true, maxAttempts: 1, passPercentage: 50,
          opensAt: futureOpen, assignedEmails: ['vip-secret@example.test'],
        },
        questions: makeQuestions('lock'),
      })],
    ))[0].id;

    await expect(asAuthenticated(studentA, 'select * from public.questions where quiz_id = $1', [futureQuizId]))
      .rejects.toThrow(/permission denied/i);
    await expect(asAuthenticated(studentA, 'select settings from public.quizzes where id = $1', [futureQuizId]))
      .rejects.toThrow(/permission denied/i);
    expect(await asAuthenticated(studentA, 'select * from public.question_answer_keys')).toEqual([]);

    // 2. Practice gating (opensAt, available_from, answerVisibility='never'|'after_close', legacy allowReview=false, mid-session invalidation, 5-option E)
    await expect(asAuthenticated(studentA, 'select public.start_practice($1, null, true)', [futureQuizId]))
      .rejects.toThrow(/chưa đến thời gian mở/i);

    const neverAnsQuizId = (await asAuthenticated<{ id: string }>(
      teacherA,
      'select public.save_quiz($1::jsonb, null, null) as id',
      [JSON.stringify({
        title: 'Never answers', subject: 'Toán', status: 'published',
        settings: { durationMinutes: 15, maxAttempts: 1, passPercentage: 50, answerVisibility: 'never' },
        questions: makeQuestions('never'),
      })],
    ))[0].id;
    await expect(asAuthenticated(studentA, 'select public.start_practice($1, null, true)', [neverAnsQuizId]))
      .rejects.toThrow(/hiển thị đáp án/i);

    const legacyNoReviewQuizId = (await asAuthenticated<{ id: string }>(
      teacherA,
      'select public.save_quiz($1::jsonb, null, null) as id',
      [JSON.stringify({
        title: 'Legacy no review', subject: 'Toán', status: 'published',
        settings: { durationMinutes: 15, allowReview: false, maxAttempts: 1, passPercentage: 50 },
        questions: makeQuestions('legacy-nr'),
      })],
    ))[0].id;
    await expect(asAuthenticated(studentA, 'select public.start_practice($1, null, true)', [legacyNoReviewQuizId]))
      .rejects.toThrow(/hiển thị đáp án/i);

    const afterClosePracticeQuizId = (await asAuthenticated<{ id: string }>(
      teacherA,
      'select public.save_quiz($1::jsonb, null, null) as id',
      [JSON.stringify({
        title: 'After close practice', subject: 'Toán', status: 'published',
        settings: {
          durationMinutes: 15, maxAttempts: 1, passPercentage: 50,
          answerVisibility: 'after_close', closesAt: null,
        },
        questions: makeQuestions('after-close'),
      })],
    ))[0].id;
    await expect(asAuthenticated(studentA, 'select public.start_practice($1, null, true)', [afterClosePracticeQuizId]))
      .rejects.toThrow(/sau khi đóng đề/i);

    await asAuthenticated(
      teacherA,
      'select public.update_quiz_publish_settings($1, $2::jsonb, null)',
      [afterClosePracticeQuizId, JSON.stringify({ closesAt: futureClose })],
    );
    await expect(asAuthenticated(studentA, 'select public.start_practice($1, null, true)', [afterClosePracticeQuizId]))
      .rejects.toThrow(/sau khi đóng đề/i);

    await asAuthenticated(
      teacherA,
      'select public.update_quiz_publish_settings($1, $2::jsonb, null)',
      [afterClosePracticeQuizId, JSON.stringify({ opensAt: pastOpen, closesAt: pastClose })],
    );
    const practiceStart = json<{ id: string; questionOrder: string[] }>(
      (await asAuthenticated<{ payload: unknown }>(studentA, 'select public.start_practice($1, null, true) as payload', [afterClosePracticeQuizId]))[0].payload,
    );
    const checkedE = json<{ isCorrect: boolean; correctAnswers: string[] }>(
      (await asAuthenticated<{ payload: unknown }>(
        studentA,
        'select public.check_practice_answer($1, $2, $3::jsonb) as payload',
        [practiceStart.id, practiceStart.questionOrder[0], '["E"]'],
      ))[0].payload,
    );
    expect(checkedE.isCorrect).toBe(true);
    expect(checkedE.correctAnswers).toEqual(['E']);
    const finishedPractice = json<{ details: Array<{ images: unknown[] }> }>(
      (await asAuthenticated<{ payload: unknown }>(studentA, 'select public.finish_practice($1) as payload', [practiceStart.id]))[0].payload,
    );
    expect(finishedPractice.details[0].images).toEqual([]);

    // Mid-session invalidation when teacher disables answerVisibility
    const midSessionPractice = json<{ id: string }>(
      (await asAuthenticated<{ payload: unknown }>(studentA, 'select public.start_practice($1, null, true) as payload', [afterClosePracticeQuizId]))[0].payload,
    );
    await asAuthenticated(
      teacherA,
      'select public.update_quiz_publish_settings($1, $2::jsonb, null)',
      [afterClosePracticeQuizId, JSON.stringify({ answerVisibility: 'never' })],
    );
    const invalidatedSession = json<{ status: string }>(
      (await asAuthenticated<{ payload: unknown }>(studentA, 'select public.get_practice_session($1) as payload', [midSessionPractice.id]))[0].payload,
    );
    expect(invalidatedSession.status).toBe('invalidated');

    // 3. Classroom available_from in join_quiz_by_code & list_quizzes + removed-member isolation
    const cls = json<{ id: string; inviteCode: string }>(
      (await asAuthenticated<{ payload: unknown }>(teacherA, "select public.create_classroom('Lớp 12B', 'Lý', '12', '') as payload"))[0].payload,
    );
    await asAuthenticated(studentA, "select public.join_classroom_by_code($1, 'code')", [cls.inviteCode]);
    await asAuthenticated(studentB, "select public.join_classroom_by_code($1, 'code')", [cls.inviteCode]);

    const classOnlyId = (await asAuthenticated<{ id: string }>(
      teacherA,
      'select public.save_quiz($1::jsonb, null, null) as id',
      [JSON.stringify({
        title: 'Class only window', subject: 'Lý', status: 'published',
        settings: { durationMinutes: 15, maxAttempts: 2, passPercentage: 50, publishScope: 'class_only' },
        questions: makeQuestions('cls-only'),
      })],
    ))[0].id;
    const classOnlyCode = json<Array<{ id: string; code: string }>>(
      (await asAuthenticated<{ payload: unknown }>(teacherA, 'select public.list_quizzes() as payload'))[0].payload,
    ).find(q => q.id === classOnlyId)!.code;

    // Inverted availableFrom > hardCloseAt when dueAt is null is rejected
    await expect(
      asAuthenticated(
        teacherA,
        'select public.assign_quiz_to_classrooms($1, $2::jsonb)',
        [classOnlyId, JSON.stringify([{ classroomId: cls.id, availableFrom: futureOpen, dueAt: null, hardCloseAt: pastOpen }])],
      ),
    ).rejects.toThrow(/sau hoặc bằng thời gian mở bài/i);

    // Future availableFrom blocks join_quiz_by_code, start_practice, and redacts list_quizzes() questions
    await asAuthenticated(
      teacherA,
      'select public.assign_quiz_to_classrooms($1, $2::jsonb)',
      [classOnlyId, JSON.stringify([{ classroomId: cls.id, availableFrom: futureOpen, dueAt: null, hardCloseAt: null }])],
    );
    await expect(asAuthenticated(studentA, 'select public.join_quiz_by_code($1)', [classOnlyCode]))
      .rejects.toThrow(/chưa đến thời gian mở/i);
    await expect(asAuthenticated(studentA, 'select public.start_practice($1, null, true)', [classOnlyId]))
      .rejects.toThrow(/chưa đến thời gian mở/i);
    const redactedPreAvail = json<Array<{ id: string; questions: unknown[] }>>(
      (await asAuthenticated<{ payload: unknown }>(studentA, 'select public.list_quizzes() as payload'))[0].payload,
    ).find(q => q.id === classOnlyId)!;
    expect(redactedPreAvail.questions).toEqual([]);

    // Open assignment, complete attempt 1 for studentA, then remove studentA -> studentA keeps list_results() but cannot re-join/re-attempt/practice
    const assignOpenRows = await asAuthenticated<{ payload: unknown }>(
      teacherA,
      'select public.assign_quiz_to_classrooms($1, $2::jsonb) as payload',
      [classOnlyId, JSON.stringify([{ classroomId: cls.id, availableFrom: pastOpen, dueAt: null, hardCloseAt: null }])],
    );
    const openAssignmentId = json<Array<{ id: string }>>(assignOpenRows[0].payload)[0].id;
    const att1 = json<{ id: string }>(
      (await asAuthenticated<{ payload: unknown }>(studentA, 'select public.start_attempt($1, null, $2) as payload', [classOnlyId, openAssignmentId]))[0].payload,
    );
    await asAuthenticated(studentA, 'select public.submit_attempt($1)', [att1.id]);

    const studentAMemId = (await asAuthenticated<{ id: string }>(
      teacherA,
      "select id from public.classroom_members where classroom_id = $1 and student_uid = 'student-a'",
      [cls.id],
    ))[0].id;
    await asAuthenticated(teacherA, 'select public.remove_classroom_member($1, $2)', [cls.id, studentAMemId]);

    expect(json<Array<{ quizId: string }>>(
      (await asAuthenticated<{ payload: unknown }>(studentA, 'select public.list_results() as payload'))[0].payload,
    )).toHaveLength(1);
    await expect(asAuthenticated(studentA, 'select public.join_quiz_by_code($1)', [classOnlyCode]))
      .rejects.toThrow(/lớp học/i);
    await expect(asAuthenticated(studentA, 'select public.start_attempt($1, null, null)', [classOnlyId]))
      .rejects.toThrow(/lớp học/i);
    await expect(asAuthenticated(studentA, 'select public.start_practice($1, null, true)', [classOnlyId]))
      .rejects.toThrow(/quyền/i);
    const removedListed = json<Array<{ id: string; questions: unknown[] }>>(
      (await asAuthenticated<{ payload: unknown }>(studentA, 'select public.list_quizzes() as payload'))[0].payload,
    ).find(q => q.id === classOnlyId)!;
    expect(removedListed.questions).toEqual([]);

    // 4. allow_late hard_close_at + 60s grace & public closesAt + finalize_expired safety
    await asAuthenticated(
      teacherA,
      'select public.assign_quiz_to_classrooms($1, $2::jsonb)',
      [classOnlyId, JSON.stringify([{ classroomId: cls.id, availableFrom: pastOpen, dueAt: pastClose, latePolicy: 'allow_late', hardCloseAt: futureClose }])],
    );
    const studentBAtt = json<{ id: string }>(
      (await asAuthenticated<{ payload: unknown }>(studentB, 'select public.start_attempt($1, null, $2) as payload', [classOnlyId, openAssignmentId]))[0].payload,
    );
    // Simulate hard_close_at within 60s grace -> submit_attempt succeeds
    await db.exec('reset role');
    await db.query('update public.quiz_assignments set hard_close_at = $1 where id = $2', [withinGraceClose, openAssignmentId]);
    const graceSubmit = json<{ isLate: boolean }>(
      (await asAuthenticated<{ payload: unknown }>(studentB, 'select public.submit_attempt($1) as payload', [studentBAtt.id]))[0].payload,
    );
    expect(graceSubmit.isLate).toBe(true);

    // Start a 2nd attempt for studentB, then move hard_close_at to 120s in the past -> submit, finalize_exam_attempt reject, finalize_expired skips
    await db.exec('reset role');
    await db.query('update public.quiz_assignments set hard_close_at = $1 where id = $2', [futureClose, openAssignmentId]);
    const studentBAtt2 = json<{ id: string }>(
      (await asAuthenticated<{ payload: unknown }>(studentB, 'select public.start_attempt($1, null, $2) as payload', [classOnlyId, openAssignmentId]))[0].payload,
    );
    await db.exec('reset role');
    await db.query('update public.quiz_assignments set hard_close_at = $1 where id = $2', [pastClose, openAssignmentId]);
    await db.query("update public.exam_attempts set ends_at = now() - interval '120 seconds' where id = $1", [studentBAtt2.id]);
    await expect(asAuthenticated(studentB, 'select public.submit_attempt($1)', [studentBAtt2.id]))
      .rejects.toThrow(/hết thời gian mở/i);
    await expect(asAuthenticated(studentB, "select public.finalize_exam_attempt($1, 'idem-late-1')", [studentBAtt2.id]))
      .rejects.toThrow(/hết thời gian mở/i);
    await asAuthenticated(studentB, 'select public.finalize_expired()');
    const stillUnsubmitted = (await db.query<{ submitted_at: string | null }>('select submitted_at from public.exam_attempts where id = $1', [studentBAtt2.id])).rows[0];
    expect(stillUnsubmitted.submitted_at).toBeNull();

    // Public quiz with closesAt > 60s in past rejects submit_attempt / finalize_exam_attempt; within-window expired attempt auto-finalizes via finalize_expired
    const pubQuizId = (await asAuthenticated<{ id: string }>(
      teacherA,
      'select public.save_quiz($1::jsonb, null, null) as id',
      [JSON.stringify({
        title: 'Public close cutoff', subject: 'Toán', status: 'published',
        settings: { durationMinutes: 15, maxAttempts: 2, passPercentage: 50, publishScope: 'public', closesAt: futureClose },
        questions: makeQuestions('pub-close'),
      })],
    ))[0].id;
    const pubAtt = json<{ id: string }>(
      (await asAuthenticated<{ payload: unknown }>(studentA, 'select public.start_attempt($1, null, null) as payload', [pubQuizId]))[0].payload,
    );
    await db.exec('reset role');
    await db.query("update public.exam_attempts set ends_at = now() - interval '5 seconds' where id = $1", [pubAtt.id]);
    await expect(asAuthenticated(studentA, 'select public.save_attempt($1, 0, $2::jsonb, $3::jsonb, 0)', [pubAtt.id, '{}', '[]']))
      .rejects.toThrow(/hết giờ/i);
    await asAuthenticated(studentA, 'select public.finalize_expired()');
    const autoFinalized = (await db.query<{ submitted_at: string | null }>('select submitted_at from public.exam_attempts where id = $1', [pubAtt.id])).rows[0];
    expect(autoFinalized.submitted_at).not.toBeNull();

    const pubAtt2 = json<{ id: string }>(
      (await asAuthenticated<{ payload: unknown }>(studentA, 'select public.start_attempt($1, null, null) as payload', [pubQuizId]))[0].payload,
    );
    await asAuthenticated(
      teacherA,
      'select public.update_quiz_publish_settings($1, $2::jsonb, null)',
      [pubQuizId, JSON.stringify({ closesAt: pastClose })],
    );
    await expect(asAuthenticated(studentA, 'select public.submit_attempt($1)', [pubAtt2.id]))
      .rejects.toThrow(/hết thời gian mở/i);
    await expect(asAuthenticated(studentA, "select public.finalize_exam_attempt($1, 'idem-pub-2')", [pubAtt2.id]))
      .rejects.toThrow(/hết thời gian mở/i);

    // 5. save_quiz Azota validation & admin bypass sanity
    await expect(
      asAuthenticated(teacherA, 'select public.save_quiz($1::jsonb, null, null)', [JSON.stringify({
        title: 'Bad date', subject: 'Toán', status: 'published',
        settings: { durationMinutes: 15, maxAttempts: 1, passPercentage: 50, opensAt: 'not-a-date' },
        questions: makeQuestions('bad-date'),
      })]),
    ).rejects.toThrow(/không hợp lệ/i);
    await expect(
      asAuthenticated(teacherA, 'select public.save_quiz($1::jsonb, null, null)', [JSON.stringify({
        title: 'Inverted date', subject: 'Toán', status: 'published',
        settings: { durationMinutes: 15, maxAttempts: 1, passPercentage: 50, opensAt: futureClose, closesAt: pastOpen },
        questions: makeQuestions('inv-date'),
      })]),
    ).rejects.toThrow(/sau thời gian mở đề/i);
    await expect(
      asAuthenticated(teacherA, 'select public.save_quiz($1::jsonb, null, null)', [JSON.stringify({
        title: 'Bad scope', subject: 'Toán', status: 'published',
        settings: { durationMinutes: 15, maxAttempts: 1, passPercentage: 50, publishScope: 'everyone' },
        questions: makeQuestions('bad-scope'),
      })]),
    ).rejects.toThrow(/không hợp lệ/i);
    expect(admin.app_role).toBe('admin');

    // 6. M2 hardening: status='closed' unlocks 'after_close', list_student_assignments closed/closesAt/overdue & multi-class attempt alignment
    const cls2 = json<{ id: string; inviteCode: string }>(
      (await asAuthenticated<{ payload: unknown }>(teacherA, "select public.create_classroom('Lớp 12C', 'Toán', '12', '') as payload"))[0].payload,
    );
    await asAuthenticated(studentA, "select public.join_classroom_by_code($1, 'code')", [cls2.inviteCode]);
    await asAuthenticated(studentB, "select public.join_classroom_by_code($1, 'code')", [cls2.inviteCode]);

    const m2QuizId = (await asAuthenticated<{ id: string }>(
      teacherA,
      'select public.save_quiz($1::jsonb, null, null) as id',
      [JSON.stringify({
        title: 'M2 Closed & After Close',
        subject: 'Toán',
        status: 'published',
        settings: {
          durationMinutes: 15,
          maxAttempts: 2,
          passPercentage: 50,
          publishScope: 'class_only',
          scoreVisibility: 'after_close',
          answerVisibility: 'after_close',
          closesAt: null,
        },
        questions: makeQuestions('m2-closed'),
      })],
    ))[0].id;

    const draftQuizId = (await asAuthenticated<{ id: string }>(
      teacherA,
      'select public.save_quiz($1::jsonb, null, null) as id',
      [JSON.stringify({
        title: 'M2 Draft Excluded',
        subject: 'Toán',
        status: 'draft',
        settings: { durationMinutes: 15, maxAttempts: 1, passPercentage: 50, publishScope: 'class_only' },
        questions: makeQuestions('m2-draft'),
      })],
    ))[0].id;

    const m2Assign1Rows = await asAuthenticated<{ payload: unknown }>(
      teacherA,
      'select public.assign_quiz_to_classrooms($1, $2::jsonb) as payload',
      [m2QuizId, JSON.stringify([{ classroomId: cls.id, dueAt: null, latePolicy: 'allow_late', hardCloseAt: null }])],
    );
    const m2Assign1Id = json<Array<{ id: string }>>(m2Assign1Rows[0].payload)[0].id;
    await asAuthenticated(
      teacherA,
      'select public.assign_quiz_to_classrooms($1, $2::jsonb)',
      [m2QuizId, JSON.stringify([{ classroomId: cls2.id, dueAt: null, latePolicy: 'allow_late', hardCloseAt: null }])],
    );
    await asAuthenticated(
      teacherA,
      'select public.assign_quiz_to_classrooms($1, $2::jsonb)',
      [draftQuizId, JSON.stringify([{ classroomId: cls2.id, dueAt: null, latePolicy: 'allow_late', hardCloseAt: null }])],
    );

    // Student B starts & submits attempt via cls (m2Assign1Id)
    const m2AttB = json<{ id: string; revision: number; questionOrder: string[] }>(
      (await asAuthenticated<{ payload: unknown }>(studentB, 'select public.start_attempt($1, null, $2) as payload', [m2QuizId, m2Assign1Id]))[0].payload,
    );
    await asAuthenticated(studentB, 'select public.save_attempt($1,$2,$3::jsonb,$4::jsonb,$5)', [
      m2AttB.id, m2AttB.revision, JSON.stringify({ [m2AttB.questionOrder[0]]: ['E'] }), '[]', 0,
    ]);
    await asAuthenticated(studentB, 'select public.submit_attempt($1)', [m2AttB.id]);

    // Before closing: studentB's score & answers are hidden in both list_results and list_student_assignments (including cls2!)
    const preCloseResults = json<Array<{ quizId: string; score: number | null; scoreHidden: boolean; answersHidden: boolean; details: unknown[] }>>(
      (await asAuthenticated<{ payload: unknown }>(studentB, 'select public.list_results() as payload'))[0].payload,
    ).filter(r => r.quizId === m2QuizId);
    expect(preCloseResults[0].score).toBeNull();
    expect(preCloseResults[0].scoreHidden).toBe(true);
    expect(preCloseResults[0].answersHidden).toBe(true);
    expect(preCloseResults[0].details).toEqual([]);

    const preCloseCls2Assignments = json<Array<{ quizId: string; status: string; attemptCount: number; scoreHidden: boolean; bestScore: number | null }>>(
      (await asAuthenticated<{ payload: unknown }>(studentB, 'select public.list_student_assignments($1) as payload', [cls2.id]))[0].payload,
    );
    expect(preCloseCls2Assignments.some(a => a.quizId === draftQuizId)).toBe(false);
    const preCloseCls2M2 = preCloseCls2Assignments.find(a => a.quizId === m2QuizId)!;
    expect(preCloseCls2M2.status).toBe('completed');
    expect(preCloseCls2M2.attemptCount).toBe(1);
    expect(preCloseCls2M2.scoreHidden).toBe(true);
    expect(preCloseCls2M2.bestScore).toBeNull();

    // Teacher sets quiz status='closed' without closesAt/hard_close_at -> unlocks after_close, keeps quiz in list_student_assignments, and marks unsubmitted studentA as 'overdue'
    await asAuthenticated(teacherA, 'select public.set_quiz_status($1, $2)', [m2QuizId, 'closed']);

    const postCloseResults = json<Array<{ quizId: string; score: number | null; scoreHidden: boolean; answersHidden: boolean; details: unknown[] }>>(
      (await asAuthenticated<{ payload: unknown }>(studentB, 'select public.list_results() as payload'))[0].payload,
    ).filter(r => r.quizId === m2QuizId);
    expect(postCloseResults[0].score).toBe(10);
    expect(postCloseResults[0].scoreHidden).toBe(false);
    expect(postCloseResults[0].answersHidden).toBe(false);
    expect(postCloseResults[0].details).toHaveLength(1);

    const postCloseCls2AssignmentsB = json<Array<{ quizId: string; status: string; scoreHidden: boolean; bestScore: number | null }>>(
      (await asAuthenticated<{ payload: unknown }>(studentB, 'select public.list_student_assignments($1) as payload', [cls2.id]))[0].payload,
    );
    const postCloseCls2M2B = postCloseCls2AssignmentsB.find(a => a.quizId === m2QuizId)!;
    expect(postCloseCls2M2B.status).toBe('completed');
    expect(postCloseCls2M2B.scoreHidden).toBe(false);
    expect(postCloseCls2M2B.bestScore).toBe(10);

    const postCloseCls2AssignmentsA = json<Array<{ quizId: string; status: string }>>(
      (await asAuthenticated<{ payload: unknown }>(studentA, 'select public.list_student_assignments($1) as payload', [cls2.id]))[0].payload,
    );
    expect(postCloseCls2AssignmentsA.find(a => a.quizId === m2QuizId)?.status).toBe('overdue');

    // Re-publish quiz with past closesAt -> hardCloseAt coalesces closesAt and unsubmitted assignment is 'overdue'
    await asAuthenticated(
      teacherA,
      'select public.update_quiz_publish_settings($1, $2::jsonb, $3)',
      [m2QuizId, JSON.stringify({ closesAt: pastClose }), 'published'],
    );
    const coalescedAssignmentsA = json<Array<{ quizId: string; status: string; hardCloseAt: string | null }>>(
      (await asAuthenticated<{ payload: unknown }>(studentA, 'select public.list_student_assignments($1) as payload', [cls2.id]))[0].payload,
    );
    const coalescedM2A = coalescedAssignmentsA.find(a => a.quizId === m2QuizId)!;
    expect(coalescedM2A.hardCloseAt).not.toBeNull();
    expect(coalescedM2A.status).toBe('overdue');

    await db.close();
  }, 30_000);
});
