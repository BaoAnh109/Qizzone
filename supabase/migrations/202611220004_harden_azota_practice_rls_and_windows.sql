-- M1 Iteration 2 Hardening:
-- 1. Separate active quiz participation access (has_active_quiz_access) from historical metadata access
--    so removed classroom members cannot re-join or start new attempts on class_only quizzes.
-- 2. Add can_read_quiz_questions(qid) enforcing opensAt and quiz_assignments.available_from.
-- 3. Revoke direct table privileges on public.quizzes and public.questions from public/anon/authenticated
--    and tighten quiz_read / question_read RLS policies with (select ...) initPlan.
-- 4. Gate private.quiz_json('questions') and join_quiz_by_code on can_read_quiz_questions / available_from / hard_close_at,
--    and enforce opensAt floor + non-archived classrooms + in-window assignment preference in start_attempt.
-- 5. Enforce opensAt, available_from, and answerVisibility (including legacy allowReview) in practice RPCs
--    while preserving 5-option (A-E) checks and question media ('images') payloads.
-- 6. Enforce coalesce(qa.hard_close_at, q.settings->>'closesAt') + 60s grace cutoff in submit_attempt,
--    finalize_exam_attempt, and finalize_expired (plus block_after_due in finalize_expired).
-- 7. Reject inverted availableFrom > hardCloseAt when dueAt is null in assign_quiz_to_classrooms,
--    and validate/normalize Azota settings in save_quiz (preserving 202611170001 media and 20261118050412 A-E checks).
-- 100% PGlite-compatible.

create or replace function private.safe_timestamptz(p_val text)
returns timestamptz
language plpgsql stable set search_path = '' as $$
declare
  v_trimmed text := nullif(btrim(coalesce(p_val, '')), '');
begin
  if v_trimmed is null then
    return null;
  end if;
  return v_trimmed::timestamptz;
exception when others then
  return null;
end
$$;

create or replace function public.has_active_quiz_access(qid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.owns_quiz(qid)
    or (
      public.has_role(array['student'])
      and exists (
        select 1
        from public.quizzes q
        where q.id = qid
          and q.status = 'published'
          and (
            coalesce(nullif(btrim(coalesce(q.settings->>'publishScope', '')), ''), 'public') = 'public'
            or exists (
              select 1
              from public.quiz_assignments qa
              join public.classroom_members cm on cm.classroom_id = qa.classroom_id
              join public.classrooms c on c.id = qa.classroom_id and not c.is_archived
              where qa.quiz_id = qid
                and qa.classroom_id is not null
                and cm.student_uid = public.current_uid()
                and cm.status = 'active'
            )
            or exists (
              select 1
              from public.quiz_assignments qa
              join public.profiles sp on sp.firebase_uid = public.current_uid()
              where qa.quiz_id = qid
                and qa.target_type = 'email'
                and lower(btrim(qa.target_value)) = lower(btrim(sp.email))
            )
            or exists (
              select 1
              from jsonb_array_elements_text(
                case
                  when jsonb_typeof(q.settings->'assignedEmails') = 'array' then q.settings->'assignedEmails'
                  else '[]'::jsonb
                end
              ) as ae(email)
              join public.profiles sp on sp.firebase_uid = public.current_uid()
              where lower(btrim(ae.email)) = lower(btrim(sp.email))
            )
          )
      )
    )
$$;

create or replace function public.can_read_quiz_questions(qid uuid)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid text := public.current_uid();
  v_quiz public.quizzes;
  v_opens_at timestamptz;
  v_scope text;
  v_in_assigned_emails boolean := false;
begin
  if public.owns_quiz(qid) or public.has_role(array['admin']) then
    return true;
  end if;

  if not public.has_active_quiz_access(qid) then
    return false;
  end if;

  select * into v_quiz from public.quizzes where id = qid;
  if not found then
    return false;
  end if;

  v_opens_at := private.safe_timestamptz(v_quiz.settings->>'opensAt');
  if v_opens_at is not null and now() < v_opens_at then
    return false;
  end if;

  v_scope := coalesce(nullif(btrim(coalesce(v_quiz.settings->>'publishScope', '')), ''), 'public');
  if v_scope = 'public' then
    return true;
  end if;

  select exists (
    select 1
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(v_quiz.settings->'assignedEmails') = 'array' then v_quiz.settings->'assignedEmails'
        else '[]'::jsonb
      end
    ) as ae(email)
    join public.profiles sp on sp.firebase_uid = v_uid
    where lower(btrim(ae.email)) = lower(btrim(sp.email))
  ) into v_in_assigned_emails;

  if v_in_assigned_emails then
    return true;
  end if;

  return exists (
    select 1
    from public.quiz_assignments qa
    left join public.classroom_members cm
      on cm.classroom_id = qa.classroom_id
     and cm.student_uid = v_uid
     and cm.status = 'active'
    left join public.classrooms c
      on c.id = qa.classroom_id
     and not c.is_archived
    left join public.profiles sp
      on sp.firebase_uid = v_uid
    where qa.quiz_id = qid
      and (
        (qa.classroom_id is not null and cm.id is not null and c.id is not null)
        or (qa.target_type = 'email' and sp.firebase_uid is not null and lower(btrim(qa.target_value)) = lower(btrim(sp.email)))
      )
      and (qa.available_from is null or now() >= qa.available_from)
  );
end
$$;

revoke execute on function
  public.has_active_quiz_access(uuid),
  public.can_read_quiz_questions(uuid)
  from public, anon;

grant execute on function
  public.has_active_quiz_access(uuid),
  public.can_read_quiz_questions(uuid)
  to authenticated;

-- Direct table lockdown: leave public.question_answer_keys SELECT grant intact for RLS [] tests
revoke all on public.quizzes, public.questions from public, anon, authenticated;

create or replace function public.owns_question(p_question_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.questions q
    where q.id = p_question_id
      and public.owns_quiz(q.quiz_id)
  )
$$;

revoke execute on function public.owns_question(uuid) from public, anon;
grant execute on function public.owns_question(uuid) to authenticated;

drop policy if exists quiz_read on public.quizzes;
create policy quiz_read on public.quizzes
  for select to authenticated
  using ((select public.owns_quiz(id)));

drop policy if exists question_read on public.questions;
create policy question_read on public.questions
  for select to authenticated
  using ((select public.can_read_quiz_questions(quiz_id)));

drop policy if exists answer_key_read on public.question_answer_keys;
create policy answer_key_read on public.question_answer_keys
  for select to authenticated
  using ((select public.owns_question(question_id)));

