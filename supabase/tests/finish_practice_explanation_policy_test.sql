BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;
SELECT plan(5);

INSERT INTO public.profiles (firebase_uid, email, full_name, role, approval_status)
VALUES
  ('pgtap-practice-explanation-teacher', 'pgtap-practice-teacher@example.test', 'Migration Test Teacher', 'teacher', 'approved'),
  ('pgtap-practice-explanation-student', 'pgtap-practice-student@example.test', 'Migration Test Student', 'student', 'approved'),
  ('pgtap-practice-explanation-other', 'pgtap-practice-other@example.test', 'Other Test Student', 'student', 'approved');

INSERT INTO public.quizzes (id, teacher_uid, title, subject, code, status, settings, updated_at)
VALUES (
  '71000000-0000-4000-8000-000000000001',
  'pgtap-practice-explanation-teacher',
  'Practice explanation policy fixture',
  'Test',
  'PGTAP1',
  'published',
  '{"practiceEnabled":true}'::jsonb,
  '2026-11-18 04:00:00+00'::timestamptz
);

INSERT INTO public.questions (id, quiz_id, ordinal, content, type, options, images, points)
VALUES (
  '81000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  1,
  'Practice explanation test question',
  'single_choice',
  '[{"id":"A","content":"Correct"},{"id":"B","content":"Incorrect"}]'::jsonb,
  '[]'::jsonb,
  1
);

INSERT INTO public.question_answer_keys (question_id, correct_answers, explanation)
VALUES (
  '81000000-0000-4000-8000-000000000001',
  '["A"]'::jsonb,
  'source-explanation'
);

-- This completed row represents a result stored before the policy fix.
INSERT INTO public.practice_sessions (
  id, quiz_id, quiz_title, subject, student_uid, started_at, finished_at, status,
  quiz_updated_at, question_order, show_explanation, answer_count, result
)
VALUES (
  '91000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'Practice explanation policy fixture',
  'Test',
  'pgtap-practice-explanation-student',
  '2026-11-18 04:01:00+00'::timestamptz,
  '2026-11-18 04:02:00+00'::timestamptz,
  'completed',
  '2026-11-18 04:00:00+00'::timestamptz,
  ARRAY['81000000-0000-4000-8000-000000000001'::uuid],
  false,
  1,
  '{"details":[{"explanation":"legacy-secret"}]}'::jsonb
);

INSERT INTO public.practice_sessions (
  id, quiz_id, quiz_title, subject, student_uid, started_at, status, quiz_updated_at,
  question_order, option_order, show_explanation, answer_count
)
VALUES
  (
    '91000000-0000-4000-8000-000000000002',
    '71000000-0000-4000-8000-000000000001',
    'Practice explanation policy fixture', 'Test', 'pgtap-practice-explanation-student',
    '2026-11-18 04:01:00+00'::timestamptz, 'in_progress', '2026-11-18 04:00:00+00'::timestamptz,
    ARRAY['81000000-0000-4000-8000-000000000001'::uuid],
    '{"81000000-0000-4000-8000-000000000001":["A"]}'::jsonb, false, 1
  ),
  (
    '91000000-0000-4000-8000-000000000003',
    '71000000-0000-4000-8000-000000000001',
    'Practice explanation policy fixture', 'Test', 'pgtap-practice-explanation-student',
    '2026-11-18 04:01:00+00'::timestamptz, 'in_progress', '2026-11-18 04:00:00+00'::timestamptz,
    ARRAY['81000000-0000-4000-8000-000000000001'::uuid],
    '{"81000000-0000-4000-8000-000000000001":["A"]}'::jsonb, true, 1
  );

INSERT INTO public.practice_answers (session_id, question_id, selected_answers, is_correct, correct_answers, explanation)
VALUES
  ('91000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', '["A"]'::jsonb, true, '["A"]'::jsonb, 'hidden-secret'),
  ('91000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000001', '["A"]'::jsonb, true, '["A"]'::jsonb, 'visible-explanation');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"pgtap-practice-explanation-student","role":"authenticated","app_role":"student"}', true);

SELECT is(
  public.finish_practice('91000000-0000-4000-8000-000000000001'::uuid)->'details'->0->'explanation',
  'null'::jsonb,
  'a legacy completed result hides its stored explanation when disabled'
);
SELECT is(
  public.finish_practice('91000000-0000-4000-8000-000000000002'::uuid)->'details'->0->'explanation',
  'null'::jsonb,
  'a newly completed result hides its stored explanation when disabled'
);
SELECT is(
  public.finish_practice('91000000-0000-4000-8000-000000000002'::uuid)->'details'->0->'explanation',
  'null'::jsonb,
  'replaying the newly completed hidden result stays redacted'
);
SELECT is(
  public.finish_practice('91000000-0000-4000-8000-000000000003'::uuid)->'details'->0->'explanation',
  '"visible-explanation"'::jsonb,
  'an enabled explanation remains visible'
);
SELECT set_config('request.jwt.claims', '{"sub":"pgtap-practice-explanation-other","role":"authenticated","app_role":"student"}', true);
SELECT throws_ok(
  $$SELECT public.finish_practice('91000000-0000-4000-8000-000000000003'::uuid)$$,
  'P0001',
  'Không tìm thấy lượt luyện tập hoặc bạn không có quyền truy cập',
  'another student cannot finish or read this practice result'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
