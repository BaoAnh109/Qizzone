-- Local/staging sample data only. Never apply to production.
insert into public.profiles(id,firebase_uid,email,full_name,role) values
  ('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','teacher.dev@example.test','Giáo viên Dev','teacher'),
  ('22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222','student.dev@example.test','Học sinh Dev','student'),
  ('33333333-3333-4333-8333-333333333333','33333333-3333-4333-8333-333333333333','admin.dev@example.test','Quản trị Dev','admin'),
  ('44444444-4444-4444-8444-444444444444','44444444-4444-4444-8444-444444444444','pending.teacher.dev@example.test','Giáo viên chờ duyệt','teacher')
on conflict do nothing;

update public.profiles
set approval_status = 'pending', approval_requested_at = now()
where firebase_uid = '44444444-4444-4444-8444-444444444444';

insert into public.quizzes(id,teacher_uid,title,subject,description,code,status,settings,legacy_id)
values (
  '10000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'Đề mẫu Supabase V3',
  'Toán học',
  'Dữ liệu mẫu chỉ dành cho môi trường local/staging.',
  'DEV001',
  'published',
  '{"durationMinutes":15,"shuffleQuestions":true,"shuffleOptions":true,"allowReview":true,"maxAttempts":2,"passPercentage":50}'::jsonb,
  'quiz-dev-seed'
)
on conflict do nothing;

insert into public.questions(id,quiz_id,ordinal,content,type,options,points,legacy_id) values
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    1,
    'Kết quả của $2 + 2$ là?',
    'single_choice',
    '[{"id":"A","content":"3"},{"id":"B","content":"4"},{"id":"C","content":"5"}]'::jsonb,
    5,
    'q-dev-1'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    2,
    'Số nào là số nguyên tố?',
    'multiple_choice',
    '[{"id":"A","content":"2"},{"id":"B","content":"3"},{"id":"C","content":"4"}]'::jsonb,
    5,
    'q-dev-2'
  )
on conflict do nothing;

insert into public.question_answer_keys(question_id,correct_answers,explanation) values
  ('20000000-0000-4000-8000-000000000001','["B"]'::jsonb,'$2 + 2 = 4$.'),
  ('20000000-0000-4000-8000-000000000002','["A","B"]'::jsonb,'2 và 3 là số nguyên tố.')
on conflict do nothing;
