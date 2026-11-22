-- M1 Iteration 2 Fix: Public RLS Helpers (resolve 42501), Azota opensAt/closesAt enforcement & question redaction,
-- student assignment overdue status precedence, and collision-free classroom re-join after email change.
-- 100% PGlite-compatible.

-- 1. Move classroom RLS helpers to public schema (matching public.owns_quiz / public.can_read_quiz)
--    so RLS evaluation under role `authenticated` succeeds while schema `private` stays locked down.
create or replace function public.is_classroom_teacher(p_classroom_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.current_uid() is not null
    and exists (
      select 1 from public.classrooms c
      where c.id = p_classroom_id
        and c.teacher_uid = public.current_uid()
    )
$$;

create or replace function public.is_classroom_member(p_classroom_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.current_uid() is not null
    and exists (
      select 1 from public.classroom_members cm
      where cm.classroom_id = p_classroom_id
        and cm.student_uid = public.current_uid()
        and cm.status = 'active'
    )
$$;

revoke execute on function
  public.is_classroom_teacher(uuid),
  public.is_classroom_member(uuid)
  from public, anon;

grant execute on function
  public.is_classroom_teacher(uuid),
  public.is_classroom_member(uuid)
  to authenticated;

drop policy if exists classrooms_select on public.classrooms;
create policy classrooms_select on public.classrooms
  for select to authenticated
  using (
    teacher_uid = (select public.current_uid())
    or (select public.has_role(array['admin']))
    or (select public.is_classroom_member(id))
  );

drop policy if exists classroom_members_select on public.classroom_members;
create policy classroom_members_select on public.classroom_members
  for select to authenticated
  using (
    student_uid = (select public.current_uid())
    or (select public.has_role(array['admin']))
    or (select public.is_classroom_teacher(classroom_id))
  );

drop policy if exists quiz_assignments_select on public.quiz_assignments;
create policy quiz_assignments_select on public.quiz_assignments
  for select to authenticated
  using (
    (select public.owns_quiz(quiz_id))
    or (classroom_id is not null and (select public.is_classroom_member(classroom_id)))
    or (
      target_type = 'email'
      and lower(btrim(target_value)) = lower(btrim((
        select p.email from public.profiles p
        where p.firebase_uid = (select public.current_uid())
      )))
    )
  );

drop function if exists private.is_classroom_teacher(uuid);
drop function if exists private.is_classroom_member(uuid);

-- 2. Redact questions in private.quiz_json before opensAt for non-owners while keeping metadata visible
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
        and nullif(btrim(coalesce(q.settings->>'opensAt', '')), '') is not null
        and now() < nullif(btrim(coalesce(q.settings->>'opensAt', '')), '')::timestamptz
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

-- 3. Enforce opensAt / closesAt in join_quiz_by_code for non-owners
create or replace function public.join_quiz_by_code(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_quiz public.quizzes;
  v_opens_at timestamptz;
  v_closes_at timestamptz;
begin
  if public.current_uid() is null then
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

  if not public.can_read_quiz(v_quiz.id) then
    raise exception 'Đề thi này chỉ dành cho lớp học hoặc học sinh được giao';
  end if;

  if not public.owns_quiz(v_quiz.id) and not public.has_role(array['admin']) then
    v_opens_at := nullif(btrim(coalesce(v_quiz.settings->>'opensAt', '')), '')::timestamptz;
    v_closes_at := nullif(btrim(coalesce(v_quiz.settings->>'closesAt', '')), '')::timestamptz;

    if v_opens_at is not null and now() < v_opens_at then
      raise exception 'Đề thi chưa đến thời gian mở';
    end if;
    if v_closes_at is not null and now() > v_closes_at then
      raise exception 'Đề thi đã hết thời gian mở';
    end if;
  end if;

  return private.quiz_json(v_quiz.id);
end
$$;

-- 4. Fix overdue check precedence in list_student_assignments: due_at takes precedence over hard_close_at
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
    'hardCloseAt', qa.hard_close_at,
    'maxAttempts', coalesce(qa.max_attempts_override, (q.settings->>'maxAttempts')::integer, 0),
    'attemptCount', coalesce(att.total_count, 0),
    'hasActiveAttempt', coalesce(att.active_count, 0) > 0,
    'status', case
      when coalesce(att.submitted_count, 0) > 0 then 'completed'
      when coalesce(qa.due_at, qa.hard_close_at) is not null and now() > coalesce(qa.due_at, qa.hard_close_at) then 'overdue'
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
  join public.quizzes q on q.id = qa.quiz_id and q.status = 'published'
  left join lateral (
    select
      count(*)::integer as total_count,
      count(*) filter (where a.submitted_at is null)::integer as active_count,
      count(*) filter (where a.submitted_at is not null)::integer as submitted_count
    from public.exam_attempts a
    where a.student_uid = v_uid
      and a.quiz_id = q.id
      and (a.assignment_id = qa.id or a.assignment_id is null)
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
      and (a.assignment_id = qa.id or a.assignment_id is null)
  ) latest_res on true
  where cm.student_uid = v_uid
    and cm.status = 'active'
    and (p_classroom_id is null or c.id = p_classroom_id);

  return v_items;
end
$$;

-- 5. Safely handle re-joining classroom after removal and email change without unique index collisions
create or replace function public.join_classroom_by_code(
  p_code text,
  p_via text default 'code'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid text := public.current_uid();
  v_via text := coalesce(nullif(btrim(p_via), ''), 'code');
  v_cls public.classrooms;
  v_profile public.profiles;
  v_email text;
  v_target_id uuid;
begin
  if not public.has_role(array['student']) then
    raise exception 'Chỉ tài khoản ở chế độ học sinh mới có thể tham gia lớp học';
  end if;
  if v_via not in ('code', 'link') then
    raise exception 'Phương thức tham gia lớp không hợp lệ';
  end if;

  select * into v_cls
  from public.classrooms
  where upper(invite_code) = upper(btrim(coalesce(p_code, '')))
  for update;

  if not found then
    raise exception 'Không tìm thấy lớp học với mã mời này';
  end if;
  if v_cls.is_archived then
    raise exception 'Lớp học này đã được lưu trữ';
  end if;
  if not v_cls.invite_enabled then
    raise exception 'Giáo viên đã tạm tắt lời mời tham gia lớp học này';
  end if;

  select * into v_profile from public.profiles where firebase_uid = v_uid;
  if not found then
    raise exception 'Không tìm thấy hồ sơ học sinh';
  end if;

  v_email := lower(btrim(v_profile.email));

  if exists (
    select 1 from public.classroom_members cm
    where cm.classroom_id = v_cls.id
      and cm.student_uid = v_uid
      and cm.status = 'active'
  ) then
    return private.classroom_json(v_cls);
  end if;

  select cm.id into v_target_id
  from public.classroom_members cm
  where cm.classroom_id = v_cls.id
    and lower(btrim(cm.invited_email)) = v_email
  limit 1
  for update;

  if v_target_id is not null then
    update public.classroom_members
    set student_uid = null,
        updated_at = now()
    where classroom_id = v_cls.id
      and student_uid = v_uid
      and id <> v_target_id
      and status <> 'active';

    update public.classroom_members
    set student_uid = v_uid,
        invited_email = v_email,
        member_name = v_profile.full_name,
        status = 'active',
        joined_via = v_via,
        joined_at = coalesce(joined_at, now()),
        updated_at = now()
    where id = v_target_id;
  else
    select cm.id into v_target_id
    from public.classroom_members cm
    where cm.classroom_id = v_cls.id
      and cm.student_uid = v_uid
    order by cm.updated_at desc
    limit 1
    for update;

    if v_target_id is not null then
      update public.classroom_members
      set student_uid = v_uid,
          invited_email = v_email,
          member_name = v_profile.full_name,
          status = 'active',
          joined_via = v_via,
          joined_at = coalesce(joined_at, now()),
          updated_at = now()
      where id = v_target_id;
    else
      insert into public.classroom_members(
        classroom_id, student_uid, invited_email, member_name, status, joined_via, joined_at, updated_at
      ) values (
        v_cls.id, v_uid, v_email, v_profile.full_name, 'active', v_via, now(), now()
      );
    end if;
  end if;

  return private.classroom_json(v_cls);
end
$$;
