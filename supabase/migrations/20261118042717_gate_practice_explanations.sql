-- Enforce the practice-session explanation preference when returning a result.
-- Completed sessions may already have a stored result created by the earlier
-- RPC, so redact that payload on replay as well as on first completion.
create or replace function public.finish_practice(p_session_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.practice_sessions;
  current_status text;
  current_updated_at timestamptz;
  answered_count integer;
  correct_count integer;
  total_count integer;
  pct numeric;
  duration_seconds integer;
  details jsonb;
  result_payload jsonb;
  message text := 'Đề đã bị giáo viên đóng, xóa hoặc chỉnh sửa trong lúc luyện tập. Lượt này không thể hoàn tất; hãy quay lại mục Luyện tập.';
begin
  if not public.has_role(array['student']) then raise exception 'Chỉ học sinh được kết thúc lượt luyện tập'; end if;
  select * into s from public.practice_sessions where id = p_session_id and student_uid = public.current_uid() for update;
  if not found then raise exception 'Không tìm thấy lượt luyện tập hoặc bạn không có quyền truy cập'; end if;
  if s.status = 'completed' then
    if s.show_explanation then
      return s.result;
    end if;
    if jsonb_typeof(s.result->'details') is distinct from 'array' then
      return jsonb_set(s.result, '{details}', '[]'::jsonb, true);
    end if;
    select coalesce(jsonb_agg(jsonb_set(item.detail, '{explanation}', 'null'::jsonb, true) order by item.ordinality), '[]'::jsonb)
      into details
      from jsonb_array_elements(s.result->'details') with ordinality as item(detail, ordinality);
    return jsonb_set(s.result, '{details}', details, false);
  end if;
  if s.status = 'invalidated' then return jsonb_build_object('status', s.status, 'message', coalesce(s.failure_message, message)); end if;

  select q.status, q.updated_at into current_status, current_updated_at from public.quizzes q where q.id = s.quiz_id;
  if not found or current_status <> 'published' or current_updated_at is distinct from s.quiz_updated_at then
    update public.practice_sessions set status = 'invalidated', finished_at = now(), failure_message = message where id = s.id;
    return jsonb_build_object('status', 'invalidated', 'message', message);
  end if;

  total_count := cardinality(s.question_order);
  select count(*)::integer, count(*) filter (where is_correct)::integer
    into answered_count, correct_count from public.practice_answers where session_id = s.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'questionId', q.id,
    'order', requested.position,
    'content', q.content,
    'images', q.images,
    'type', q.type,
    'options', q.options,
    'optionOrder', s.option_order->q.id::text,
    'selectedAnswers', coalesce(a.selected_answers, '[]'::jsonb),
    'correctAnswers', coalesce(a.correct_answers, '[]'::jsonb),
    'isCorrect', coalesce(a.is_correct, false),
    'checked', a.question_id is not null,
    'explanation', case when s.show_explanation then coalesce(a.explanation, '') else null end
  ) order by requested.position), '[]'::jsonb)
    into details
    from unnest(s.question_order) with ordinality as requested(question_id, position)
    join public.questions q on q.id = requested.question_id and q.quiz_id = s.quiz_id
    join public.question_answer_keys k on k.question_id = q.id
    left join public.practice_answers a on a.session_id = s.id and a.question_id = q.id;

  if jsonb_array_length(details) <> total_count then
    update public.practice_sessions set status = 'invalidated', finished_at = now(), failure_message = message where id = s.id;
    return jsonb_build_object('status', 'invalidated', 'message', message);
  end if;
  pct := round(correct_count::numeric / nullif(total_count, 0) * 100, 2);
  duration_seconds := greatest(0, floor(extract(epoch from (clock_timestamp() - s.started_at)))::integer);
  result_payload := jsonb_build_object(
    'id', s.id, 'sessionId', s.id, 'quizId', s.quiz_id, 'quizTitle', s.quiz_title, 'subject', s.subject,
    'studentId', s.student_uid, 'startedAt', s.started_at, 'finishedAt', clock_timestamp(),
    'totalQuestions', total_count, 'answeredCount', answered_count,
    'correctCount', correct_count, 'incorrectCount', answered_count - correct_count,
    'skippedCount', total_count - answered_count, 'percentage', pct,
    'durationSeconds', duration_seconds, 'details', details
  );
  update public.practice_sessions
    set status = 'completed', finished_at = (result_payload->>'finishedAt')::timestamptz, result = result_payload
    where id = s.id;
  return result_payload;
end
$$;
