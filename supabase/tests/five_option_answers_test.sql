BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;
SELECT plan(10);

INSERT INTO public.profiles (firebase_uid, email, full_name, role, approval_status)
VALUES
  ('pgtap-five-option-teacher', 'pgtap-five-option-teacher@example.test', 'Five Option Teacher', 'teacher', 'approved'),
  ('pgtap-five-option-student', 'pgtap-five-option-student@example.test', 'Five Option Student', 'student', 'approved'),
  ('pgtap-five-option-import-student', 'pgtap-five-option-import@example.test', 'Five Option Import Student', 'student', 'approved');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"pgtap-five-option-teacher","role":"authenticated","app_role":"teacher"}', true);

SELECT lives_ok(
  $$
    SELECT public.save_quiz(
      '{
        "title":"Five option fixture",
        "subject":"Test",
        "status":"published",
        "settings":{
          "durationMinutes":0,
          "maxAttempts":0,
          "passPercentage":70,
          "shuffleQuestions":false,
          "shuffleOptions":false,
          "allowReview":true,
          "practiceEnabled":true
        },
        "questions":[
          {
            "id":"pgtap-five-option-question-all",
            "content":"All five answers are correct",
            "type":"multiple_choice",
            "options":[
              {"id":"A","content":"Option A"},
              {"id":"B","content":"Option B"},
              {"id":"C","content":"Option C"},
              {"id":"D","content":"Option D"},
              {"id":"E","content":"Option E"}
            ],
            "correctAnswers":["A","B","C","D","E"],
            "points":1
          },
          {
            "id":"pgtap-five-option-question-e",
            "content":"Option E is correct",
            "type":"multiple_choice",
            "options":[
              {"id":"A","content":"Option A"},
              {"id":"B","content":"Option B"},
              {"id":"C","content":"Option C"},
              {"id":"D","content":"Option D"},
              {"id":"E","content":"Option E"}
            ],
            "correctAnswers":["E"],
            "points":1
          }
        ]
      }'::jsonb,
      null,
      'pgtap-five-option-quiz'
    )
  $$,
  'a teacher can save a quiz with five options and five correct answers'
);

SELECT is(
  (SELECT q.options @> '[{"id":"E"}]'::jsonb
   FROM public.questions q
   JOIN public.quizzes z ON z.id = q.quiz_id
   WHERE z.legacy_id = 'pgtap-five-option-quiz'
     AND q.legacy_id = 'pgtap-five-option-question-all'),
  true,
  'the fifth option is stored'
);

SELECT is(
  (SELECT jsonb_array_length(k.correct_answers)
   FROM public.question_answer_keys k
   JOIN public.questions q ON q.id = k.question_id
   JOIN public.quizzes z ON z.id = q.quiz_id
   WHERE z.legacy_id = 'pgtap-five-option-quiz'
     AND q.legacy_id = 'pgtap-five-option-question-all'),
  5,
  'the answer key can store all five correct options'
);

SELECT set_config('request.jwt.claims', '{"sub":"pgtap-five-option-student","role":"authenticated","app_role":"student"}', true);

SELECT is(
  (
    public.save_attempt(
      (public.start_attempt((SELECT id FROM public.quizzes WHERE legacy_id = 'pgtap-five-option-quiz'))->>'id')::uuid,
      0,
      jsonb_build_object(
        (SELECT id::text FROM public.questions WHERE legacy_id = 'pgtap-five-option-question-all'),
        '["A","B","C","D","E"]'::jsonb,
        (SELECT id::text FROM public.questions WHERE legacy_id = 'pgtap-five-option-question-e'),
        '["E"]'::jsonb
      ),
      '[]'::jsonb,
      1
    )->'answers'->(SELECT id::text FROM public.questions WHERE legacy_id = 'pgtap-five-option-question-e')->>0
  ),
  'E',
  'an exam answer can select option E'
);

SELECT is(
  jsonb_array_length(
    (SELECT public.list_sessions()->0->'answers'->q.id::text
     FROM public.questions q
     WHERE q.legacy_id = 'pgtap-five-option-question-all')
  ),
  5,
  'exam autosave accepts all five selected answers'
);

SELECT set_config(
  'qizzone.pgtap_practice_session_id',
  public.start_practice((SELECT id FROM public.quizzes WHERE legacy_id = 'pgtap-five-option-quiz'), 2, true)->>'id',
  true
);

SELECT is(
  public.check_practice_answer(
    current_setting('qizzone.pgtap_practice_session_id')::uuid,
    (SELECT id FROM public.questions WHERE legacy_id = 'pgtap-five-option-question-all'),
    '["A","B","C","D","E"]'::jsonb
  )->>'isCorrect',
  'true',
  'practice checking accepts all five selected answers'
);

SELECT is(
  public.check_practice_answer(
    current_setting('qizzone.pgtap_practice_session_id')::uuid,
    (SELECT id FROM public.questions WHERE legacy_id = 'pgtap-five-option-question-all'),
    '["A","B","C","D","E"]'::jsonb
  )->'selectedAnswers',
  '["A","B","C","D","E"]'::jsonb,
  'practice storage preserves a five-answer response'
);

SELECT set_config('request.jwt.claims', '{"sub":"pgtap-five-option-import-student","role":"authenticated","app_role":"student"}', true);

SELECT is(
  public.import_legacy_attempt(
    'pgtap-five-option-attempt',
    'pgtap-five-option-quiz',
    '{"answers":{"pgtap-five-option-question-all":["A","B","C","D","E"],"pgtap-five-option-question-e":["E"]}}'::jsonb
  )->'answers'->(SELECT id::text FROM public.questions WHERE legacy_id = 'pgtap-five-option-question-e')->>0,
  'E',
  'legacy attempt import accepts option E'
);

SELECT is(
  jsonb_array_length(
    public.import_legacy_attempt(
      'pgtap-five-option-attempt',
      'pgtap-five-option-quiz',
      '{"answers":{"pgtap-five-option-question-all":["A","B","C","D","E"],"pgtap-five-option-question-e":["E"]}}'::jsonb
    )->'answers'->(SELECT id::text FROM public.questions WHERE legacy_id = 'pgtap-five-option-question-all')
  ),
  5,
  'legacy attempt import accepts five selected answers'
);

SELECT set_config('request.jwt.claims', '{"sub":"pgtap-five-option-teacher","role":"authenticated","app_role":"teacher"}', true);

SELECT throws_ok(
  $$
    SELECT public.save_quiz(
      '{
        "title":"Six option fixture",
        "subject":"Test",
        "status":"draft",
        "settings":{"durationMinutes":0,"maxAttempts":0,"passPercentage":70},
        "questions":[{
          "content":"This must be rejected",
          "type":"multiple_choice",
          "options":[
            {"id":"A","content":"A"}, {"id":"B","content":"B"},
            {"id":"C","content":"C"}, {"id":"D","content":"D"},
            {"id":"E","content":"E"}, {"id":"F","content":"F"}
          ],
          "correctAnswers":["A"],
          "points":1
        }]
      }'::jsonb,
      null,
      null
    )
  $$,
  'P0001',
  'Câu hỏi hoặc đáp án không hợp lệ',
  'six-option questions stay invalid'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
