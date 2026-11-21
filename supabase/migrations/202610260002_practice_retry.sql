create function public.start_practice_retry(
  p_source_session_id uuid,
  p_mode text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  source_session public.practice_sessions;
  q public.quizzes;
  target_ids uuid[];
  ordered_ids uuid[];
  ordered_options jsonb;
  started jsonb;
  new_session_id uuid;
begin
  if not public.has_role(array['student']) then raise exception 'Chỉ học sinh được luyện lại'; end if;
  if p_mode is null or p_mode not in ('wrong', 'all') then raise exception 'Chế độ luyện lại không hợp lệ'; end if;

  select * into source_session
  from public.practice_sessions
  where id = p_source_session_id and student_uid = public.current_uid()
  for update;
  if not found then raise exception 'Không tìm thấy lượt luyện tập hoặc bạn không có quyền truy cập'; end if;
  if source_session.status <> 'completed' or source_session.result is null then
    raise exception 'Chỉ có thể luyện lại từ một lượt đã hoàn thành';
  end if;

  select * into q from public.quizzes where id = source_session.quiz_id;
  if not found or q.status <> 'published' or q.updated_at is distinct from source_session.quiz_updated_at then
    raise exception 'Đề đã bị giáo viên đóng, xóa hoặc chỉnh sửa. Hãy chọn đề đang được bật trong mục Luyện tập.';
  end if;
  if q.settings->'practiceEnabled' = 'false'::jsonb then
    raise exception 'Giáo viên đã tắt chức năng luyện tập cho đề này';
  end if;

  if p_mode = 'all' then
    target_ids := source_session.question_order;
  else
    select array_agg((detail.value->>'questionId')::uuid order by detail.position)
    into target_ids
    from jsonb_array_elements(source_session.result->'details') with ordinality as detail(value, position)
    where coalesce((detail.value->>'isCorrect')::boolean, false) = false;
    if target_ids is null or cardinality(target_ids) = 0 then
      raise exception 'Không có câu sai hoặc chưa trả lời cần luyện lại';
    end if;
  end if;

  -- Create through the normal start RPC so published/practiceEnabled checks and
  -- option shuffling stay identical. Replace only the sampled question set
  -- inside this transaction before returning the session to the client.
  started := public.start_practice(q.id, cardinality(target_ids), source_session.show_explanation);
  new_session_id := (started->>'id')::uuid;

  select array_agg(target.question_id order by
    case when coalesce((q.settings->>'shuffleQuestions')::boolean, false) then random() else question.ordinal::float end
  ) into ordered_ids
  from unnest(target_ids) as target(question_id)
  join public.questions question on question.id = target.question_id and question.quiz_id = q.id;

  select coalesce(jsonb_object_agg(question.id::text, ordered.option_ids), '{}'::jsonb)
  into ordered_options
  from public.questions question
  cross join lateral (
    select jsonb_agg(option_value->>'id' order by
      case when coalesce((q.settings->>'shuffleOptions')::boolean, false) then random() else option_position::float end
    ) as option_ids
    from jsonb_array_elements(question.options) with ordinality as choices(option_value, option_position)
  ) ordered
  where question.id = any(ordered_ids);

  if ordered_ids is null or cardinality(ordered_ids) <> cardinality(target_ids) then
    raise exception 'Một số câu trong lượt cũ không còn thuộc đề hiện tại';
  end if;
  update public.practice_sessions
  set question_order = ordered_ids, option_order = ordered_options
  where id = new_session_id;

  return public.get_practice_session(new_session_id);
end
$$;

revoke execute on function public.start_practice_retry(uuid,text) from public, anon;
grant execute on function public.start_practice_retry(uuid,text) to authenticated;
