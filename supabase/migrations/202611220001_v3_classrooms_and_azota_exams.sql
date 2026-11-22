-- M1: Classrooms, Classroom Members, Azota Exam Publish Settings, Deadlines & Late Policies
-- 100% PGlite-compatible: uses public.current_uid(), public.has_role(), gen_random_uuid().

-- 1. Classrooms & Roster
create table if not exists public.classrooms (
  id uuid primary key default gen_random_uuid(),
  teacher_uid text not null references public.profiles(firebase_uid) on update cascade on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  subject text not null default '' check (length(subject) <= 100),
  grade_level text not null default '' check (length(grade_level) <= 50),
  description text not null default '' check (length(description) <= 2000),
  invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  invite_enabled boolean not null default true,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists classrooms_teacher_created_idx
  on public.classrooms(teacher_uid, created_at desc);

create table if not exists public.classroom_members (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  student_uid text null references public.profiles(firebase_uid) on update cascade on delete set null,
  invited_email text not null check (length(btrim(invited_email)) between 3 and 320),
  member_name text not null default '' check (length(member_name) <= 100),
  status text not null default 'pending_invite' check (status in ('pending_invite', 'active', 'removed')),
  joined_via text not null check (joined_via in ('code', 'link', 'teacher_email', 'excel_import')),
  added_by text null references public.profiles(firebase_uid) on update cascade on delete set null,
  joined_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists classroom_members_classroom_email_uidx
  on public.classroom_members(classroom_id, lower(btrim(invited_email)));

create unique index if not exists classroom_members_classroom_active_uid_uidx
  on public.classroom_members(classroom_id, student_uid)
  where student_uid is not null and status = 'active';

create index if not exists classroom_members_classroom_status_idx
  on public.classroom_members(classroom_id, status);

create index if not exists classroom_members_student_status_idx
  on public.classroom_members(student_uid, status);

create index if not exists classroom_members_added_by_idx
  on public.classroom_members(added_by);

create index if not exists classroom_members_invited_email_status_idx
  on public.classroom_members(lower(btrim(invited_email)), status);

-- 2. Extend quiz_assignments & exam_attempts for Classroom Assignments, Deadlines & Late Policies
alter table public.quiz_assignments
  add column if not exists classroom_id uuid null references public.classrooms(id) on delete cascade,
  add column if not exists assigned_by text null references public.profiles(firebase_uid) on update cascade on delete set null,
  add column if not exists title text null check (title is null or length(btrim(title)) between 1 and 200),
  add column if not exists instructions text not null default '' check (length(instructions) <= 4000),
  add column if not exists available_from timestamptz null,
  add column if not exists due_at timestamptz null,
  add column if not exists late_policy text not null default 'allow_late',
  add column if not exists hard_close_at timestamptz null,
  add column if not exists max_attempts_override integer null,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quiz_assignments_late_policy_check'
      and conrelid = 'public.quiz_assignments'::regclass
  ) then
    alter table public.quiz_assignments
      add constraint quiz_assignments_late_policy_check
      check (late_policy in ('block_after_due', 'allow_late'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'quiz_assignments_max_attempts_check'
      and conrelid = 'public.quiz_assignments'::regclass
  ) then
    alter table public.quiz_assignments
      add constraint quiz_assignments_max_attempts_check
      check (max_attempts_override is null or max_attempts_override between 0 and 100);
  end if;
end $$;

create unique index if not exists quiz_assignments_quiz_classroom_uidx
  on public.quiz_assignments(quiz_id, classroom_id)
  where classroom_id is not null;

create index if not exists quiz_assignments_classroom_due_idx
  on public.quiz_assignments(classroom_id, due_at);

create index if not exists quiz_assignments_quiz_classroom_idx
  on public.quiz_assignments(quiz_id, classroom_id);

create index if not exists quiz_assignments_assigned_by_idx
  on public.quiz_assignments(assigned_by);

alter table public.exam_attempts
  add column if not exists assignment_id uuid null references public.quiz_assignments(id) on delete set null,
  add column if not exists classroom_id uuid null references public.classrooms(id) on delete set null,
  add column if not exists due_at_snapshot timestamptz null,
  add column if not exists is_late boolean not null default false,
  add column if not exists late_seconds integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'exam_attempts_late_seconds_check'
      and conrelid = 'public.exam_attempts'::regclass
  ) then
    alter table public.exam_attempts
      add constraint exam_attempts_late_seconds_check
      check (late_seconds >= 0);
  end if;
end $$;

create index if not exists exam_attempts_assignment_idx
  on public.exam_attempts(assignment_id);

create index if not exists exam_attempts_classroom_idx
  on public.exam_attempts(classroom_id);

-- 3. Anti-Recursion Helpers & RLS Policies
create or replace function private.is_classroom_teacher(p_classroom_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.classrooms c
    where c.id = p_classroom_id
      and c.teacher_uid = public.current_uid()
  )
$$;

create or replace function private.is_classroom_member(p_classroom_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.classroom_members cm
    where cm.classroom_id = p_classroom_id
      and cm.student_uid = public.current_uid()
      and cm.status = 'active'
  )
$$;

revoke execute on function private.is_classroom_teacher(uuid), private.is_classroom_member(uuid)
  from public, anon, authenticated;

-- Stub replaced by 202611220002_v3_notifications_bugs_and_indexes.sql once in_app_notifications exists
create or replace function private.emit_in_app_notification(
  p_recipient_uid text,
  p_actor_uid text,
  p_type text,
  p_title text,
  p_body text,
  p_target_route text,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  return null;
end
$$;

revoke execute on function private.emit_in_app_notification(text, text, text, text, text, text, jsonb)
  from public, anon, authenticated;

alter table public.classrooms enable row level security;
alter table public.classroom_members enable row level security;

revoke all on public.classrooms, public.classroom_members from public, anon, authenticated;
grant select on public.classrooms, public.classroom_members, public.quiz_assignments to authenticated;
grant all on public.classrooms, public.classroom_members to service_role;

drop policy if exists classrooms_select on public.classrooms;
create policy classrooms_select on public.classrooms
  for select to authenticated
  using (
    teacher_uid = (select public.current_uid())
    or (select public.has_role(array['admin']))
    or (select private.is_classroom_member(id))
  );

drop policy if exists classroom_members_select on public.classroom_members;
create policy classroom_members_select on public.classroom_members
  for select to authenticated
  using (
    student_uid = (select public.current_uid())
    or (select public.has_role(array['admin']))
    or (select private.is_classroom_teacher(classroom_id))
  );

drop policy if exists quiz_assignments_select on public.quiz_assignments;
create policy quiz_assignments_select on public.quiz_assignments
  for select to authenticated
  using (
    (select public.owns_quiz(quiz_id))
    or (classroom_id is not null and (select private.is_classroom_member(classroom_id)))
    or (
      target_type = 'email'
      and lower(btrim(target_value)) = lower(btrim((
        select p.email from public.profiles p
        where p.firebase_uid = (select public.current_uid())
      )))
    )
  );

-- 4. Private JSON Serializers & Redaction Helpers
create or replace function private.classroom_json(c public.classrooms)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id,
    'teacherUid', c.teacher_uid,
    'teacherName', (select p.full_name from public.profiles p where p.firebase_uid = c.teacher_uid),
    'name', c.name,
    'subject', c.subject,
    'gradeLevel', c.grade_level,
    'description', c.description,
    'inviteCode', c.invite_code,
    'inviteEnabled', c.invite_enabled,
    'isArchived', c.is_archived,
    'memberCount', (
      select count(*)::integer from public.classroom_members cm
      where cm.classroom_id = c.id and cm.status = 'active'
    ),
    'assignmentCount', (
      select count(*)::integer from public.quiz_assignments qa
      where qa.classroom_id = c.id
    ),
    'createdAt', c.created_at,
    'updatedAt', c.updated_at
  )
$$;

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
    'questions', (
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
  )
  from public.quizzes q
  join public.profiles p on p.firebase_uid = q.teacher_uid
  where q.id = p_quiz_id
$$;

create or replace function private.redact_result_for_caller(
  p_payload jsonb,
  p_quiz_settings jsonb,
  p_allow_review boolean,
  p_hard_close_at timestamptz,
  p_quiz_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_close_ts timestamptz;
  v_score_vis text;
  v_answer_vis text;
  v_show_score boolean;
  v_show_answers boolean;
  v_out jsonb := p_payload;
begin
  if public.owns_quiz(p_quiz_id) then
    return v_out || jsonb_build_object('scoreHidden', false, 'answersHidden', false);
  end if;

  v_close_ts := coalesce(
    p_hard_close_at,
    nullif(btrim(coalesce(p_quiz_settings->>'closesAt', '')), '')::timestamptz
  );
  v_score_vis := coalesce(nullif(btrim(coalesce(p_quiz_settings->>'scoreVisibility', '')), ''), 'immediate');
  v_answer_vis := coalesce(
    nullif(btrim(coalesce(p_quiz_settings->>'answerVisibility', '')), ''),
    case when coalesce(p_allow_review, true) then 'immediate' else 'never' end
  );

  v_show_score := case v_score_vis
    when 'immediate' then true
    when 'after_close' then (v_close_ts is not null and now() >= v_close_ts)
    else false
  end;

  v_show_answers := case v_answer_vis
    when 'immediate' then true
    when 'after_close' then (v_close_ts is not null and now() >= v_close_ts)
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
  private.classroom_json(public.classrooms),
  private.quiz_json(uuid),
  private.redact_result_for_caller(jsonb, jsonb, boolean, timestamptz, uuid)
  from public, anon, authenticated;

-- 5. Classroom Management RPCs
create or replace function public.create_classroom(
  p_name text,
  p_subject text default '',
  p_grade_level text default '',
  p_description text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid text := public.current_uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_code text;
  v_row public.classrooms;
  v_tries integer := 0;
begin
  if not public.has_role(array['teacher', 'admin']) then
    raise exception 'Chỉ giáo viên hoặc quản trị viên được tạo lớp học';
  end if;
  if length(v_name) < 1 or length(v_name) > 120 then
    raise exception 'Tên lớp học phải từ 1 đến 120 ký tự';
  end if;

  loop
    v_tries := v_tries + 1;
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.classrooms(teacher_uid, name, subject, grade_level, description, invite_code)
      values (
        v_uid,
        v_name,
        left(btrim(coalesce(p_subject, '')), 100),
        left(btrim(coalesce(p_grade_level, '')), 50),
        left(btrim(coalesce(p_description, '')), 2000),
        v_code
      )
      returning * into v_row;
      exit;
    exception when unique_violation then
      if v_tries >= 8 then
        raise;
      end if;
    end;
  end loop;

  return private.classroom_json(v_row);
end
$$;

create or replace function public.update_classroom(
  p_id uuid,
  p_name text default null,
  p_subject text default null,
  p_grade_level text default null,
  p_description text default null,
  p_invite_enabled boolean default null,
  p_is_archived boolean default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.classrooms;
  v_name text;
begin
  select * into v_row from public.classrooms where id = p_id for update;
  if not found then
    raise exception 'Không tìm thấy lớp học';
  end if;
  if not (public.has_role(array['admin']) or (public.has_role(array['teacher']) and v_row.teacher_uid = public.current_uid())) then
    raise exception 'Không có quyền chỉnh sửa lớp học này';
  end if;

  v_name := case when p_name is not null then btrim(p_name) else v_row.name end;
  if length(v_name) < 1 or length(v_name) > 120 then
    raise exception 'Tên lớp học phải từ 1 đến 120 ký tự';
  end if;

  update public.classrooms
  set name = v_name,
      subject = case when p_subject is not null then left(btrim(p_subject), 100) else subject end,
      grade_level = case when p_grade_level is not null then left(btrim(p_grade_level), 50) else grade_level end,
      description = case when p_description is not null then left(btrim(p_description), 2000) else description end,
      invite_enabled = coalesce(p_invite_enabled, invite_enabled),
      is_archived = coalesce(p_is_archived, is_archived),
      updated_at = now()
  where id = p_id
  returning * into v_row;

  return private.classroom_json(v_row);
end
$$;

create or replace function public.regenerate_classroom_code(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.classrooms;
  v_code text;
  v_tries integer := 0;
begin
  select * into v_row from public.classrooms where id = p_id for update;
  if not found then
    raise exception 'Không tìm thấy lớp học';
  end if;
  if not (public.has_role(array['admin']) or (public.has_role(array['teacher']) and v_row.teacher_uid = public.current_uid())) then
    raise exception 'Không có quyền đổi mã lớp học này';
  end if;

  loop
    v_tries := v_tries + 1;
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      update public.classrooms
      set invite_code = v_code, updated_at = now()
      where id = p_id;
      return v_code;
    exception when unique_violation then
      if v_tries >= 8 then
        raise;
      end if;
    end;
  end loop;
end
$$;

create or replace function public.list_my_classrooms() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.classroom_json(c) order by c.created_at desc), '[]'::jsonb)
  from public.classrooms c
  where (
    public.has_role(array['admin'])
    or (public.has_role(array['teacher']) and c.teacher_uid = public.current_uid())
    or (
      public.has_role(array['student'])
      and not c.is_archived
      and exists (
        select 1 from public.classroom_members cm
        where cm.classroom_id = c.id
          and cm.student_uid = public.current_uid()
          and cm.status = 'active'
      )
    )
  )
$$;

create or replace function public.get_classroom_detail(p_classroom_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cls public.classrooms;
  v_is_manager boolean;
  v_is_member boolean;
  v_members jsonb;
  v_assignments jsonb;
begin
  select * into v_cls from public.classrooms where id = p_classroom_id;
  if not found then
    raise exception 'Không tìm thấy lớp học';
  end if;

  v_is_manager := public.has_role(array['admin'])
    or (public.has_role(array['teacher']) and v_cls.teacher_uid = public.current_uid());
  v_is_member := public.has_role(array['student']) and exists(
    select 1 from public.classroom_members cm
    where cm.classroom_id = p_classroom_id
      and cm.student_uid = public.current_uid()
      and cm.status = 'active'
  );

  if not v_is_manager and not v_is_member then
    raise exception 'Bạn không có quyền xem thông tin lớp học này';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', cm.id,
    'classroomId', cm.classroom_id,
    'studentUid', cm.student_uid,
    'invitedEmail', cm.invited_email,
    'memberName', coalesce(nullif(p.full_name, ''), nullif(cm.member_name, ''), split_part(cm.invited_email, '@', 1)),
    'status', cm.status,
    'joinedVia', cm.joined_via,
    'joinedAt', cm.joined_at,
    'createdAt', cm.created_at
  ) order by cm.status asc, cm.created_at desc), '[]'::jsonb)
  into v_members
  from public.classroom_members cm
  left join public.profiles p on p.firebase_uid = cm.student_uid
  where cm.classroom_id = p_classroom_id
    and cm.status <> 'removed'
    and (v_is_manager or cm.student_uid = public.current_uid());

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', qa.id,
    'classroomId', qa.classroom_id,
    'classroomName', v_cls.name,
    'quizId', qa.quiz_id,
    'quizTitle', q.title,
    'quizCode', q.code,
    'assignedBy', qa.assigned_by,
    'title', qa.title,
    'instructions', qa.instructions,
    'availableFrom', qa.available_from,
    'dueAt', qa.due_at,
    'latePolicy', qa.late_policy,
    'hardCloseAt', qa.hard_close_at,
    'maxAttemptsOverride', qa.max_attempts_override,
    'createdAt', qa.created_at
  ) order by coalesce(qa.due_at, qa.created_at) asc, qa.created_at desc), '[]'::jsonb)
  into v_assignments
  from public.quiz_assignments qa
  join public.quizzes q on q.id = qa.quiz_id
  where qa.classroom_id = p_classroom_id;

  return jsonb_build_object(
    'classroom', private.classroom_json(v_cls),
    'members', v_members,
    'assignments', v_assignments
  );
