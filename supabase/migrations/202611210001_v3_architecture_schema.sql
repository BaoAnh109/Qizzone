-- Qizzone V3 architecture schema:
-- - Supabase Auth native app_metadata / JWT identity alignment (never trusting user_metadata for roles)
-- - Server-managed user_roles, teacher_requests, role_audit_logs
-- - Private R2 materials & async AI extraction jobs + daily quotas
-- - Notification preferences, templates, outbox & delivery logs (Asia/Ho_Chi_Minh)
-- - Idempotent exam finalization, quiz versions, exam rooms & audit trails

-- 1. Align identity helpers with Supabase Auth JWT (app_metadata.app_role) and legacy test claims
create or replace function public.current_uid() returns text
language sql stable set search_path = '' as $$
  select auth.jwt()->>'sub'
$$;

create or replace function public.app_role() returns text
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt()->'app_metadata'->>'app_role', auth.jwt()->>'app_role')
$$;

-- Support both Supabase UUID `id` and text key `firebase_uid` cleanly without breaking existing FKs
alter table public.profiles
  add column if not exists id uuid unique;

update public.profiles
set id = case
  when firebase_uid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then firebase_uid::uuid
  else gen_random_uuid()
end
where id is null;

create or replace function private.sync_profile_uuid() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.id is null then
    new.id := case
      when new.firebase_uid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then new.firebase_uid::uuid
      else gen_random_uuid()
    end;
  end if;
  return new;
end
$$;

drop trigger if exists trg_profiles_sync_uuid on public.profiles;
create trigger trg_profiles_sync_uuid
before insert on public.profiles
for each row execute function private.sync_profile_uuid();

-- 2. Private answer_keys view (strictly inaccessible to anon/authenticated)
create or replace view private.answer_keys as
  select question_id, correct_answers, explanation, created_at, updated_at
  from public.question_answer_keys;

revoke all on private.answer_keys from public, anon, authenticated;
grant select on private.answer_keys to service_role;

-- 3. Server-managed roles, teacher requests & role audit logs
create table if not exists public.user_roles (
  user_uid text primary key references public.profiles(firebase_uid) on delete cascade,
  base_role text not null check (base_role in ('student','teacher','admin')),
  active_role text not null check (active_role in ('student','teacher','admin')),
  updated_at timestamptz not null default now()
);

create table if not exists public.teacher_requests (
  id uuid primary key default gen_random_uuid(),
  user_uid text not null unique references public.profiles(firebase_uid) on delete cascade,
  status text not null default 'none' check (status in ('none','pending','approved','rejected')),
  blocked boolean not null default false,
  requested_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text references public.profiles(firebase_uid),
  updated_at timestamptz not null default now()
);

create table if not exists public.role_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_uid text not null,
  target_uid text not null,
  action text not null,
  previous_role text,
  new_role text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

-- 4. Quiz assignments, versions & exam rooms
create table if not exists public.quiz_assignments (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  target_type text not null check (target_type in ('class','email')),
  target_value text not null check (length(btrim(target_value)) between 1 and 320),
  created_at timestamptz not null default now(),
  unique (quiz_id, target_type, target_value)
);

create table if not exists public.quiz_versions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (quiz_id, version_number)
);

