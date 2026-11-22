-- M2 Backend Hardening (R2-R4 edge cases):
-- 1. private.redact_result_for_caller: treat quizzes.status = 'closed' as closed for 'after_close'
--    scoreVisibility & answerVisibility even when closesAt/hard_close_at is null, and parse closesAt safely.
-- 2. public.list_student_assignments: include 'closed' quizzes, coalesce settings->>'closesAt' into
--    hardCloseAt and overdue calculation, mark unsubmitted 'closed' quizzes as 'overdue', and align
--    att/latest_res attempt filtering strictly with start_attempt's quiz-wide scope.
-- 100% PGlite-compatible.

create or replace function private.redact_result_for_caller(
  p_payload jsonb,
  p_quiz_settings jsonb,
  p_allow_review boolean,
  p_hard_close_at timestamptz,
  p_quiz_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_quiz_status text;
  v_close_ts timestamptz;
  v_is_closed boolean;
  v_score_vis text;
  v_answer_vis text;
  v_show_score boolean;
  v_show_answers boolean;
  v_out jsonb := p_payload;
begin
  if public.owns_quiz(p_quiz_id) then
    return v_out || jsonb_build_object('scoreHidden', false, 'answersHidden', false);
  end if;

  select q.status
  into v_quiz_status
  from public.quizzes q
  where q.id = p_quiz_id;

  v_close_ts := coalesce(
    p_hard_close_at,
    private.safe_timestamptz(p_quiz_settings->>'closesAt')
  );
  v_is_closed := (v_quiz_status = 'closed') or (v_close_ts is not null and now() >= v_close_ts);

  v_score_vis := coalesce(nullif(btrim(coalesce(p_quiz_settings->>'scoreVisibility', '')), ''), 'immediate');
  v_answer_vis := coalesce(
    nullif(btrim(coalesce(p_quiz_settings->>'answerVisibility', '')), ''),
    case when coalesce(p_allow_review, true) then 'immediate' else 'never' end
  );

  v_show_score := case v_score_vis
    when 'immediate' then true
    when 'after_close' then v_is_closed
    else false
  end;

  v_show_answers := case v_answer_vis
    when 'immediate' then true
    when 'after_close' then v_is_closed
    else false
  end;

  if not v_show_answers then
    v_out := v_out || jsonb_build_object('details', '[]'::jsonb, 'answersHidden', true);
  else
    v_out := v_out || jsonb_build_object('answersHidden', false);
  end if;

  if not v_show_score then
    v_out := v_out || jsonb_build_object(
      'score', null,
      'totalPointsEarned', null,
      'percentage', null,
      'isPassed', null,
      'academicRank', null,
      'correctCount', null,
      'incorrectCount', null,
      'scoreHidden', true
    );
  else
    v_out := v_out || jsonb_build_object('scoreHidden', false);
  end if;

  return v_out;
end
$$;

revoke execute on function
  private.redact_result_for_caller(jsonb, jsonb, boolean, timestamptz, uuid)
  from public, anon, authenticated;

create or replace function public.list_student_assignments(p_classroom_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid text := public.current_uid();
  v_items jsonb;
begin
  if v_uid is null then
    raise exception 'Chưa đăng nhập';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'assignmentId', qa.id,
    'classroomId', c.id,
    'classroomName', c.name,
    'quizId', q.id,
    'quizTitle', q.title,
    'quizCode', q.code,
    'subject', q.subject,
    'title', qa.title,
    'instructions', qa.instructions,
    'availableFrom', qa.available_from,
    'dueAt', qa.due_at,
    'latePolicy', qa.late_policy,
    'hardCloseAt', coalesce(qa.hard_close_at, private.safe_timestamptz(q.settings->>'closesAt')),
    'maxAttempts', coalesce(
      qa.max_attempts_override,
      nullif(btrim(coalesce(q.settings->>'maxAttempts', '')), '')::integer,
      0
    ),
    'attemptCount', coalesce(att.total_count, 0),
    'hasActiveAttempt', coalesce(att.active_count, 0) > 0,
    'status', case
      when coalesce(att.submitted_count, 0) > 0 then 'completed'
      when coalesce(qa.due_at, qa.hard_close_at, private.safe_timestamptz(q.settings->>'closesAt')) is not null
           and now() > coalesce(qa.due_at, qa.hard_close_at, private.safe_timestamptz(q.settings->>'closesAt'))
        then 'overdue'
      when q.status = 'closed' then 'overdue'
      else 'todo'
    end,
    'isLate', coalesce(latest_res.is_late, false),
    'bestScore', case
      when latest_res.best_redacted is null then null
      when (latest_res.best_redacted->>'scoreHidden')::boolean then null
      else (latest_res.best_redacted->>'score')::numeric
    end,
    'scoreHidden', coalesce((latest_res.best_redacted->>'scoreHidden')::boolean, false),
    'latestResultId', latest_res.latest_result_id,
    'latestSubmittedAt', latest_res.latest_submitted_at
  ) order by coalesce(qa.due_at, qa.created_at) asc, qa.created_at desc), '[]'::jsonb)
  into v_items
  from public.classroom_members cm
  join public.classrooms c on c.id = cm.classroom_id and not c.is_archived
  join public.quiz_assignments qa on qa.classroom_id = c.id
  join public.quizzes q on q.id = qa.quiz_id and q.status in ('published', 'closed')
  left join lateral (
    select
      count(*)::integer as total_count,
      count(*) filter (where a.submitted_at is null)::integer as active_count,
      count(*) filter (where a.submitted_at is not null)::integer as submitted_count
    from public.exam_attempts a
    where a.student_uid = v_uid
      and a.quiz_id = q.id
  ) att on true
  left join lateral (
    select
      (array_agg(er.id order by a.submitted_at desc))[1] as latest_result_id,
      max(a.submitted_at) as latest_submitted_at,
      bool_or(a.is_late) as is_late,
      (array_agg(
        private.redact_result_for_caller(
          er.payload || jsonb_build_object('id', er.id),
          q.settings,
          a.allow_review,
          qa.hard_close_at,
          q.id
        ) order by (er.payload->>'score')::numeric desc nulls last
      ))[1] as best_redacted
    from public.exam_attempts a
    join public.exam_results er on er.attempt_id = a.id
    where a.student_uid = v_uid
      and a.quiz_id = q.id
      and a.submitted_at is not null
  ) latest_res on true
  where cm.student_uid = v_uid
    and cm.status = 'active'
    and (p_classroom_id is null or c.id = p_classroom_id);

  return v_items;
end
$$;

revoke execute on function public.list_student_assignments(uuid) from public, anon;
grant execute on function public.list_student_assignments(uuid) to authenticated;