end
$$;

create or replace function public.add_classroom_members_bulk(
  p_classroom_id uuid,
  p_emails text[],
  p_joined_via text default 'teacher_email'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cls public.classrooms;
  v_raw text;
  v_email text;
  v_student_uid text;
  v_student_name text;
  v_existing public.classroom_members;
  v_added_active integer := 0;
  v_added_pending integer := 0;
  v_skipped integer := 0;
  v_invalid text[] := array[]::text[];
  v_seen text[] := array[]::text[];
begin
  if p_joined_via not in ('teacher_email', 'excel_import') then
    raise exception 'Phương thức thêm học sinh không hợp lệ';
  end if;
  if p_emails is null or cardinality(p_emails) = 0 then
    return jsonb_build_object('addedActive', 0, 'addedPending', 0, 'skippedExisting', 0, 'invalidEmails', '[]'::jsonb);
  end if;
  if cardinality(p_emails) > 500 then
    raise exception 'Tối đa 500 email mỗi lần thêm';
  end if;

  select * into v_cls from public.classrooms where id = p_classroom_id for update;
  if not found then
    raise exception 'Không tìm thấy lớp học';
  end if;
  if not (public.has_role(array['admin']) or (public.has_role(array['teacher']) and v_cls.teacher_uid = public.current_uid())) then
    raise exception 'Không có quyền thêm học sinh vào lớp này';
  end if;

  foreach v_raw in array p_emails loop
    v_email := lower(btrim(coalesce(v_raw, '')));
    if v_email = '' then
      continue;
    end if;
    if v_email = any(v_seen) then
      continue;
    end if;
    v_seen := array_append(v_seen, v_email);

    if length(v_email) > 320 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      v_invalid := array_append(v_invalid, v_email);
      continue;
    end if;

    select * into v_existing
    from public.classroom_members cm
    where cm.classroom_id = p_classroom_id
      and lower(btrim(cm.invited_email)) = v_email;

    if found and v_existing.status in ('active', 'pending_invite') then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select p.firebase_uid, p.full_name
    into v_student_uid, v_student_name
    from public.profiles p
    where lower(btrim(p.email)) = v_email
    limit 1;

    if v_student_uid is not null then
      if exists (
        select 1 from public.classroom_members cm2
        where cm2.classroom_id = p_classroom_id
          and cm2.student_uid = v_student_uid
          and cm2.status = 'active'
      ) then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      insert into public.classroom_members(
        classroom_id, student_uid, invited_email, member_name, status, joined_via, added_by, joined_at, updated_at
      ) values (
        p_classroom_id, v_student_uid, v_email, coalesce(v_student_name, ''), 'active', p_joined_via, public.current_uid(), now(), now()
      )
      on conflict (classroom_id, lower(btrim(invited_email))) do update
      set student_uid = excluded.student_uid,
          member_name = excluded.member_name,
          status = 'active',
          joined_via = excluded.joined_via,
          added_by = excluded.added_by,
          joined_at = now(),
          updated_at = now();

      v_added_active := v_added_active + 1;

      perform private.emit_in_app_notification(
        v_student_uid,
        public.current_uid(),
        'classroom_joined',
        'Bạn đã được thêm vào lớp học',
        format('Giáo viên đã thêm bạn vào lớp "%s".', v_cls.name),
        '/student/classes/' || p_classroom_id::text,
        jsonb_build_object('classroomId', p_classroom_id, 'classroomName', v_cls.name)
      );
    else
      insert into public.classroom_members(
        classroom_id, student_uid, invited_email, member_name, status, joined_via, added_by, joined_at, updated_at
      ) values (
        p_classroom_id, null, v_email, split_part(v_email, '@', 1), 'pending_invite', p_joined_via, public.current_uid(), null, now()
      )
      on conflict (classroom_id, lower(btrim(invited_email))) do update
      set student_uid = null,
          status = 'pending_invite',
          joined_via = excluded.joined_via,
          added_by = excluded.added_by,
          joined_at = null,
          updated_at = now();

      v_added_pending := v_added_pending + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'addedActive', v_added_active,
    'addedPending', v_added_pending,
    'skippedExisting', v_skipped,
    'invalidEmails', to_jsonb(v_invalid)
  );
