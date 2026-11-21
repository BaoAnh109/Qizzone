-- Practice sessions are independent from exam attempts and results. Correct
-- answers stay server-side until a question is locked or the session is ended.
create table public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null,
  quiz_title text not null,
  subject text not null,
  student_uid text not null references public.profiles(firebase_uid),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'in_progress' check (status in ('in_progress','completed','invalidated')),
  failure_message text,
  quiz_updated_at timestamptz not null,
  question_order uuid[] not null check (cardinality(question_order) > 0),
  option_order jsonb not null default '{}'::jsonb check (jsonb_typeof(option_order) = 'object'),
  show_explanation boolean not null default true,
  answer_count integer not null default 0 check (answer_count >= 0),
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  check (status <> 'completed' or result is not null)
);

create index practice_sessions_student_started on public.practice_sessions(student_uid, started_at desc);

create table public.practice_answers (
  session_id uuid not null references public.practice_sessions(id) on delete cascade,
  question_id uuid not null,
  selected_answers jsonb not null check (jsonb_typeof(selected_answers) = 'array' and jsonb_array_length(selected_answers) between 1 and 4),
  is_correct boolean not null,
  correct_answers jsonb not null check (jsonb_typeof(correct_answers) = 'array'),
  explanation text not null default '',
  checked_at timestamptz not null default now(),
  primary key (session_id, question_id)
);

alter table public.practice_sessions enable row level security;
alter table public.practice_answers enable row level security;

-- RLS remains enabled for defense in depth. Client table privileges are revoked;
-- students read practice state only through the owner-checked RPCs below.
create policy practice_session_read on public.practice_sessions
  for select to authenticated using (student_uid = public.current_uid() and public.has_role(array['student']));
create policy practice_answer_read on public.practice_answers
  for select to authenticated using (exists (
    select 1 from public.practice_sessions s
    where s.id = session_id and s.student_uid = public.current_uid() and public.has_role(array['student'])
  ));
revoke all on public.practice_sessions, public.practice_answers from public, anon, authenticated;

create function public.start_practice(
  p_quiz_id uuid,
  p_question_count integer default null,
  p_show_explanation boolean default true
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  q public.quizzes;
  s public.practice_sessions;
  total_count integer;
  take_count integer;
  ids uuid[];
  opts jsonb;
begin
  if not public.has_role(array['student']) then raise exception 'Chỉ học sinh được luyện tập'; end if;

  select * into q from public.quizzes where id = p_quiz_id for update;
  if not found then raise exception 'Không tìm thấy đề luyện tập'; end if;
  if q.status <> 'published' then raise exception 'Đề chưa được xuất bản hoặc đã đóng'; end if;
  if q.settings->'practiceEnabled' = 'false'::jsonb then raise exception 'Giáo viên đã tắt chức năng luyện tập cho đề này'; end if;

  select count(*)::integer into total_count from public.questions where quiz_id = q.id;
  if total_count = 0 then raise exception 'Đề chưa có câu hỏi để luyện tập'; end if;
  if p_question_count is not null and (p_question_count < 1 or p_question_count > total_count) then
    raise exception 'Số câu luyện tập phải từ 1 đến %', total_count;
  end if;
  take_count := coalesce(p_question_count, total_count);

  -- Match start_attempt's shuffle expressions: use random() for configured
  -- question/option shuffling, otherwise preserve ordinal/array order.
  select array_agg(chosen.id order by
    case when coalesce((q.settings->>'shuffleQuestions')::boolean, false) then random() else chosen.ordinal::float end
  ) into ids
  from (
    select x.id, x.ordinal
    from public.questions x
    where x.quiz_id = q.id
    order by case when take_count < total_count then random() else x.ordinal::float end
    limit take_count
  ) chosen;

  select coalesce(jsonb_object_agg(x.id::text, ordered.option_ids), '{}'::jsonb)
  into opts
  from public.questions x
  cross join lateral (
    select jsonb_agg(o->>'id' order by
      case when coalesce((q.settings->>'shuffleOptions')::boolean, false) then random() else z::float end
    ) as option_ids
    from jsonb_array_elements(x.options) with ordinality as choices(o, z)
  ) ordered
  where x.id = any(ids);

  insert into public.practice_sessions(
    quiz_id, quiz_title, subject, student_uid, quiz_updated_at,
    question_order, option_order, show_explanation
  ) values (
    q.id, q.title, q.subject, public.current_uid(), q.updated_at,
    ids, opts, coalesce(p_show_explanation, true)
  ) returning * into s;

  return jsonb_build_object(
    'id', s.id, 'quizId', s.quiz_id, 'quizTitle', s.quiz_title, 'subject', s.subject,
    'studentId', s.student_uid, 'startedAt', s.started_at, 'status', s.status,
    'questionOrder', to_jsonb(s.question_order), 'optionOrder', s.option_order,
    'showExplanation', s.show_explanation, 'answerCount', 0
  );
end
$$;

create function public.get_practice_session(p_session_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.practice_sessions;
  current_status text;
  current_updated_at timestamptz;
  answers jsonb;
  message text := 'Đề đã bị giáo viên đóng, xóa hoặc chỉnh sửa trong lúc luyện tập. Lượt này không thể tiếp tục; hãy quay lại mục Luyện tập.';
begin
  if not public.has_role(array['student']) then raise exception 'Chỉ học sinh được mở lượt luyện tập'; end if;
  select * into s from public.practice_sessions where id = p_session_id and student_uid = public.current_uid() for update;
  if not found then raise exception 'Không tìm thấy lượt luyện tập hoặc bạn không có quyền truy cập'; end if;
  if s.status = 'invalidated' then
    return jsonb_build_object('id', s.id, 'status', s.status, 'message', coalesce(s.failure_message, message));
  end if;
  if s.status = 'completed' then return jsonb_build_object('id', s.id, 'status', s.status); end if;

  select q.status, q.updated_at into current_status, current_updated_at
  from public.quizzes q where q.id = s.quiz_id;
  if not found or current_status <> 'published' or current_updated_at is distinct from s.quiz_updated_at then
    update public.practice_sessions set status = 'invalidated', finished_at = now(), failure_message = message where id = s.id;
    return jsonb_build_object('id', s.id, 'status', 'invalidated', 'message', message);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'questionId', a.question_id,
    'selectedAnswers', a.selected_answers,
    'isCorrect', a.is_correct,
    'correctAnswers', a.correct_answers,
    'explanation', case when s.show_explanation then a.explanation else null end,
    'checkedAt', a.checked_at
  ) order by array_position(s.question_order, a.question_id)), '[]'::jsonb)
  into answers
  from public.practice_answers a where a.session_id = s.id;

  return jsonb_build_object(
    'id', s.id, 'quizId', s.quiz_id, 'quizTitle', s.quiz_title, 'subject', s.subject,
    'studentId', s.student_uid, 'startedAt', s.started_at, 'status', s.status,
    'questionOrder', to_jsonb(s.question_order), 'optionOrder', s.option_order,
    'showExplanation', s.show_explanation, 'answerCount', s.answer_count, 'answers', answers
  );