-- Gate questions in private.quiz_json on can_read_quiz_questions(q.id) while keeping metadata & assignedEmails redaction
create or replace function private.quiz_json(p_quiz_id uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
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
    'questions', case
      when not public.owns_quiz(q.id)
        and not public.has_role(array['admin'])
        and not public.can_read_quiz_questions(q.id)
      then '[]'::jsonb
      else (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', x.id,
          'order', x.ordinal,
          'content', x.content,
          'images', x.images,
          'type', x.type,
          'options', x.options,
          'points', x.points,
          'correctAnswers', case when public.owns_quiz(q.id) then k.correct_answers else '[]'::jsonb end,
          'explanation', case when public.owns_quiz(q.id) then k.explanation else null end
        ) order by x.ordinal), '[]'::jsonb)
        from public.questions x
        left join public.question_answer_keys k on k.question_id = x.id
        where x.quiz_id = q.id
      )
    end
  )
  from public.quizzes q
  join public.profiles p on p.firebase_uid = q.teacher_uid
  where q.id = p_quiz_id
$$;

-- Harden join_quiz_by_code with has_active_quiz_access + quiz & assignment open/close windows
create or replace function public.join_quiz_by_code(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid text := public.current_uid();
  v_quiz public.quizzes;
  v_scope text;
  v_q_opens_at timestamptz;
  v_q_closes_at timestamptz;
  v_in_assigned_emails boolean := false;
begin
  if v_uid is null then
    raise exception 'Chưa đăng nhập';
  end if;

  select * into v_quiz
  from public.quizzes
  where upper(code) = upper(btrim(coalesce(p_code, '')))
  limit 1;

  if not found then
    raise exception 'Không tìm thấy đề thi với mã phòng này';
  end if;

  if v_quiz.status <> 'published' and not public.owns_quiz(v_quiz.id) then
    raise exception 'Đề thi chưa mở hoặc đã đóng';
  end if;

  if not public.has_active_quiz_access(v_quiz.id) then
    raise exception 'Đề thi này chỉ dành cho lớp học hoặc học sinh được giao';
  end if;

  if not public.owns_quiz(v_quiz.id) and not public.has_role(array['admin']) then
    v_q_opens_at := private.safe_timestamptz(v_quiz.settings->>'opensAt');
    v_q_closes_at := private.safe_timestamptz(v_quiz.settings->>'closesAt');

    if v_q_opens_at is not null and now() < v_q_opens_at then
      raise exception 'Đề thi chưa đến thời gian mở';
    end if;

    v_scope := coalesce(nullif(btrim(coalesce(v_quiz.settings->>'publishScope', '')), ''), 'public');
    select exists (
      select 1
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(v_quiz.settings->'assignedEmails') = 'array' then v_quiz.settings->'assignedEmails'
          else '[]'::jsonb
        end
      ) as ae(email)
      join public.profiles sp on sp.firebase_uid = v_uid
      where lower(btrim(ae.email)) = lower(btrim(sp.email))
    ) into v_in_assigned_emails;

    if v_scope = 'public' or v_in_assigned_emails then
      if v_q_closes_at is not null and now() > v_q_closes_at then
        raise exception 'Đề thi đã hết thời gian mở';
      end if;
    else
      if not exists (
        select 1
        from public.quiz_assignments qa
        left join public.classroom_members cm
          on cm.classroom_id = qa.classroom_id
         and cm.student_uid = v_uid
         and cm.status = 'active'
        left join public.classrooms c
          on c.id = qa.classroom_id
         and not c.is_archived
        left join public.profiles sp
          on sp.firebase_uid = v_uid
        where qa.quiz_id = v_quiz.id
          and (
            (qa.classroom_id is not null and cm.id is not null and c.id is not null)
            or (qa.target_type = 'email' and sp.firebase_uid is not null and lower(btrim(qa.target_value)) = lower(btrim(sp.email)))
          )
          and (qa.available_from is null or now() >= qa.available_from)
      ) then
        raise exception 'Đề thi chưa đến thời gian mở';
      end if;

      if not exists (
        select 1
        from public.quiz_assignments qa
        left join public.classroom_members cm
          on cm.classroom_id = qa.classroom_id
         and cm.student_uid = v_uid
         and cm.status = 'active'
        left join public.classrooms c
          on c.id = qa.classroom_id
         and not c.is_archived
        left join public.profiles sp
          on sp.firebase_uid = v_uid
        where qa.quiz_id = v_quiz.id
          and (
            (qa.classroom_id is not null and cm.id is not null and c.id is not null)
            or (qa.target_type = 'email' and sp.firebase_uid is not null and lower(btrim(qa.target_value)) = lower(btrim(sp.email)))
          )
          and (qa.available_from is null or now() >= qa.available_from)
          and (coalesce(qa.hard_close_at, v_q_closes_at) is null or now() <= coalesce(qa.hard_close_at, v_q_closes_at))
      ) then
        raise exception 'Đề thi đã hết thời gian mở';
      end if;
    end if;
  end if;

  return private.quiz_json(v_quiz.id);
end
$$;