end
$$;

create or replace function public.remove_classroom_member(
  p_classroom_id uuid,
  p_member_id uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_cls public.classrooms;
begin
  select * into v_cls from public.classrooms where id = p_classroom_id;
  if not found then
    raise exception 'Không tìm thấy lớp học';
  end if;
  if not (public.has_role(array['admin']) or (public.has_role(array['teacher']) and v_cls.teacher_uid = public.current_uid())) then
    raise exception 'Không có quyền xóa học sinh khỏi lớp này';
  end if;

  update public.classroom_members
  set status = 'removed',
      updated_at = now()
  where id = p_member_id
    and classroom_id = p_classroom_id;
end
$$;

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

  if exists (
    select 1 from public.classroom_members cm
    where cm.classroom_id = v_cls.id
      and cm.student_uid = v_uid
      and cm.status = 'active'
  ) then
    return private.classroom_json(v_cls);
  end if;

  -- Clean up any old non-email-matching row by student_uid if email changed
  update public.classroom_members
  set student_uid = v_uid,
      invited_email = lower(btrim(v_profile.email)),
      member_name = v_profile.full_name,
      status = 'active',
      joined_via = v_via,
      joined_at = coalesce(joined_at, now()),
      updated_at = now()
  where classroom_id = v_cls.id
    and (lower(btrim(invited_email)) = lower(btrim(v_profile.email)) or student_uid = v_uid);

  if not found then
    insert into public.classroom_members(
      classroom_id, student_uid, invited_email, member_name, status, joined_via, joined_at, updated_at
    ) values (
      v_cls.id, v_uid, lower(btrim(v_profile.email)), v_profile.full_name, 'active', v_via, now(), now()
    );
  end if;

  return private.classroom_json(v_cls);
end
$$;

-- 6. Quiz Read Permissions, Listing, Azota Publish Settings & Classroom Assignments
create or replace function public.can_read_quiz(qid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.owns_quiz(qid)
    or (
      public.has_role(array['student'])
      and exists (
        select 1
        from public.quizzes q
        where q.id = qid
          and (
            exists (
              select 1 from public.exam_attempts a
              where a.quiz_id = qid and a.student_uid = public.current_uid()
            )
            or (
              q.status = 'published'
              and (
                coalesce(nullif(q.settings->>'publishScope', ''), 'public') = 'public'
                or exists (
                  select 1
                  from public.quiz_assignments qa
                  join public.classroom_members cm on cm.classroom_id = qa.classroom_id
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
      )
    )
$$;

create or replace function public.list_quizzes() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.quiz_json(q.id) order by q.created_at desc), '[]'::jsonb)
  from public.quizzes q
  where public.can_read_quiz(q.id)
$$;

create or replace function public.join_quiz_by_code(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_quiz public.quizzes;
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

  return private.quiz_json(v_quiz.id);
end
$$;

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

  v_opens_at := nullif(btrim(coalesce(v_merged->>'opensAt', '')), '')::timestamptz;
  v_closes_at := nullif(btrim(coalesce(v_merged->>'closesAt', '')), '')::timestamptz;
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

create or replace function public.list_teacher_quiz_tracking(
  p_quiz_id uuid,
  p_classroom_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_on_time integer := 0;
  v_late integer := 0;
  v_in_progress integer := 0;
  v_not_submitted integer := 0;
begin
  if p_quiz_id is null or not public.owns_quiz(p_quiz_id) then
    raise exception 'Không có quyền xem thống kê theo dõi đề thi';
  end if;

  with roster as (
    select
      cm.classroom_id,
      c.name as classroom_name,
      cm.student_uid,
      cm.invited_email,
      coalesce(nullif(p.full_name, ''), nullif(cm.member_name, ''), split_part(cm.invited_email, '@', 1)) as student_name,
      qa.id as assignment_id
    from public.quiz_assignments qa
    join public.classrooms c on c.id = qa.classroom_id
    join public.classroom_members cm on cm.classroom_id = c.id and cm.status in ('active', 'pending_invite')
    left join public.profiles p on p.firebase_uid = cm.student_uid
    where qa.quiz_id = p_quiz_id
      and qa.classroom_id is not null
      and (p_classroom_id is null or qa.classroom_id = p_classroom_id)
  ),
  roster_with_stats as (
    select
      r.student_uid,
      r.invited_email,
      r.student_name,
      r.classroom_id,
      r.classroom_name,
      coalesce(att.attempt_count, 0) as attempt_count,
      case
        when latest_sub.id is not null and latest_sub.is_late then 'submitted_late'
        when latest_sub.id is not null then 'submitted_on_time'
        when coalesce(att.active_count, 0) > 0 then 'in_progress'
        else 'not_submitted'
      end as status,
      (latest_sub.payload->>'score')::numeric as score,
      (latest_sub.payload->>'percentage')::numeric as percentage,
      coalesce(latest_sub.is_late, false) as is_late,
      coalesce(latest_sub.late_seconds, 0) as late_seconds,
      latest_sub.submitted_at,
      latest_sub.result_id as latest_result_id
    from roster r
    left join lateral (
      select
        count(*)::integer as attempt_count,
        count(*) filter (where a.submitted_at is null)::integer as active_count
      from public.exam_attempts a
      where a.quiz_id = p_quiz_id
        and r.student_uid is not null
        and a.student_uid = r.student_uid
        and (a.classroom_id = r.classroom_id or a.classroom_id is null)
    ) att on true
    left join lateral (
      select a.id, a.is_late, a.late_seconds, a.submitted_at, er.id as result_id, er.payload
      from public.exam_attempts a
      join public.exam_results er on er.attempt_id = a.id
      where a.quiz_id = p_quiz_id
        and r.student_uid is not null
        and a.student_uid = r.student_uid
        and (a.classroom_id = r.classroom_id or a.classroom_id is null)
        and a.submitted_at is not null
      order by a.submitted_at desc
      limit 1
    ) latest_sub on true
  ),
  public_takers as (
    select
      a.student_uid,
      coalesce(p.email, '') as invited_email,
      coalesce(nullif(p.full_name, ''), a.student_name) as student_name,
      a.classroom_id,
      null::text as classroom_name,
      count(*)::integer as attempt_count,
      case
        when bool_or(a.submitted_at is not null and a.is_late) and not bool_or(a.submitted_at is not null and not a.is_late) then 'submitted_late'
        when bool_or(a.submitted_at is not null) then 'submitted_on_time'
        else 'in_progress'
      end as status,
      (array_agg((er.payload->>'score')::numeric order by a.submitted_at desc nulls last) filter (where er.id is not null))[1] as score,
      (array_agg((er.payload->>'percentage')::numeric order by a.submitted_at desc nulls last) filter (where er.id is not null))[1] as percentage,
      coalesce((array_agg(a.is_late order by a.submitted_at desc nulls last) filter (where a.submitted_at is not null))[1], false) as is_late,
      coalesce((array_agg(a.late_seconds order by a.submitted_at desc nulls last) filter (where a.submitted_at is not null))[1], 0) as late_seconds,
      max(a.submitted_at) as submitted_at,
      (array_agg(er.id order by a.submitted_at desc nulls last) filter (where er.id is not null))[1] as latest_result_id
    from public.exam_attempts a
    left join public.profiles p on p.firebase_uid = a.student_uid
    left join public.exam_results er on er.attempt_id = a.id
    where p_classroom_id is null
      and a.quiz_id = p_quiz_id
      and not exists (
        select 1 from roster r where r.student_uid = a.student_uid
      )
    group by a.student_uid, p.email, p.full_name, a.student_name, a.classroom_id
  ),
  combined as (
    select * from roster_with_stats
    union all
    select * from public_takers
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'studentUid', c.student_uid,
      'invitedEmail', c.invited_email,
      'studentName', c.student_name,
      'classroomId', c.classroom_id,
      'classroomName', c.classroom_name,
      'status', c.status,
      'attemptCount', c.attempt_count,
      'score', c.score,
      'percentage', c.percentage,
      'isLate', c.is_late,
      'lateSeconds', c.late_seconds,
      'submittedAt', c.submitted_at,
      'latestResultId', c.latest_result_id
    ) order by c.classroom_name nulls last, c.status asc, c.student_name asc), '[]'::jsonb),
    count(*)::integer,
    count(*) filter (where c.status = 'submitted_on_time')::integer,
    count(*) filter (where c.status = 'submitted_late')::integer,
    count(*) filter (where c.status = 'in_progress')::integer,
    count(*) filter (where c.status = 'not_submitted')::integer
  into v_rows, v_total, v_on_time, v_late, v_in_progress, v_not_submitted
  from combined c;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'total', v_total,
      'submittedOnTime', v_on_time,
      'submittedLate', v_late,
      'inProgress', v_in_progress,
      'notSubmitted', v_not_submitted
    ),
    'rows', v_rows
  );
end
$$;

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
      when coalesce(qa.hard_close_at, qa.due_at) is not null and now() > coalesce(qa.hard_close_at, qa.due_at) then 'overdue'
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

-- 7. Attempt Lifecycle, Grading, Redaction & Practice Security
create or replace function private.session_json(a public.exam_attempts)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id,
    'quizId', a.quiz_id,
    'studentId', a.student_uid,
    'studentName', a.student_name,
    'studentClass', a.student_class,
    'assignmentId', a.assignment_id,
    'classroomId', a.classroom_id,
    'dueAtSnapshot', a.due_at_snapshot,
    'isLate', a.is_late,
    'lateSeconds', a.late_seconds,
    'startTime', extract(epoch from a.started_at) * 1000,
    'endTime', coalesce(extract(epoch from a.ends_at) * 1000, 0),
    'durationMinutes', a.duration_minutes,
    'answers', (
      select coalesce(jsonb_object_agg(question_id, selected_answers), '{}')
      from public.exam_answers where attempt_id = a.id
    ),
    'flaggedQuestionIds', a.flagged_ids,
    'currentQuestionIndex', a.current_index,
    'isSubmitted', a.submitted_at is not null,
    'lastSavedAt', a.updated_at,
    'revision', a.revision,
    'questionOrder', to_jsonb(a.question_order),
    'optionOrder', a.option_order
  )
$$;

-- Drop old 2-arg signature before creating 3-arg signature to prevent overload ambiguity
drop function if exists public.start_attempt(uuid, text);

create function public.start_attempt(
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

  if not public.can_read_quiz(q.id) then
    raise exception 'Đề thi này chỉ dành cho lớp học hoặc học sinh được giao';
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
      select 1 from public.classroom_members cm
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
    where x.quiz_id = p_quiz_id
      and x.classroom_id is not null
      and cm.student_uid = v_uid
      and cm.status = 'active'
    order by x.due_at asc nulls last, x.created_at desc
    limit 1;
    v_has_qa := found;
  end if;

  v_opens_at := coalesce(
    case when v_has_qa then qa.available_from else null end,
    nullif(btrim(coalesce(q.settings->>'opensAt', '')), '')::timestamptz
  );
  v_closes_at := coalesce(
    case when v_has_qa then qa.hard_close_at else null end,
    nullif(btrim(coalesce(q.settings->>'closesAt', '')), '')::timestamptz
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

create or replace function public.save_attempt(
  p_id uuid,
  p_revision integer,
  p_answers jsonb,
  p_flags jsonb,
  p_index integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.exam_attempts;
  v_late_policy text;
  pair record;
  v text;
begin
  select * into a from public.exam_attempts
  where id = p_id and student_uid = public.current_uid() for update;
  if not found or not public.has_role(array['student']) then
    raise exception 'Không có quyền';
  end if;
  if a.submitted_at is not null then
    raise exception 'Bài đã nộp';
  end if;

  if a.assignment_id is not null and a.due_at_snapshot is not null then
    select qa.late_policy into v_late_policy
    from public.quiz_assignments qa where qa.id = a.assignment_id;
    if v_late_policy = 'block_after_due' and now() > a.due_at_snapshot then
      raise exception 'Hết giờ: đã quá hạn nộp bài';
    end if;
  end if;

  if a.ends_at is not null and now() >= a.ends_at then
    raise exception 'Hết giờ: nộp các đáp án đã lưu';
  end if;
  if a.revision <> p_revision then
    raise exception 'CONFLICT: Bài đã được cập nhật trên thiết bị khác. Tải lại trước khi tiếp tục';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'object' or jsonb_typeof(p_flags) is distinct from 'array' then
    raise exception 'Dữ liệu không hợp lệ';
  end if;

  -- Preserve 5-option (A-E) support from 20261118050412
  for pair in select * from jsonb_each(p_answers) loop
    if not (pair.key::uuid = any(a.question_order)) or jsonb_typeof(pair.value) <> 'array' or jsonb_array_length(pair.value) > 5 then
      raise exception 'Đáp án không hợp lệ';
    end if;
    if (select type from public.questions where id = pair.key::uuid) <> 'multiple_choice' and jsonb_array_length(pair.value) > 1 then
      raise exception 'Chỉ chọn một đáp án';
    end if;
    for v in select value from jsonb_array_elements_text(pair.value) as values(value) loop
      if not exists(select 1 from public.questions q, jsonb_array_elements(q.options) o where q.id = pair.key::uuid and o->>'id' = v) then
        raise exception 'Phương án không hợp lệ';
      end if;
    end loop;
  end loop;

  if exists(select 1 from jsonb_array_elements_text(p_flags) as flags(value) where not (flags.value::uuid = any(a.question_order))) then
    raise exception 'Cờ không hợp lệ';
  end if;

  delete from public.exam_answers existing
  where existing.attempt_id = a.id
    and not exists(select 1 from jsonb_each(p_answers) incoming where incoming.key::uuid = existing.question_id);

  insert into public.exam_answers(attempt_id, question_id, selected_answers)
  select a.id, key::uuid, value from jsonb_each(p_answers)
  on conflict (attempt_id, question_id) do update
  set selected_answers = excluded.selected_answers, updated_at = now();

  update public.exam_attempts
  set flagged_ids = p_flags,
      current_index = greatest(0, least(p_index, array_length(question_order, 1) - 1)),
      revision = revision + 1,
      updated_at = now()
  where id = a.id
  returning * into a;

  return private.session_json(a);
end
$$;

create or replace function private.finalize_attempt(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.exam_attempts;
  q public.quizzes;
  total integer;
  answered integer;
  correct integer;
  earned numeric;
  maximum numeric;
  pct numeric;
  details jsonb;
  rid uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_is_late boolean := false;
  v_late_seconds integer := 0;
begin
  select * into a from public.exam_attempts where id = p_id for update;
  if not found or exists(select 1 from public.exam_results where attempt_id = p_id) then
    return;
  end if;

  select * into q from public.quizzes where id = a.quiz_id;

  if a.due_at_snapshot is not null and v_now > a.due_at_snapshot then
    v_is_late := true;
    v_late_seconds := greatest(0, floor(extract(epoch from (v_now - a.due_at_snapshot)))::integer);
  end if;

  with graded as (
    select x.*, k.correct_answers, k.explanation, coalesce(y.selected_answers, '[]'::jsonb) selected,
      (coalesce(y.selected_answers, '[]'::jsonb) @> k.correct_answers and k.correct_answers @> coalesce(y.selected_answers, '[]'::jsonb)) ok
    from public.questions x
    join public.question_answer_keys k on k.question_id = x.id
    left join public.exam_answers y on y.question_id = x.id and y.attempt_id = a.id
    where x.quiz_id = a.quiz_id
  )
  select count(*),
    count(*) filter (where jsonb_array_length(selected) > 0),
    count(*) filter (where ok),
    coalesce(sum(points) filter (where ok), 0),
    sum(points),
    jsonb_agg(jsonb_build_object(
      'questionId', id,
      'order', ordinal,
      'content', content,
      'images', images,
      'options', options,
      'selectedAnswers', selected,
      'correctAnswers', correct_answers,
      'isCorrect', ok,
      'pointsEarned', case when ok then points else 0 end,
      'maxPoints', points,
      'explanation', explanation
    ) order by ordinal)
  into total, answered, correct, earned, maximum, details
  from graded;

  pct := round(earned / nullif(maximum, 0) * 100, 2);

  insert into public.exam_results(id, attempt_id, payload)
  values (
    rid,
    a.id,
    jsonb_build_object(
      'id', rid,
      'quizId', q.id,
      'quizTitle', q.title,
      'subject', q.subject,
      'roomCode', q.code,
      'studentId', a.student_uid,
      'studentName', a.student_name,
      'studentClass', a.student_class,
      'assignmentId', a.assignment_id,
      'classroomId', a.classroom_id,
      'dueAtSnapshot', a.due_at_snapshot,
      'isLate', v_is_late,
      'lateSeconds', v_late_seconds,
      'totalQuestions', total,
      'answeredCount', answered,
      'correctCount', correct,
      'incorrectCount', answered - correct,
      'skippedCount', total - answered,
      'score', round(earned / nullif(maximum, 0) * 10, 2),
      'totalPointsEarned', earned,
      'maxTotalPoints', maximum,
      'percentage', pct,
      'isPassed', pct >= a.pass_percentage,
      'passPercentage', a.pass_percentage,
      'academicRank', case
        when pct >= 90 then 'Xuất sắc'
        when pct >= 80 then 'Giỏi'
        when pct >= 65 then 'Khá'
        when pct >= 50 then 'Trung bình'
        else 'Yếu'
      end,
      'timeSpentSeconds', greatest(0, floor(extract(epoch from (least(v_now, coalesce(a.ends_at, v_now)) - a.started_at)))),
      'details', details,
      'submittedAt', v_now
    )
  );

  update public.exam_attempts
  set submitted_at = v_now,
      is_late = v_is_late,
      late_seconds = v_late_seconds,
      updated_at = v_now
  where id = a.id;
end
$$;

create or replace function public.submit_attempt(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.exam_attempts;
  q public.quizzes;
  qa public.quiz_assignments;
  r public.exam_results;
  v_hard_close timestamptz := null;
begin
  select * into a from public.exam_attempts
  where id = p_id and student_uid = public.current_uid() for update;
  if not found or not public.has_role(array['student']) then
    raise exception 'Không có quyền';
  end if;

  if a.assignment_id is not null then
    select * into qa from public.quiz_assignments where id = a.assignment_id;
    if found then
      v_hard_close := qa.hard_close_at;
      if a.submitted_at is null and qa.late_policy = 'block_after_due' and a.due_at_snapshot is not null and now() > a.due_at_snapshot + interval '60 seconds' then
        raise exception 'Đã quá hạn nộp bài và giáo viên đã khóa nộp muộn';
      end if;
    end if;
  end if;

  perform private.finalize_attempt(p_id);
  select * into r from public.exam_results where attempt_id = p_id;
  select * into q from public.quizzes where id = a.quiz_id;

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

  if a.assignment_id is not null then
    select * into qa from public.quiz_assignments where id = a.assignment_id;
    if found then
      v_hard_close := qa.hard_close_at;
    end if;
  end if;

  already_submitted := a.submitted_at is not null;
  if not already_submitted then
    if a.assignment_id is not null and qa.id is not null and qa.late_policy = 'block_after_due' and a.due_at_snapshot is not null and now() > a.due_at_snapshot + interval '60 seconds' then
      raise exception 'Đã quá hạn nộp bài và giáo viên đã khóa nộp muộn';
    end if;
    perform private.finalize_attempt(p_attempt_id);
  end if;

  select * into r from public.exam_results where attempt_id = p_attempt_id;
  select * into q from public.quizzes where id = a.quiz_id;

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

create or replace function public.list_results() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
    private.redact_result_for_caller(
      r.payload || jsonb_build_object('id', r.id),
      q.settings,
      a.allow_review,
      qa.hard_close_at,
      a.quiz_id
    )
    order by r.created_at desc
  ), '[]'::jsonb)
  from public.exam_results r
  join public.exam_attempts a on a.id = r.attempt_id
  join public.quizzes q on q.id = a.quiz_id
  left join public.quiz_assignments qa on qa.id = a.assignment_id
  where a.student_uid = public.current_uid() or public.owns_quiz(a.quiz_id)
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
  total_count integer;
  take_count integer;
  ids uuid[];
  opts jsonb;
begin
  if not public.has_role(array['student']) then raise exception 'Chỉ học sinh được luyện tập'; end if;

  select * into q from public.quizzes where id = p_quiz_id for update;
  if not found then raise exception 'Không tìm thấy đề luyện tập'; end if;
  if q.status <> 'published' then raise exception 'Đề chưa được xuất bản hoặc đã đóng'; end if;
  if not public.can_read_quiz(q.id) then raise exception 'Bạn không có quyền truy cập đề luyện tập này'; end if;
  if q.settings->'practiceEnabled' = 'false'::jsonb then raise exception 'Giáo viên đã tắt chức năng luyện tập cho đề này'; end if;

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

-- 8. Execute Grants
revoke execute on function
  public.create_classroom(text, text, text, text),
  public.update_classroom(uuid, text, text, text, text, boolean, boolean),
  public.regenerate_classroom_code(uuid),
  public.list_my_classrooms(),
  public.get_classroom_detail(uuid),
  public.add_classroom_members_bulk(uuid, text[], text),
  public.remove_classroom_member(uuid, uuid),
  public.join_classroom_by_code(text, text),
  public.join_quiz_by_code(text),
  public.update_quiz_publish_settings(uuid, jsonb, text),
  public.assign_quiz_to_classrooms(uuid, jsonb),
  public.list_teacher_quiz_tracking(uuid, uuid),
  public.list_student_assignments(uuid),
  public.start_attempt(uuid, text, uuid)
  from public, anon;

grant execute on function
  public.create_classroom(text, text, text, text),
  public.update_classroom(uuid, text, text, text, text, boolean, boolean),
  public.regenerate_classroom_code(uuid),
  public.list_my_classrooms(),
  public.get_classroom_detail(uuid),
  public.add_classroom_members_bulk(uuid, text[], text),
  public.remove_classroom_member(uuid, uuid),
  public.join_classroom_by_code(text, text),
  public.join_quiz_by_code(text),
  public.update_quiz_publish_settings(uuid, jsonb, text),
  public.assign_quiz_to_classrooms(uuid, jsonb),
  public.list_teacher_quiz_tracking(uuid, uuid),
  public.list_student_assignments(uuid),
  public.start_attempt(uuid, text, uuid)
  to authenticated;