create table if not exists public.exam_rooms (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null unique references public.quizzes(id) on delete cascade,
  room_code text not null unique,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5. Cloudflare R2 materials & async AI extraction jobs
create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null references public.profiles(firebase_uid) on delete cascade,
  object_key text not null unique,
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  mime_type text not null check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain'
  )),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  sha256 text,
  status text not null default 'pending' check (status in ('pending','ready','expired','deleted','failed')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists materials_owner_created on public.materials(owner_uid, created_at desc);

create table if not exists public.ai_extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null references public.profiles(firebase_uid) on delete cascade,
  material_id uuid references public.materials(id) on delete set null,
  extraction_mode text not null check (extraction_mode in ('structural_fallback','scan_ocr_vlm','solve_missing_answers')),
  selected_pages integer[],
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  result_draft_id uuid,
  result_draft jsonb,
  gemini_file_uri text,
  model_used text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_jobs_owner_created on public.ai_extraction_jobs(owner_uid, created_at desc);

create table if not exists public.ai_usage_daily (
  user_uid text not null references public.profiles(firebase_uid) on delete cascade,
  usage_date date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  requests_count integer not null default 0 check (requests_count >= 0),
  tokens_used bigint not null default 0 check (tokens_used >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_uid, usage_date)
);

-- 6. Notification preferences, templates, outbox, delivery logs, audit & idempotency
create table if not exists public.notification_preferences (
  user_uid text primary key references public.profiles(firebase_uid) on delete cascade,
  teacher_approval_email boolean not null default true,
  quiz_assigned_email boolean not null default true,
  exam_reminder_email boolean not null default true,
  exam_result_email boolean not null default true,
  system_email boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_templates (
  code text primary key,
  subject_template text not null,
  html_template text not null,
  updated_at timestamptz not null default now()
);

insert into public.notification_templates(code, subject_template, html_template) values
  ('teacher_approval', '[Qizzone] Cập nhật yêu cầu quyền giáo viên', '<p>Xin chào {{fullName}},</p><p>Yêu cầu quyền giáo viên của bạn đã chuyển sang trạng thái: <strong>{{decision}}</strong>.</p><p>Đăng nhập vào Qizzone để xem chi tiết.</p>'),
  ('quiz_assigned', '[Qizzone] Bạn có đề thi mới: {{quizTitle}}', '<p>Xin chào,</p><p>Giáo viên vừa giao đề thi <strong>{{quizTitle}}</strong> trên Qizzone. Đăng nhập để làm bài.</p>'),
  ('schedule_changed', '[Qizzone] Cập nhật lịch thi: {{quizTitle}}', '<p>Lịch thi của đề <strong>{{quizTitle}}</strong> đã được cập nhật ({{scheduledTime}}). Đăng nhập vào Qizzone để xem.</p>'),
  ('exam_reminder', '[Qizzone] Nhắc lịch thi sắp diễn ra: {{quizTitle}}', '<p>Bài thi <strong>{{quizTitle}}</strong> sẽ diễn ra vào {{scheduledTime}}. Hãy chuẩn bị và đăng nhập Qizzone đúng giờ.</p>'),
  ('exam_result', '[Qizzone] Đã có kết quả bài thi: {{quizTitle}}', '<p>Bài làm của bạn cho đề <strong>{{quizTitle}}</strong> đã được chấm. Đăng nhập vào Qizzone để xem kết quả.</p>'),
  ('system_notice', '[Qizzone] Thông báo hệ thống', '<p>{{message}}</p>'),
  ('security_alert', '[Qizzone] Cảnh báo bảo mật tài khoản', '<p>{{message}}</p>')
on conflict (code) do nothing;

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  recipient_uid text not null references public.profiles(firebase_uid) on delete cascade,
  recipient_email text not null,
  event_type text not null check (event_type in (
    'teacher_approval','quiz_assigned','schedule_changed','exam_reminder_24h','exam_reminder_1h','exam_result','system_notice','security_alert'
  )),
  template_code text not null references public.notification_templates(code),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  idempotency_key text not null unique,
  scheduled_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','processing','sent','retry','dead_letter','skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outbox_dispatch_idx
  on public.notification_outbox(status, scheduled_at, next_attempt_at);

create table if not exists public.notification_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.notification_outbox(id) on delete cascade,
  provider text not null default 'resend',
  provider_message_id text,
  status text not null,
  error_message text,
  delivered_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_uid text,
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists public.idempotency_keys (
  scope text not null,
  actor_uid text not null,
  idempotency_key text not null,
  response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (scope, actor_uid, idempotency_key)
);

-- 7. Enable RLS everywhere & enforce strict ownership / role policies
alter table public.user_roles enable row level security;
alter table public.teacher_requests enable row level security;
alter table public.role_audit_logs enable row level security;
alter table public.quiz_assignments enable row level security;
alter table public.quiz_versions enable row level security;
alter table public.exam_rooms enable row level security;
alter table public.materials enable row level security;
alter table public.ai_extraction_jobs enable row level security;
alter table public.ai_usage_daily enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_templates enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.notification_delivery_logs enable row level security;
alter table public.audit_logs enable row level security;
alter table public.idempotency_keys enable row level security;

revoke all on
  public.user_roles,
  public.teacher_requests,
  public.role_audit_logs,
  public.quiz_assignments,
  public.quiz_versions,
  public.exam_rooms,
  public.materials,
  public.ai_extraction_jobs,
  public.ai_usage_daily,
  public.notification_preferences,
  public.notification_templates,
  public.notification_outbox,
  public.notification_delivery_logs,
  public.audit_logs,
  public.idempotency_keys
from public, anon, authenticated;

grant select on public.user_roles, public.teacher_requests, public.materials, public.ai_extraction_jobs, public.ai_usage_daily, public.notification_preferences, public.notification_outbox, public.exam_rooms to authenticated;
grant insert, update on public.notification_preferences to authenticated;
grant insert, update on public.materials to authenticated;
grant all on
  public.user_roles,
  public.teacher_requests,
  public.role_audit_logs,
  public.quiz_assignments,
  public.quiz_versions,
  public.exam_rooms,
  public.materials,
  public.ai_extraction_jobs,
  public.ai_usage_daily,
  public.notification_preferences,
  public.notification_templates,
  public.notification_outbox,
  public.notification_delivery_logs,
  public.audit_logs,
  public.idempotency_keys
to service_role;

create policy user_roles_read on public.user_roles
  for select to authenticated
  using (user_uid = public.current_uid() or public.has_role(array['admin']));

create policy teacher_requests_read on public.teacher_requests
  for select to authenticated
  using (user_uid = public.current_uid() or public.has_role(array['admin']));

create policy role_audit_admin_read on public.role_audit_logs
  for select to authenticated
  using (public.has_role(array['admin']));

create policy exam_rooms_read on public.exam_rooms
  for select to authenticated
  using (public.can_read_quiz(quiz_id));

create policy materials_owner_read on public.materials
  for select to authenticated
  using (owner_uid = public.current_uid() or public.has_role(array['admin']));

create policy materials_owner_insert on public.materials
  for insert to authenticated
  with check (owner_uid = public.current_uid() and public.has_role(array['teacher','admin']));

create policy materials_owner_update on public.materials
  for update to authenticated
  using (owner_uid = public.current_uid() and public.has_role(array['teacher','admin']))
  with check (owner_uid = public.current_uid() and public.has_role(array['teacher','admin']));

create policy ai_jobs_owner_read on public.ai_extraction_jobs
  for select to authenticated
  using (owner_uid = public.current_uid() or public.has_role(array['admin']));

create policy ai_usage_owner_read on public.ai_usage_daily
  for select to authenticated
  using (user_uid = public.current_uid() or public.has_role(array['admin']));

create policy notif_prefs_owner_select on public.notification_preferences
  for select to authenticated
  using (user_uid = public.current_uid());

create policy notif_prefs_owner_insert on public.notification_preferences
  for insert to authenticated
  with check (user_uid = public.current_uid());

create policy notif_prefs_owner_update on public.notification_preferences
  for update to authenticated
  using (user_uid = public.current_uid())
  with check (user_uid = public.current_uid());

create policy notif_outbox_owner_read on public.notification_outbox
  for select to authenticated
  using (recipient_uid = public.current_uid() or public.has_role(array['admin']));

-- 8. V3 RPCs: Idempotent exam finalization, daily AI usage tracking & notification helpers
create or replace function public.finalize_exam_attempt(
  p_attempt_id uuid,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.exam_attempts;
  r public.exam_results;
  cached jsonb;
  already_submitted boolean;
  filtered_result jsonb;
  response jsonb;
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

  select * into a from public.exam_attempts where id = p_attempt_id and student_uid = public.current_uid() for update;
  if not found or not public.has_role(array['student']) then
    raise exception 'Không có quyền';
  end if;

  already_submitted := a.submitted_at is not null;
  if not already_submitted then
    perform private.finalize_attempt(p_attempt_id);
  end if;

  select * into r from public.exam_results where attempt_id = p_attempt_id;
  filtered_result := r.payload || jsonb_build_object(
    'details',
    case when a.allow_review then r.payload->'details' else '[]'::jsonb end
  );

  response := jsonb_build_object(
    'score', coalesce((filtered_result->>'score')::numeric, 0),
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

create or replace function public.consume_ai_quota_v3(
  p_uid text,
  p_daily_limit integer default 100
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  minute_ok boolean;
  today_vn date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  daily_hits integer;
begin
  minute_ok := public.consume_ai_quota(p_uid);
  if not minute_ok then
    return false;
  end if;

  insert into public.ai_usage_daily(user_uid, usage_date, requests_count, updated_at)
  values (p_uid, today_vn, 1, now())
  on conflict (user_uid, usage_date) do update
    set requests_count = public.ai_usage_daily.requests_count + 1,
        updated_at = now()
  returning requests_count into daily_hits;

  return daily_hits <= p_daily_limit;
end
$$;

create or replace function public.update_notification_preferences(p_prefs jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid text := public.current_uid();
  saved public.notification_preferences;
begin
  if uid is null then raise exception 'Chưa đăng nhập'; end if;
  insert into public.notification_preferences(
    user_uid,
    teacher_approval_email,
    quiz_assigned_email,
    exam_reminder_email,
    exam_result_email,
    system_email,
    updated_at
  ) values (
    uid,
    coalesce((p_prefs->>'teacherApprovalEmail')::boolean, true),
    coalesce((p_prefs->>'quizAssignedEmail')::boolean, true),
    coalesce((p_prefs->>'examReminderEmail')::boolean, true),
    coalesce((p_prefs->>'examResultEmail')::boolean, true),
    coalesce((p_prefs->>'systemEmail')::boolean, true),
    now()
  )
  on conflict (user_uid) do update set
    teacher_approval_email = coalesce((p_prefs->>'teacherApprovalEmail')::boolean, public.notification_preferences.teacher_approval_email),
    quiz_assigned_email = coalesce((p_prefs->>'quizAssignedEmail')::boolean, public.notification_preferences.quiz_assigned_email),
    exam_reminder_email = coalesce((p_prefs->>'examReminderEmail')::boolean, public.notification_preferences.exam_reminder_email),
    exam_result_email = coalesce((p_prefs->>'examResultEmail')::boolean, public.notification_preferences.exam_result_email),
    system_email = coalesce((p_prefs->>'systemEmail')::boolean, public.notification_preferences.system_email),
    updated_at = now()
  returning * into saved;

  return jsonb_build_object(
    'userId', saved.user_uid,
    'teacherApprovalEmail', saved.teacher_approval_email,
    'quizAssignedEmail', saved.quiz_assigned_email,
    'examReminderEmail', saved.exam_reminder_email,
    'examResultEmail', saved.exam_result_email,
    'systemEmail', saved.system_email,
    'updatedAt', saved.updated_at
  );
end
$$;

create or replace function public.enqueue_notification(
  p_recipient_uid text,
  p_event_type text,
  p_template_code text,
  p_payload jsonb,
  p_idempotency_key text,
  p_scheduled_at timestamptz default now()
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  rec_email text;
  prefs public.notification_preferences;
  allowed boolean := true;
  outbox_id uuid;
begin
  select email into rec_email from public.profiles where firebase_uid = p_recipient_uid;
  if not found then
    return null;
  end if;

  if p_event_type <> 'security_alert' then
    select * into prefs from public.notification_preferences where user_uid = p_recipient_uid;
    if found then
      allowed := case p_event_type
        when 'teacher_approval' then prefs.teacher_approval_email
        when 'quiz_assigned' then prefs.quiz_assigned_email
        when 'schedule_changed' then prefs.quiz_assigned_email
        when 'exam_reminder_24h' then prefs.exam_reminder_email
        when 'exam_reminder_1h' then prefs.exam_reminder_email
        when 'exam_result' then prefs.exam_result_email
        when 'system_notice' then prefs.system_email
        else true
      end;
    end if;
  end if;

  insert into public.notification_outbox(
    recipient_uid, recipient_email, event_type, template_code, payload, idempotency_key, scheduled_at, status
  ) values (
    p_recipient_uid,
    rec_email,
    p_event_type,
    p_template_code,
    coalesce(p_payload, '{}'::jsonb),
    p_idempotency_key,
    coalesce(p_scheduled_at, now()),
    case when allowed then 'pending' else 'skipped' end
  )
  on conflict (idempotency_key) do nothing
  returning id into outbox_id;

  if outbox_id is null then
    select id into outbox_id from public.notification_outbox where idempotency_key = p_idempotency_key;
  end if;
  return outbox_id;
end
$$;

revoke execute on function public.finalize_exam_attempt(uuid, text) from public, anon;
grant execute on function public.finalize_exam_attempt(uuid, text) to authenticated;

revoke execute on function public.update_notification_preferences(jsonb) from public, anon;
grant execute on function public.update_notification_preferences(jsonb) to authenticated;

revoke execute on function public.consume_ai_quota_v3(text, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_quota_v3(text, integer) to service_role;

revoke execute on function public.enqueue_notification(text, text, text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.enqueue_notification(text, text, text, jsonb, text, timestamptz) to service_role;