-- Harden start_attempt with has_active_quiz_access, opensAt floor, non-archived classrooms, and in-window assignment preference
create or replace function public.start_attempt(
  p_quiz_id uuid,
  p_class text default null,
  p_assignment_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid text := public.current_uid();
  q public.quizzes;
  a public.exam_attempts;
  qa public.quiz_assignments;
  v_has_qa boolean := false;
  v_q_opens_at timestamptz;
  v_q_closes_at timestamptz;
  v_opens_at timestamptz;
  v_closes_at timestamptz;
  v_ends_at timestamptz;
  duration integer;
  max_tries integer;
  ids uuid[];
  opts jsonb;
begin
  if not public.has_role(array['student']) then
    raise exception 'Chỉ học sinh được làm bài';
  end if;

  select * into q from public.quizzes where id = p_quiz_id for update;
  if not found then
    raise exception 'Không tìm thấy đề';
  end if;

  select * into a
  from public.exam_attempts
  where quiz_id = p_quiz_id
    and student_uid = v_uid
    and submitted_at is null;
  if found then
    return private.session_json(a);
  end if;

  if q.status <> 'published' then
    raise exception 'Đề chưa mở';
  end if;

  if not public.has_active_quiz_access(q.id) then
    raise exception 'Đề thi này chỉ dành cho lớp học hoặc học sinh được giao';
  end if;

  v_q_opens_at := private.safe_timestamptz(q.settings->>'opensAt');
  v_q_closes_at := private.safe_timestamptz(q.settings->>'closesAt');

  if v_q_opens_at is not null and now() < v_q_opens_at then
    raise exception 'Đề thi chưa đến thời gian mở';
  end if;

  if p_assignment_id is not null then
    select * into qa
    from public.quiz_assignments
    where id = p_assignment_id
      and quiz_id = p_quiz_id;
    if not found then
      raise exception 'Không tìm thấy bài giao cho đề thi này';
    end if;
    if qa.classroom_id is not null and not exists (
      select 1
      from public.classroom_members cm
      join public.classrooms c on c.id = cm.classroom_id and not c.is_archived
      where cm.classroom_id = qa.classroom_id
        and cm.student_uid = v_uid
        and cm.status = 'active'
    ) then
      raise exception 'Bạn không phải thành viên của lớp học được giao bài này';
    end if;
    v_has_qa := true;
  else
    select x.* into qa
    from public.quiz_assignments x
    join public.classroom_members cm on cm.classroom_id = x.classroom_id
    join public.classrooms c on c.id = x.classroom_id and not c.is_archived
    where x.quiz_id = p_quiz_id
      and x.classroom_id is not null
      and cm.student_uid = v_uid
      and cm.status = 'active'
    order by
      case
        when (x.available_from is null or now() >= x.available_from)
         and (coalesce(x.hard_close_at, v_q_closes_at) is null or now() <= coalesce(x.hard_close_at, v_q_closes_at))
        then 0
        else 1
      end asc,
      x.due_at asc nulls last,
      x.created_at desc
    limit 1;
    v_has_qa := found;
  end if;

  v_opens_at := case when v_has_qa then qa.available_from else null end;
  v_closes_at := coalesce(
    case when v_has_qa then qa.hard_close_at else null end,
    v_q_closes_at
  );

  if v_opens_at is not null and now() < v_opens_at then
    raise exception 'Đề thi chưa đến thời gian mở';
  end if;
  if v_closes_at is not null and now() > v_closes_at then
    raise exception 'Đề thi đã hết thời gian mở';
  end if;
  if v_has_qa and qa.late_policy = 'block_after_due' and qa.due_at is not null and now() > qa.due_at then
    raise exception 'Đã quá hạn nộp bài và giáo viên đã khóa nộp muộn';
  end if;

  max_tries := coalesce(
    case when v_has_qa then qa.max_attempts_override else null end,
    (q.settings->>'maxAttempts')::integer,
    0
  );
  if max_tries > 0 and (
    select count(*) from public.exam_attempts
    where quiz_id = q.id and student_uid = v_uid
  ) >= max_tries then
    raise exception 'Bạn đã hết lượt làm bài';
  end if;

  duration := coalesce((q.settings->>'durationMinutes')::integer, 0);
  v_ends_at := case when duration = 0 then null else now() + make_interval(mins => duration) end;
  if v_has_qa and qa.late_policy = 'block_after_due' and qa.due_at is not null then
    v_ends_at := least(coalesce(v_ends_at, qa.due_at), qa.due_at);
  end if;
  if v_closes_at is not null then
    v_ends_at := least(coalesce(v_ends_at, v_closes_at), v_closes_at);
  end if;

  select array_agg(id order by case when coalesce((q.settings->>'shuffleQuestions')::boolean, false) then random() else ordinal::float end)
  into ids
  from public.questions where quiz_id = q.id;

  select jsonb_object_agg(
    x.id,
    (select jsonb_agg(o->>'id' order by case when coalesce((q.settings->>'shuffleOptions')::boolean, false) then random() else z::float end)
     from jsonb_array_elements(x.options) with ordinality t(o, z))
  ) into opts
  from public.questions x where quiz_id = q.id;

  insert into public.exam_attempts(
    quiz_id, student_uid, student_name, student_class,
    assignment_id, classroom_id, due_at_snapshot,
    ends_at, duration_minutes, pass_percentage, allow_review, question_order, option_order
  ) values (
    q.id,
    v_uid,
    (select full_name from public.profiles where firebase_uid = v_uid),
    left(p_class, 100),
    case when v_has_qa then qa.id else null end,
    case when v_has_qa then qa.classroom_id else null end,
    case when v_has_qa then qa.due_at else null end,
    v_ends_at,
    duration,
    coalesce((q.settings->>'passPercentage')::numeric, 50),
    coalesce((q.settings->>'allowReview')::boolean, true),
    ids,
    opts
  ) returning * into a;

  return private.session_json(a);
end
$$;

-- Practice security helper + practice RPCs
create or replace function private.practice_ineligible_reason(
  p_quiz public.quizzes,
  p_uid text
) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_q_opens_at timestamptz;
  v_q_closes_at timestamptz;
  v_answer_vis text;
  v_has_matching_qa boolean := false;
  v_has_unclosed_qa boolean := false;
begin
  if p_quiz.status <> 'published' then
    return 'Đề chưa được xuất bản hoặc đã đóng';
  end if;

  if not public.has_active_quiz_access(p_quiz.id) then
    return 'Bạn không có quyền truy cập đề luyện tập này';
  end if;

  if p_quiz.settings->'practiceEnabled' = 'false'::jsonb then
    return 'Giáo viên đã tắt chức năng luyện tập cho đề này';
  end if;

  v_q_opens_at := private.safe_timestamptz(p_quiz.settings->>'opensAt');
  if (v_q_opens_at is not null and now() < v_q_opens_at)
     or not public.can_read_quiz_questions(p_quiz.id) then
    return 'Đề thi chưa đến thời gian mở';
  end if;

  v_answer_vis := coalesce(
    nullif(btrim(coalesce(p_quiz.settings->>'answerVisibility', '')), ''),
    case when coalesce((p_quiz.settings->>'allowReview')::boolean, true) then 'immediate' else 'never' end
  );

  if v_answer_vis not in ('immediate', 'after_close') then
    return 'Giáo viên đã tắt hiển thị đáp án nên không thể luyện tập đề này';
  end if;

  if v_answer_vis = 'after_close' then
    v_q_closes_at := private.safe_timestamptz(p_quiz.settings->>'closesAt');

    select exists (
      select 1
      from public.quiz_assignments qa
      left join public.classroom_members cm
        on cm.classroom_id = qa.classroom_id
       and cm.student_uid = p_uid
       and cm.status = 'active'
      left join public.classrooms c
        on c.id = qa.classroom_id
       and not c.is_archived
      left join public.profiles sp
        on sp.firebase_uid = p_uid
      where qa.quiz_id = p_quiz.id
        and (
          (qa.classroom_id is not null and cm.id is not null and c.id is not null)
          or (qa.target_type = 'email' and sp.firebase_uid is not null and lower(btrim(qa.target_value)) = lower(btrim(sp.email)))
        )
    ) into v_has_matching_qa;

    if v_has_matching_qa then
      select exists (
        select 1
        from public.quiz_assignments qa
        left join public.classroom_members cm
          on cm.classroom_id = qa.classroom_id
         and cm.student_uid = p_uid
         and cm.status = 'active'
        left join public.classrooms c
          on c.id = qa.classroom_id
         and not c.is_archived
        left join public.profiles sp
          on sp.firebase_uid = p_uid
        where qa.quiz_id = p_quiz.id
          and (
            (qa.classroom_id is not null and cm.id is not null and c.id is not null)
            or (qa.target_type = 'email' and sp.firebase_uid is not null and lower(btrim(qa.target_value)) = lower(btrim(sp.email)))
          )
          and (coalesce(qa.hard_close_at, v_q_closes_at) is null or now() < coalesce(qa.hard_close_at, v_q_closes_at))
      ) into v_has_unclosed_qa;

      if v_has_unclosed_qa then
        return 'Đề thi chỉ cho phép luyện tập sau khi đóng đề';
      end if;
    elsif v_q_closes_at is null or now() < v_q_closes_at then
      return 'Đề thi chỉ cho phép luyện tập sau khi đóng đề';
    end if;
  end if;

  return null;
end
$$;

create or replace function public.start_practice(
  p_quiz_id uuid,
  p_question_count integer default null,
  p_show_explanation boolean default true
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  q public.quizzes;
  s public.practice_sessions;
  v_reason text;
  total_count integer;
  take_count integer;
  ids uuid[];
  opts jsonb;
begin
  if not public.has_role(array['student']) then raise exception 'Chỉ học sinh được luyện tập'; end if;

  select * into q from public.quizzes where id = p_quiz_id for update;
  if not found then raise exception 'Không tìm thấy đề luyện tập'; end if;

  v_reason := private.practice_ineligible_reason(q, public.current_uid());
  if v_reason is not null then
    raise exception '%', v_reason;
  end if;

  select count(*)::integer into total_count from public.questions where quiz_id = q.id;
  if total_count = 0 then raise exception 'Đề chưa có câu hỏi để luyện tập'; end if;
  if p_question_count is not null and (p_question_count < 1 or p_question_count > total_count) then
    raise exception 'Số câu luyện tập phải từ 1 đến %', total_count;
  end if;
  take_count := coalesce(p_question_count, total_count);

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

create or replace function public.get_practice_session(p_session_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.practice_sessions;
  q public.quizzes;
  v_reason text;
  v_fail_msg text;
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

  select * into q from public.quizzes where id = s.quiz_id;
  if not found or q.status <> 'published' or q.updated_at is distinct from s.quiz_updated_at then
    update public.practice_sessions set status = 'invalidated', finished_at = now(), failure_message = message where id = s.id;
    return jsonb_build_object('id', s.id, 'status', 'invalidated', 'message', message);
  end if;

  v_reason := private.practice_ineligible_reason(q, public.current_uid());
  if v_reason is not null then
    v_fail_msg := coalesce(v_reason, message);
    update public.practice_sessions set status = 'invalidated', finished_at = now(), failure_message = v_fail_msg where id = s.id;
    return jsonb_build_object('id', s.id, 'status', 'invalidated', 'message', v_fail_msg);
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

create or replace function public.check_practice_answer(
  p_session_id uuid,
  p_question_id uuid,
  p_selected_answers jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.practice_sessions;
  q public.quizzes;
  v_reason text;
  v_fail_msg text;
  v_type text;
  v_options jsonb;
  v_correct jsonb;
  v_explanation text;
  v_is_correct boolean;
  existing public.practice_answers;
  message text := 'Đề đã bị giáo viên đóng, xóa hoặc chỉnh sửa trong lúc luyện tập. Lượt này không thể tiếp tục; hãy quay lại mục Luyện tập.';
  option_id text;
begin
  if not public.has_role(array['student']) then raise exception 'Chỉ học sinh được kiểm tra câu luyện tập'; end if;
  select * into s from public.practice_sessions where id = p_session_id and student_uid = public.current_uid() for update;
  if not found then raise exception 'Không tìm thấy lượt luyện tập hoặc bạn không có quyền truy cập'; end if;
  if s.status = 'invalidated' then return jsonb_build_object('status', s.status, 'message', coalesce(s.failure_message, message)); end if;
  if s.status <> 'in_progress' then raise exception 'Lượt luyện tập đã kết thúc'; end if;

  select * into q from public.quizzes where id = s.quiz_id;
  if not found or q.status <> 'published' or q.updated_at is distinct from s.quiz_updated_at then
    update public.practice_sessions set status = 'invalidated', finished_at = now(), failure_message = message where id = s.id;
    return jsonb_build_object('status', 'invalidated', 'message', message);
  end if;

  v_reason := private.practice_ineligible_reason(q, public.current_uid());
  if v_reason is not null then
    v_fail_msg := coalesce(v_reason, message);
    update public.practice_sessions set status = 'invalidated', finished_at = now(), failure_message = v_fail_msg where id = s.id;
    return jsonb_build_object('status', 'invalidated', 'message', v_fail_msg);
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

  -- Preserve 5-option (A-E) limit from 20261118050412
  if jsonb_typeof(p_selected_answers) is distinct from 'array'
    or jsonb_array_length(p_selected_answers) not between 1 and 5 then
    raise exception 'Vui lòng chọn ít nhất một đáp án hợp lệ';
  end if;
  if (select count(distinct value) from jsonb_array_elements_text(p_selected_answers) as selected(value)) <> jsonb_array_length(p_selected_answers) then
    raise exception 'Đáp án được chọn bị trùng';
  end if;

  select qn.type, qn.options into v_type, v_options
  from public.questions qn where qn.id = p_question_id and qn.quiz_id = s.quiz_id;
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

create or replace function public.finish_practice(p_session_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.practice_sessions;
  qz public.quizzes;
  v_reason text;
  v_fail_msg text;
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

  select * into qz from public.quizzes where id = s.quiz_id;
  if not found or qz.status <> 'published' or qz.updated_at is distinct from s.quiz_updated_at then
    update public.practice_sessions set status = 'invalidated', finished_at = now(), failure_message = message where id = s.id;
    return jsonb_build_object('status', 'invalidated', 'message', message);
  end if;

  v_reason := private.practice_ineligible_reason(qz, public.current_uid());
  if v_reason is not null then
    v_fail_msg := coalesce(v_reason, message);
    update public.practice_sessions set status = 'invalidated', finished_at = now(), failure_message = v_fail_msg where id = s.id;
    return jsonb_build_object('status', 'invalidated', 'message', v_fail_msg);
  end if;

  total_count := cardinality(s.question_order);
  select count(*)::integer, count(*) filter(where is_correct)::integer into answered_count, correct_count
    from public.practice_answers where session_id = s.id;

  -- Preserve 'images', q.images from 202611170001
  select coalesce(jsonb_agg(jsonb_build_object(
    'questionId', q.id, 'order', requested.position, 'content', q.content, 'images', q.images, 'type', q.type, 'options', q.options,
    'optionOrder', s.option_order->q.id::text, 'selectedAnswers', coalesce(a.selected_answers, '[]'::jsonb),
    'correctAnswers', coalesce(a.correct_answers, '[]'::jsonb), 'isCorrect', coalesce(a.is_correct, false),
    'checked', a.question_id is not null, 'explanation', coalesce(a.explanation, '')
  ) order by requested.position), '[]'::jsonb) into details
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
    'totalQuestions', total_count, 'answeredCount', answered_count, 'correctCount', correct_count,
    'incorrectCount', answered_count - correct_count, 'skippedCount', total_count - answered_count,
    'percentage', pct, 'durationSeconds', duration_seconds, 'details', details);
  update public.practice_sessions set status = 'completed', finished_at = (result_payload->>'finishedAt')::timestamptz, result = result_payload where id = s.id;
  return result_payload;
end
$$;

-- Enforce hard_close_at / closesAt cutoff (+60s grace) in submit_attempt, finalize_exam_attempt, and finalize_expired
create or replace function public.submit_attempt(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.exam_attempts;
  q public.quizzes;
  qa public.quiz_assignments;
  r public.exam_results;
  v_hard_close timestamptz := null;
  v_effective_close timestamptz := null;
begin
  select * into a from public.exam_attempts
  where id = p_id and student_uid = public.current_uid() for update;
  if not found or not public.has_role(array['student']) then
    raise exception 'Không có quyền';
  end if;

  select * into q from public.quizzes where id = a.quiz_id;

  if a.assignment_id is not null then
    select * into qa from public.quiz_assignments where id = a.assignment_id;
    if found then
      v_hard_close := qa.hard_close_at;
    end if;
  end if;

  v_effective_close := coalesce(
    v_hard_close,
    private.safe_timestamptz(q.settings->>'closesAt')
  );

  if a.submitted_at is null then
    if a.assignment_id is not null and qa.id is not null and qa.late_policy = 'block_after_due' and a.due_at_snapshot is not null and now() > a.due_at_snapshot + interval '60 seconds' then
      raise exception 'Đã quá hạn nộp bài và giáo viên đã khóa nộp muộn';
    end if;
    if v_effective_close is not null and now() > v_effective_close + interval '60 seconds' then
      raise exception 'Đề thi đã hết thời gian mở, không thể nộp bài';
    end if;
  end if;

  perform private.finalize_attempt(p_id);
  select * into r from public.exam_results where attempt_id = p_id;

  return private.redact_result_for_caller(
    r.payload || jsonb_build_object('id', r.id),
    q.settings,
    a.allow_review,
    v_hard_close,
    a.quiz_id
  );
end
$$;

create or replace function public.finalize_exam_attempt(
  p_attempt_id uuid,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.exam_attempts;
  q public.quizzes;
  qa public.quiz_assignments;
  r public.exam_results;
  cached jsonb;
  already_submitted boolean;
  filtered_result jsonb;
  response jsonb;
  v_hard_close timestamptz := null;
  v_effective_close timestamptz := null;
begin
  if public.current_uid() is null then raise exception 'Chưa đăng nhập'; end if;

  if p_idempotency_key is not null and length(btrim(p_idempotency_key)) > 0 then
    select k.response into cached
    from public.idempotency_keys k
    where k.scope = 'finalize_exam'
      and k.actor_uid = public.current_uid()
      and k.idempotency_key = p_idempotency_key;
    if found then
      return cached;
    end if;
  end if;

  select * into a from public.exam_attempts
  where id = p_attempt_id and student_uid = public.current_uid() for update;
  if not found or not public.has_role(array['student']) then
    raise exception 'Không có quyền';
  end if;

  select * into q from public.quizzes where id = a.quiz_id;

  if a.assignment_id is not null then
    select * into qa from public.quiz_assignments where id = a.assignment_id;
    if found then
      v_hard_close := qa.hard_close_at;
    end if;
  end if;

  v_effective_close := coalesce(
    v_hard_close,
    private.safe_timestamptz(q.settings->>'closesAt')
  );

  already_submitted := a.submitted_at is not null;
  if not already_submitted then
    if a.assignment_id is not null and qa.id is not null and qa.late_policy = 'block_after_due' and a.due_at_snapshot is not null and now() > a.due_at_snapshot + interval '60 seconds' then
      raise exception 'Đã quá hạn nộp bài và giáo viên đã khóa nộp muộn';
    end if;
    if v_effective_close is not null and now() > v_effective_close + interval '60 seconds' then
      raise exception 'Đề thi đã hết thời gian mở, không thể nộp bài';
    end if;
    perform private.finalize_attempt(p_attempt_id);
  end if;

  select * into r from public.exam_results where attempt_id = p_attempt_id;

  filtered_result := private.redact_result_for_caller(
    r.payload || jsonb_build_object('id', r.id),
    q.settings,
    a.allow_review,
    v_hard_close,
    a.quiz_id
  );

  response := jsonb_build_object(
    'score', case when (filtered_result->>'score') is null then null else (filtered_result->>'score')::numeric end,
    'status', case when already_submitted then 'already_submitted' else 'submitted' end,
    'result', filtered_result
  );

  if p_idempotency_key is not null and length(btrim(p_idempotency_key)) > 0 then
    insert into public.idempotency_keys(scope, actor_uid, idempotency_key, response)
    values ('finalize_exam', public.current_uid(), p_idempotency_key, response)
    on conflict (scope, actor_uid, idempotency_key) do nothing;
  end if;

  return response;
end
$$;

create or replace function public.finalize_expired() returns void
language plpgsql security definer set search_path = '' as $$
declare
  a record;
begin
  for a in
    select ea.id
    from public.exam_attempts ea
    join public.quizzes q on q.id = ea.quiz_id
    left join public.quiz_assignments qa on qa.id = ea.assignment_id
    where ea.ends_at <= now()
      and ea.submitted_at is null
      and (ea.student_uid = public.current_uid() or public.owns_quiz(ea.quiz_id))
      and not (
        qa.id is not null
        and qa.late_policy = 'block_after_due'
        and ea.due_at_snapshot is not null
        and now() > ea.due_at_snapshot + interval '60 seconds'
      )
      and not (
        coalesce(qa.hard_close_at, private.safe_timestamptz(q.settings->>'closesAt')) is not null
        and now() > coalesce(qa.hard_close_at, private.safe_timestamptz(q.settings->>'closesAt')) + interval '60 seconds'
      )
  loop
    perform private.finalize_attempt(a.id);
  end loop;
end
$$;

-- Reject availableFrom > hardCloseAt when dueAt is null in assign_quiz_to_classrooms
create or replace function public.assign_quiz_to_classrooms(
  p_quiz_id uuid,
  p_assignments jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_quiz public.quizzes;
  v_item jsonb;
  v_classroom_id uuid;
  v_cls public.classrooms;
  v_title text;
  v_instructions text;
  v_available_from timestamptz;
  v_due_at timestamptz;
  v_late_policy text;
  v_hard_close_at timestamptz;
  v_max_override integer;
  v_saved public.quiz_assignments;
  v_member record;
  v_results jsonb := '[]'::jsonb;
begin
  if p_quiz_id is null or not public.owns_quiz(p_quiz_id) then
    raise exception 'Không có quyền giao đề cho lớp học';
  end if;

  select * into v_quiz from public.quizzes where id = p_quiz_id;
  if not found then
    raise exception 'Không tìm thấy đề thi';
  end if;

  if jsonb_typeof(p_assignments) is distinct from 'array' or jsonb_array_length(p_assignments) not between 1 and 100 then
    raise exception 'Danh sách lớp giao bài không hợp lệ';
  end if;

  for v_item in select value from jsonb_array_elements(p_assignments) loop
    v_classroom_id := (v_item->>'classroomId')::uuid;
    select * into v_cls from public.classrooms where id = v_classroom_id;
    if not found then
      raise exception 'Không tìm thấy lớp học';
    end if;
    if not (public.has_role(array['admin']) or (public.has_role(array['teacher']) and v_cls.teacher_uid = public.current_uid())) then
      raise exception 'Bạn không sở hữu lớp học "%"', v_cls.name;
    end if;

    v_title := nullif(left(btrim(coalesce(v_item->>'title', '')), 200), '');
    v_instructions := left(btrim(coalesce(v_item->>'instructions', '')), 4000);
    v_available_from := nullif(btrim(coalesce(v_item->>'availableFrom', '')), '')::timestamptz;
    v_due_at := nullif(btrim(coalesce(v_item->>'dueAt', '')), '')::timestamptz;
    v_late_policy := coalesce(nullif(btrim(coalesce(v_item->>'latePolicy', '')), ''), 'allow_late');
    v_hard_close_at := nullif(btrim(coalesce(v_item->>'hardCloseAt', '')), '')::timestamptz;
    v_max_override := case
      when v_item ? 'maxAttemptsOverride' and v_item->>'maxAttemptsOverride' is not null and btrim(v_item->>'maxAttemptsOverride') <> ''
        then (v_item->>'maxAttemptsOverride')::integer
      else null
    end;

    if v_late_policy not in ('block_after_due', 'allow_late') then
      raise exception 'Chính sách nộp muộn không hợp lệ';
    end if;
    if v_available_from is not null and v_due_at is not null and v_due_at < v_available_from then
      raise exception 'Hạn nộp phải sau hoặc bằng thời gian mở bài';
    end if;
    if v_due_at is not null and v_hard_close_at is not null and v_hard_close_at < v_due_at then
      raise exception 'Thời gian đóng hẳn phải sau hoặc bằng hạn nộp';
    end if;
    if v_available_from is not null and v_hard_close_at is not null and v_hard_close_at < v_available_from then
      raise exception 'Thời gian đóng hẳn phải sau hoặc bằng thời gian mở bài';
    end if;
    if v_max_override is not null and (v_max_override < 0 or v_max_override > 100) then
      raise exception 'Số lần làm bài tối đa không hợp lệ';
    end if;

    insert into public.quiz_assignments(
      quiz_id, target_type, target_value, classroom_id, assigned_by, title, instructions,
      available_from, due_at, late_policy, hard_close_at, max_attempts_override, updated_at
    ) values (
      p_quiz_id, 'class', v_classroom_id::text, v_classroom_id, public.current_uid(), v_title, v_instructions,
      v_available_from, v_due_at, v_late_policy, v_hard_close_at, v_max_override, now()
    )
    on conflict (quiz_id, target_type, target_value) do update
    set classroom_id = excluded.classroom_id,
        assigned_by = excluded.assigned_by,
        title = excluded.title,
        instructions = excluded.instructions,
        available_from = excluded.available_from,
        due_at = excluded.due_at,
        late_policy = excluded.late_policy,
        hard_close_at = excluded.hard_close_at,
        max_attempts_override = excluded.max_attempts_override,
        updated_at = now()
    returning * into v_saved;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'id', v_saved.id,
      'classroomId', v_saved.classroom_id,
      'classroomName', v_cls.name,
      'quizId', v_saved.quiz_id,
      'quizTitle', v_quiz.title,
      'quizCode', v_quiz.code,
      'assignedBy', v_saved.assigned_by,
      'title', v_saved.title,
      'instructions', v_saved.instructions,
      'availableFrom', v_saved.available_from,
      'dueAt', v_saved.due_at,
      'latePolicy', v_saved.late_policy,
      'hardCloseAt', v_saved.hard_close_at,
      'maxAttemptsOverride', v_saved.max_attempts_override,
      'createdAt', v_saved.created_at
    ));

    for v_member in
      select cm.student_uid
      from public.classroom_members cm
      where cm.classroom_id = v_classroom_id
        and cm.status = 'active'
        and cm.student_uid is not null
    loop
      perform private.emit_in_app_notification(
        v_member.student_uid,
        public.current_uid(),
        'quiz_assigned',
        'Bạn có bài tập mới',
        format('Lớp "%s" vừa được giao đề "%s".', v_cls.name, coalesce(v_title, v_quiz.title)),
        '/student/classes/' || v_classroom_id::text,
        jsonb_build_object('classroomId', v_classroom_id, 'quizId', p_quiz_id, 'assignmentId', v_saved.id)
      );
    end loop;
  end loop;

  return v_results;
end
$$;

-- Safe timestamp handling in update_quiz_publish_settings
create or replace function public.update_quiz_publish_settings(
  p_quiz_id uuid,
  p_settings jsonb,
  p_status text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_quiz public.quizzes;
  v_merged jsonb;
  v_scope text;
  v_score_vis text;
  v_answer_vis text;
  v_opens_at timestamptz;
  v_closes_at timestamptz;
  v_duration integer;
  v_max_attempts integer;
  v_pass_pct numeric;
begin
  if p_quiz_id is null or not public.owns_quiz(p_quiz_id) then
    raise exception 'Không có quyền cập nhật cấu hình phát hành đề';
  end if;

  select * into v_quiz from public.quizzes where id = p_quiz_id for update;
  if not found then
    raise exception 'Không tìm thấy đề thi';
  end if;

  if p_status is not null and p_status not in ('draft', 'published', 'closed') then
    raise exception 'Trạng thái đề thi không hợp lệ';
  end if;

  if jsonb_typeof(coalesce(p_settings, '{}'::jsonb)) <> 'object' then
    raise exception 'Cấu hình đề không hợp lệ';
  end if;

  v_merged := coalesce(v_quiz.settings, '{}'::jsonb) || coalesce(p_settings, '{}'::jsonb);
  v_duration := coalesce((v_merged->>'durationMinutes')::integer, 0);
  v_max_attempts := coalesce((v_merged->>'maxAttempts')::integer, 0);
  v_pass_pct := coalesce((v_merged->>'passPercentage')::numeric, 50);

  if v_duration not between 0 and 1440 or v_max_attempts not between 0 and 100 or v_pass_pct not between 0 and 100 then
    raise exception 'Cấu hình thời gian, số lượt hoặc điểm đạt không hợp lệ';
  end if;

  v_scope := coalesce(nullif(btrim(coalesce(v_merged->>'publishScope', '')), ''), 'public');
  if v_scope not in ('public', 'class_only') then
    raise exception 'Phạm vi phát hành không hợp lệ';
  end if;

  v_score_vis := coalesce(nullif(btrim(coalesce(v_merged->>'scoreVisibility', '')), ''), 'immediate');
  if v_score_vis not in ('immediate', 'after_close', 'never') then
    raise exception 'Cấu hình hiển thị điểm không hợp lệ';
  end if;

  v_answer_vis := coalesce(
    nullif(btrim(coalesce(v_merged->>'answerVisibility', '')), ''),
    case when coalesce((v_merged->>'allowReview')::boolean, true) then 'immediate' else 'never' end
  );
  if v_answer_vis not in ('immediate', 'after_close', 'never') then
    raise exception 'Cấu hình hiển thị đáp án không hợp lệ';
  end if;

  if (v_merged ? 'opensAt' and jsonb_typeof(v_merged->'opensAt') not in ('null', 'string'))
     or (v_merged ? 'closesAt' and jsonb_typeof(v_merged->'closesAt') not in ('null', 'string')) then
    raise exception 'Thời gian mở hoặc đóng đề không hợp lệ';
  end if;

  begin
    v_opens_at := nullif(btrim(coalesce(v_merged->>'opensAt', '')), '')::timestamptz;
    v_closes_at := nullif(btrim(coalesce(v_merged->>'closesAt', '')), '')::timestamptz;
  exception when others then
    raise exception 'Thời gian mở hoặc đóng đề không hợp lệ';
  end;

  if v_opens_at is not null and v_closes_at is not null and v_closes_at <= v_opens_at then
    raise exception 'Thời gian đóng đề phải sau thời gian mở đề';
  end if;

  v_merged := v_merged || jsonb_build_object(
    'publishScope', v_scope,
    'opensAt', v_opens_at,
    'closesAt', v_closes_at,
    'scoreVisibility', v_score_vis,
    'answerVisibility', v_answer_vis,
    'allowReview', (v_answer_vis <> 'never')
  );

  update public.quizzes
  set settings = v_merged,
      status = coalesce(p_status, status),
      updated_at = now()
  where id = p_quiz_id;

  return private.quiz_json(p_quiz_id);
end
$$;

-- Validate & normalize Azota settings in save_quiz while preserving 202611170001 media & 20261118050412 A-E checks
create or replace function public.save_quiz(p_data jsonb, p_id uuid default null, p_legacy_id text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  qid uuid; item jsonb; opt jsonb; qkey uuid; n integer := 0; st jsonb := p_data->'settings';
  image_value text; media_length integer;
  v_scope text; v_score_vis text; v_answer_vis text;
  v_opens_at timestamptz; v_closes_at timestamptz;
begin
  if not public.has_role(array['teacher','admin']) then raise exception 'Chỉ giáo viên được tạo đề'; end if;
  if p_id is not null and not public.owns_quiz(p_id) then raise exception 'Không có quyền sửa đề'; end if;
  if jsonb_typeof(p_data->'questions') is distinct from 'array' or jsonb_array_length(p_data->'questions') not between 1 and 500 then raise exception 'Đề phải có 1-500 câu'; end if;
  if st is null or jsonb_typeof(st) is distinct from 'object'
    or (st->>'durationMinutes')::integer is null or (st->>'maxAttempts')::integer is null or (st->>'passPercentage')::numeric is null
    or (st->>'durationMinutes')::integer not between 0 and 1440 or (st->>'maxAttempts')::integer not between 0 and 100
    or (st->>'passPercentage')::numeric not between 0 and 100 then raise exception 'Cấu hình đề không hợp lệ'; end if;

  v_scope := coalesce(nullif(btrim(coalesce(st->>'publishScope', '')), ''), 'public');
  if v_scope not in ('public', 'class_only') then
    raise exception 'Phạm vi phát hành không hợp lệ';
  end if;

  v_score_vis := coalesce(nullif(btrim(coalesce(st->>'scoreVisibility', '')), ''), 'immediate');
  if v_score_vis not in ('immediate', 'after_close', 'never') then
    raise exception 'Cấu hình hiển thị điểm không hợp lệ';
  end if;

  v_answer_vis := coalesce(
    nullif(btrim(coalesce(st->>'answerVisibility', '')), ''),
    case when coalesce((st->>'allowReview')::boolean, true) then 'immediate' else 'never' end
  );
  if v_answer_vis not in ('immediate', 'after_close', 'never') then
    raise exception 'Cấu hình hiển thị đáp án không hợp lệ';
  end if;

  if (st ? 'opensAt' and jsonb_typeof(st->'opensAt') not in ('null', 'string'))
     or (st ? 'closesAt' and jsonb_typeof(st->'closesAt') not in ('null', 'string')) then
    raise exception 'Thời gian mở hoặc đóng đề không hợp lệ';
  end if;

  begin
    v_opens_at := nullif(btrim(coalesce(st->>'opensAt', '')), '')::timestamptz;
    v_closes_at := nullif(btrim(coalesce(st->>'closesAt', '')), '')::timestamptz;
  exception when others then
    raise exception 'Thời gian mở hoặc đóng đề không hợp lệ';
  end;

  if v_opens_at is not null and v_closes_at is not null and v_closes_at <= v_opens_at then
    raise exception 'Thời gian đóng đề phải sau thời gian mở đề';
  end if;

  st := st || jsonb_build_object(
    'publishScope', v_scope,
    'opensAt', v_opens_at,
    'closesAt', v_closes_at,
    'scoreVisibility', v_score_vis,
    'answerVisibility', v_answer_vis,
    'allowReview', (v_answer_vis <> 'never')
  );

  if p_legacy_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(public.current_uid() || p_legacy_id, 0));
    select id into qid from public.quizzes where teacher_uid = public.current_uid() and legacy_id = p_legacy_id;
    if found then return qid; end if;
  end if;
  if p_id is not null then
    perform 1 from public.quizzes where id = p_id for update;
    if exists(select 1 from public.exam_attempts where quiz_id = p_id) then raise exception 'Đề đã có lượt làm: hãy nhân bản để chỉnh sửa nội dung'; end if;
    update public.quizzes set title=trim(p_data->>'title'),subject=trim(p_data->>'subject'),description=coalesce(p_data->>'description',''),
      settings=st,status=p_data->>'status',updated_at=now() where id=p_id;
    qid := p_id;
    delete from public.questions where quiz_id = qid;
  else
    insert into public.quizzes(teacher_uid,title,subject,description,status,settings,legacy_id)
      values(public.current_uid(),trim(p_data->>'title'),trim(p_data->>'subject'),coalesce(p_data->>'description',''),coalesce(p_data->>'status','draft'),st,p_legacy_id)
      returning id into qid;
  end if;

  for item in select value from jsonb_array_elements(p_data->'questions') loop
    n := n + 1;
    if length(trim(coalesce(item->>'content',''))) = 0 or jsonb_typeof(item->'options') is distinct from 'array'
      or jsonb_array_length(item->'options') not between 2 and 5 or jsonb_typeof(item->'correctAnswers') is distinct from 'array'
      or jsonb_array_length(item->'correctAnswers') not between 1 and 5 then raise exception 'Câu hỏi hoặc đáp án không hợp lệ'; end if;
    if item ? 'images' and jsonb_typeof(item->'images') is distinct from 'array' then raise exception 'Ảnh câu hỏi không hợp lệ'; end if;
    if jsonb_array_length(coalesce(item->'images','[]'::jsonb)) > 8 then raise exception 'Mỗi câu chỉ được có tối đa 8 ảnh'; end if;
    media_length := 0;
    for image_value in select value from jsonb_array_elements_text(coalesce(item->'images','[]'::jsonb)) as images(value) loop
      if image_value not like 'storage://qizzone-question-media/%' or length(image_value) > 512 or position('..' in image_value) > 0 then raise exception 'Ảnh câu hỏi phải được lưu trong kho hình đề thi'; end if;
      media_length := media_length + length(image_value);
    end loop;
    if media_length > 4000000 then raise exception 'Tổng ảnh trong câu hỏi vượt quá 4 MB'; end if;
    if (select count(distinct v->>'id') from jsonb_array_elements(item->'options') v) <> jsonb_array_length(item->'options') then raise exception 'Phương án bị trùng'; end if;
    for opt in select value from jsonb_array_elements(item->'options') loop
      if coalesce(opt->>'id','') not in ('A','B','C','D','E') or length(trim(coalesce(opt->>'content',''))) = 0 then raise exception 'Phương án không hợp lệ'; end if;
      if opt ? 'images' and jsonb_typeof(opt->'images') is distinct from 'array' then raise exception 'Ảnh phương án không hợp lệ'; end if;
      if jsonb_array_length(coalesce(opt->'images','[]'::jsonb)) > 8 then raise exception 'Mỗi phương án chỉ được có tối đa 8 ảnh'; end if;
      for image_value in select value from jsonb_array_elements_text(coalesce(opt->'images','[]'::jsonb)) as images(value) loop
        if image_value not like 'storage://qizzone-question-media/%' or length(image_value) > 512 or position('..' in image_value) > 0 then raise exception 'Ảnh phương án phải được lưu trong kho hình đề thi'; end if;
        media_length := media_length + length(image_value);
      end loop;
      if media_length > 4000000 then raise exception 'Tổng ảnh trong câu hỏi vượt quá 4 MB'; end if;
    end loop;
    if exists(select 1 from jsonb_array_elements_text(item->'correctAnswers') v where not exists(select 1 from jsonb_array_elements(item->'options') o where o->>'id'=v))
      or (item->>'type' <> 'multiple_choice' and jsonb_array_length(item->'correctAnswers') <> 1) then raise exception 'Đáp án không khớp phương án'; end if;
    insert into public.questions(quiz_id,ordinal,content,images,type,options,points,legacy_id)
      values(qid,n,item->>'content',coalesce(item->'images','[]'::jsonb),item->>'type',item->'options',(item->>'points')::numeric,item->>'id')
      returning id into qkey;
    insert into public.question_answer_keys(question_id,correct_answers,explanation)
      values(qkey,item->'correctAnswers',coalesce(item->>'explanation',''));
  end loop;
  if p_legacy_id is not null then
    insert into public.data_migrations(firebase_uid,source_id,status,report)
      values(public.current_uid(),p_legacy_id,'completed',jsonb_build_object('quizId',qid)) on conflict do nothing;
  end if;
  return qid;
end
$$;

revoke execute on function
  private.safe_timestamptz(text),
  private.practice_ineligible_reason(public.quizzes, text)
  from public, anon, authenticated;
