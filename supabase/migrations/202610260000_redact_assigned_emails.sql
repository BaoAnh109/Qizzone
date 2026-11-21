-- Student quiz listings need only the current student's assignment email.
-- Keep email allowlists private while preserving code/link discovery for published quizzes.
create or replace function public.list_quizzes() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'title', q.title,
    'subject', q.subject,
    'description', q.description,
    'teacherId', q.teacher_uid,
    'teacherName', p.full_name,
    'code', q.code,
    'status', q.status,
    'settings', case
      when public.owns_quiz(q.id) then q.settings
      else jsonb_set(
        coalesce(q.settings, '{}'::jsonb),
        '{assignedEmails}',
        coalesce((
          select jsonb_agg(to_jsonb(assignment.email))
          from jsonb_array_elements_text(
            case
              when jsonb_typeof(q.settings->'assignedEmails') = 'array' then q.settings->'assignedEmails'
              else '[]'::jsonb
            end
          ) as assignment(email)
          where lower(btrim(assignment.email)) = lower(btrim((
            select student_profile.email
            from public.profiles student_profile
            where student_profile.firebase_uid = public.current_uid()
          )))
        ), '[]'::jsonb),
        true
      )
    end,
    'createdAt', q.created_at,
    'updatedAt', q.updated_at,
    'totalQuestions', (select count(*) from public.questions where quiz_id = q.id),
    'totalPoints', (select coalesce(sum(points), 0) from public.questions where quiz_id = q.id),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', question.id,
        'order', question.ordinal,
        'content', question.content,
        'type', question.type,
        'options', question.options,
        'points', question.points,
        'correctAnswers', case when public.owns_quiz(q.id) then answer_key.correct_answers else '[]'::jsonb end,
        'explanation', case when public.owns_quiz(q.id) then answer_key.explanation else null end
      ) order by question.ordinal), '[]'::jsonb)
      from public.questions question
      left join public.question_answer_keys answer_key on answer_key.question_id = question.id
      where question.quiz_id = q.id
    )
  ) order by q.created_at desc), '[]'::jsonb)
  from public.quizzes q
  join public.profiles p on p.firebase_uid = q.teacher_uid
  where public.can_read_quiz(q.id)
$$;
