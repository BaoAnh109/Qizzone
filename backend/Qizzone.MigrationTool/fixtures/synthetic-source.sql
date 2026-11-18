CREATE SCHEMA private;
CREATE TABLE private.ai_limits (
    uid text PRIMARY KEY,
    bucket timestamptz NOT NULL,
    requests integer NOT NULL
);

INSERT INTO public.profiles (
    firebase_uid, email, full_name, role, active_role, approval_status,
    teacher_request_status, teacher_request_blocked, created_at, updated_at
)
VALUES
    ('teacher-fixture', 'teacher-fixture@example.test', 'Fixture Teacher', 'teacher', 'teacher', 'approved', 'approved', false, now(), now()),
    ('student-fixture', 'student-fixture@example.test', 'Fixture Student', 'student', 'student', 'approved', 'none', false, now(), now());

INSERT INTO public.quizzes (id, teacher_uid, title, subject, description, code, status, settings, created_at, updated_at)
VALUES (
    '11111111-1111-4111-8111-111111111111', 'teacher-fixture', 'Migration fixture', 'Test', '', 'FIX001', 'published',
    '{"durationMinutes":30,"maxAttempts":1,"passPercentage":50,"allowReview":true,"shuffleQuestions":false,"shuffleOptions":false}'::jsonb,
    now(), now()
);

INSERT INTO public.questions (id, quiz_id, ordinal, content, images, type, options, points, created_at, updated_at)
VALUES (
    '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 1, 'Fixture question', '[]'::jsonb,
    'single_choice', '[{"id":"A","content":"Yes","images":[]},{"id":"B","content":"No","images":[]}]'::jsonb, 1, now(), now()
);

INSERT INTO public.question_answer_keys (question_id, correct_answers, explanation, created_at, updated_at)
VALUES ('22222222-2222-4222-8222-222222222222', '["A"]'::jsonb, 'Fixture explanation', now(), now());

INSERT INTO public.exam_attempts (
    id, quiz_id, student_uid, student_name, started_at, ends_at, submitted_at,
    duration_minutes, pass_percentage, allow_review, question_order, snapshot,
    option_order, flagged_ids, current_index, revision, updated_at
)
VALUES (
    '33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'student-fixture', 'Fixture Student',
    now() - interval '5 minutes', now() - interval '1 minute', now() - interval '1 minute', 30, 50, true,
    ARRAY['22222222-2222-4222-8222-222222222222'::uuid], '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 1, now()
), (
    '33333333-3333-4333-8333-333333333334', '11111111-1111-4111-8111-111111111111', 'student-fixture', 'Fixture Student',
    now() - interval '5 minutes', NULL, NULL, 0, 50, true,
    ARRAY['22222222-2222-4222-8222-222222222222'::uuid], '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 7, now()
);

INSERT INTO public.exam_answers (attempt_id, question_id, selected_answers, updated_at)
VALUES
    ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', '["A"]'::jsonb, now()),
    ('33333333-3333-4333-8333-333333333334', '22222222-2222-4222-8222-222222222222', '["B"]'::jsonb, now());

INSERT INTO public.exam_results (id, attempt_id, payload, created_at)
VALUES ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', '{"score":10,"percentage":100,"isPassed":true}'::jsonb, now());

INSERT INTO public.practice_sessions (
    id, quiz_id, quiz_title, subject, student_uid, started_at, finished_at, status,
    quiz_updated_at, question_order, option_order, show_explanation, answer_count, result
)
VALUES (
    '55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 'Migration fixture', 'Test', 'student-fixture',
    now() - interval '5 minutes', now(), 'completed', now(), ARRAY['22222222-2222-4222-8222-222222222222'::uuid], '{}'::jsonb, true, 1,
    '{"completed":true}'::jsonb
);

INSERT INTO public.practice_answers (session_id, question_id, selected_answers, is_correct, correct_answers, explanation, checked_at)
VALUES (
    '55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', '["A"]'::jsonb, true,
    '["A"]'::jsonb, 'Fixture explanation', now()
);