end
$$;

create function public.check_practice_answer(
  p_session_id uuid,
  p_question_id uuid,
  p_selected_answers jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.practice_sessions;
  v_type text;
  v_options jsonb;
  v_correct jsonb;
  v_explanation text;
  v_is_correct boolean;
  existing public.practice_answers;
  current_status text;
  current_updated_at timestamptz;
  message text := 'Đề đã bị giáo viên đóng, xóa hoặc chỉnh sửa trong lúc luyện tập. Lượt này không thể tiếp tục; hãy quay lại mục Luyện tập.';
  option_id text;
begin
  if not public.has_role(array['student']) then raise exception 'Chỉ học sinh được kiểm tra câu luyện tập'; end if;
  select * into s from public.practice_sessions where id = p_session_id and student_uid = public.current_uid() for update;
  if not found then raise exception 'Không tìm thấy lượt luyện tập hoặc bạn không có quyền truy cập'; end if;
  if s.status = 'invalidated' then return jsonb_build_object('status', s.status, 'message', coalesce(s.failure_message, message)); end if;
  if s.status <> 'in_progress' then raise exception 'Lượt luyện tập đã kết thúc'; end if;

  select q.status, q.updated_at into current_status, current_updated_at
  from public.quizzes q where q.id = s.quiz_id;
  if not found or current_status <> 'published' or current_updated_at is distinct from s.quiz_updated_at then
    update public.practice_sessions set status = 'invalidated', finished_at = now(), failure_message = message where id = s.id;
    return jsonb_build_object('status', 'invalidated', 'message', message);
  end if;
  if p_question_id is null or not (p_question_id = any(s.question_order)) then raise exception 'Câu hỏi không thuộc lượt luyện tập này'; end if;

  select * into existing from public.practice_answers where session_id = s.id and question_id = p_question_id;
  if found then
    return jsonb_build_object(
      'questionId', existing.question_id, 'selectedAnswers', existing.selected_answers,
      'isCorrect', existing.is_correct, 'correctAnswers', existing.correct_answers,
      'explanation', case when s.show_explanation then existing.explanation else null end,
      'checkedAt', existing.checked_at, 'locked', true
    );
  end if;

  if jsonb_typeof(p_selected_answers) is distinct from 'array'
    or jsonb_array_length(p_selected_answers) not between 1 and 4 then
    raise exception 'Vui lòng chọn ít nhất một đáp án hợp lệ';
  end if;
  if (select count(distinct value) from jsonb_array_elements_text(p_selected_answers) as selected(value)) <> jsonb_array_length(p_selected_answers) then
    raise exception 'Đáp án được chọn bị trùng';
  end if;

  select q.type, q.options into v_type, v_options
  from public.questions q where q.id = p_question_id and q.quiz_id = s.quiz_id;
  if not found then raise exception 'Câu hỏi không còn thuộc đề luyện tập'; end if;
  if v_type <> 'multiple_choice' and jsonb_array_length(p_selected_answers) <> 1 then raise exception 'Câu này chỉ được chọn một đáp án'; end if;
  for option_id in select value from jsonb_array_elements_text(p_selected_answers) as selected(value) loop
    if not exists(select 1 from jsonb_array_elements(v_options) as option_value where option_value->>'id' = option_id) then
      raise exception 'Phương án không thuộc câu hỏi này';
    end if;
  end loop;
  select k.correct_answers, k.explanation into v_correct, v_explanation
  from public.question_answer_keys k where k.question_id = p_question_id;
  if not found then raise exception 'Câu hỏi chưa có đáp án để kiểm tra'; end if;

  -- Keep the same exact all-or-nothing set comparison used by finalize_attempt.
  v_is_correct := p_selected_answers @> v_correct and v_correct @> p_selected_answers;
  insert into public.practice_answers(session_id, question_id, selected_answers, is_correct, correct_answers, explanation)
  values (s.id, p_question_id, p_selected_answers, v_is_correct, v_correct, v_explanation)
  returning * into existing;
  update public.practice_sessions set answer_count = answer_count + 1 where id = s.id;

  return jsonb_build_object(
    'questionId', existing.question_id, 'selectedAnswers', existing.selected_answers,
    'isCorrect', existing.is_correct, 'correctAnswers', existing.correct_answers,
    'explanation', case when s.show_explanation then existing.explanation else null end,
    'checkedAt', existing.checked_at, 'locked', true
  );
end
$$;

create function public.finish_practice(p_session_id uuid) returns jsonb
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
  if s.status = 'completed' then return s.result; end if;
  if s.status = 'invalidated' then return jsonb_build_object('status', s.status, 'message', coalesce(s.failure_message, message)); end if;

  select q.status, q.updated_at into current_status, current_updated_at
  from public.quizzes q where q.id = s.quiz_id;
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
    'type', q.type,
    'options', q.options,
    'optionOrder', s.option_order->q.id::text,
    'selectedAnswers', coalesce(a.selected_answers, '[]'::jsonb),
    -- Never disclose keys for questions the student has not checked yet.
    'correctAnswers', coalesce(a.correct_answers, '[]'::jsonb),
    'isCorrect', coalesce(a.is_correct, false),
    'checked', a.question_id is not null,
    'explanation', coalesce(a.explanation, '')
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

create function public.list_practice_history() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_role(array['student']) then raise exception 'Chỉ học sinh được xem lịch sử luyện tập'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'sessionId', s.id, 'quizId', s.quiz_id,
      'quizTitle', s.quiz_title, 'subject', s.subject,
      'startedAt', s.started_at, 'finishedAt', s.finished_at,
      'status', s.status, 'message', s.failure_message,
      'totalQuestions', cardinality(s.question_order),
      'answeredCount', coalesce((s.result->>'answeredCount')::integer, counts.answered_count, 0),
      'correctCount', coalesce((s.result->>'correctCount')::integer, counts.correct_count, 0),
      'percentage', coalesce((s.result->>'percentage')::numeric, round(coalesce(counts.correct_count, 0)::numeric / nullif(cardinality(s.question_order), 0) * 100, 2), 0),
      'durationSeconds', case when s.result is not null then (s.result->>'durationSeconds')::integer else greatest(0, floor(extract(epoch from (now() - s.started_at)))::integer) end
    ) order by s.started_at desc)
    from public.practice_sessions s
    left join lateral (
      select count(*)::integer as answered_count, count(*) filter (where a.is_correct)::integer as correct_count
      from public.practice_answers a where a.session_id = s.id
    ) counts on true
    where s.student_uid = public.current_uid()
  ), '[]'::jsonb);
end
$$;

revoke execute on function public.start_practice(uuid,integer,boolean) from public, anon;
revoke execute on function public.get_practice_session(uuid) from public, anon;
revoke execute on function public.check_practice_answer(uuid,uuid,jsonb) from public, anon;
revoke execute on function public.finish_practice(uuid) from public, anon;
revoke execute on function public.list_practice_history() from public, anon;
grant execute on function public.start_practice(uuid,integer,boolean) to authenticated;
grant execute on function public.get_practice_session(uuid) to authenticated;
grant execute on function public.check_practice_answer(uuid,uuid,jsonb) to authenticated;
grant execute on function public.finish_practice(uuid) to authenticated;
grant execute on function public.list_practice_history() to authenticated;
