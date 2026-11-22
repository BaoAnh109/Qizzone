-- M1: In-App Notifications, Bug Reports & Covering Indexes for Unindexed Foreign Keys
-- 100% PGlite-compatible: guards supabase_realtime publication, uses public.current_uid() / public.has_role().

-- 1. In-App Notifications
create table if not exists public.in_app_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_uid text not null references public.profiles(firebase_uid) on update cascade on delete cascade,
  actor_uid text null references public.profiles(firebase_uid) on update cascade on delete set null,
  type text not null check (length(btrim(type)) between 1 and 80),
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null check (length(btrim(body)) between 1 and 2000),
  target_route text not null check (length(btrim(target_route)) between 1 and 500),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  is_read boolean not null default false,
  read_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists in_app_notifications_recipient_idx
  on public.in_app_notifications(recipient_uid, is_read, created_at desc);

create index if not exists in_app_notifications_actor_idx
  on public.in_app_notifications(actor_uid);

alter table public.in_app_notifications enable row level security;
revoke all on public.in_app_notifications from public, anon, authenticated;
grant select, update (is_read, read_at) on public.in_app_notifications to authenticated;
grant all on public.in_app_notifications to service_role;

drop policy if exists in_app_notifications_select on public.in_app_notifications;
create policy in_app_notifications_select on public.in_app_notifications
  for select to authenticated
  using (recipient_uid = (select public.current_uid()));

drop policy if exists in_app_notifications_update on public.in_app_notifications;
create policy in_app_notifications_update on public.in_app_notifications
  for update to authenticated
  using (recipient_uid = (select public.current_uid()))
  with check (recipient_uid = (select public.current_uid()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'in_app_notifications'
     ) then
    alter publication supabase_realtime add table public.in_app_notifications;
  end if;
end $$;

-- Activate private notification emitter used by 202611220001 RPCs
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
declare
  v_id uuid;
begin
  if p_recipient_uid is null or btrim(p_recipient_uid) = '' then
    return null;
  end if;

  insert into public.in_app_notifications(
    recipient_uid, actor_uid, type, title, body, target_route, metadata
  ) values (
    p_recipient_uid,
    p_actor_uid,
    left(btrim(p_type), 80),
    left(btrim(p_title), 200),
    left(btrim(p_body), 2000),
    left(btrim(p_target_route), 500),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end
$$;

revoke execute on function private.emit_in_app_notification(text, text, text, text, text, text, jsonb)
  from public, anon, authenticated;

-- 2. Bug Reports (strictly aligned with domain status: new | in_progress | resolved)
create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_uid text not null references public.profiles(firebase_uid) on update cascade on delete cascade,
  reporter_role text not null check (reporter_role in ('student', 'teacher', 'admin')),
  title text not null check (length(btrim(title)) between 1 and 200),
  description text not null check (length(btrim(description)) between 1 and 5000),
  category text not null default 'general' check (length(btrim(category)) between 1 and 60),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  page_route text null check (page_route is null or length(page_route) <= 500),
  context_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(context_metadata) = 'object'),
  status text not null default 'new' check (status in ('new', 'in_progress', 'resolved')),
  admin_response text null check (admin_response is null or length(admin_response) <= 5000),
  handled_by text null references public.profiles(firebase_uid) on update cascade on delete set null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bug_reports_reporter_created_idx
  on public.bug_reports(reporter_uid, created_at desc);

create index if not exists bug_reports_status_created_idx
  on public.bug_reports(status, created_at desc);

create index if not exists bug_reports_handled_by_idx
  on public.bug_reports(handled_by);

alter table public.bug_reports enable row level security;
revoke all on public.bug_reports from public, anon, authenticated;
grant select on public.bug_reports to authenticated;
grant all on public.bug_reports to service_role;

drop policy if exists bug_reports_select on public.bug_reports;
create policy bug_reports_select on public.bug_reports
  for select to authenticated
  using (
    reporter_uid = (select public.current_uid())
    or (select public.has_role(array['admin']))
  );

-- 3. In-App Notifications & Bug Report RPCs
create or replace function public.list_my_notifications(
  p_limit integer default 30,
  p_unread_only boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid text := public.current_uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 100));
  v_unread integer;
  v_items jsonb;
begin
  if v_uid is null then
    raise exception 'Chưa đăng nhập';
  end if;

  select count(*)::integer into v_unread
  from public.in_app_notifications
  where recipient_uid = v_uid and not is_read;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'recipientUid', n.recipient_uid,
    'actorUid', n.actor_uid,
    'type', n.type,
    'title', n.title,
    'body', n.body,
    'targetRoute', n.target_route,
    'metadata', n.metadata,
    'isRead', n.is_read,
    'readAt', n.read_at,
    'createdAt', n.created_at
  ) order by n.created_at desc), '[]'::jsonb)
  into v_items
  from (
    select *
    from public.in_app_notifications
    where recipient_uid = v_uid
      and (not coalesce(p_unread_only, false) or not is_read)
    order by created_at desc
    limit v_limit
  ) n;

  return jsonb_build_object(
    'unreadCount', v_unread,
    'items', v_items
  );
end
$$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid text := public.current_uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Chưa đăng nhập';
  end if;

  update public.in_app_notifications
  set is_read = true,
      read_at = coalesce(read_at, now())
  where recipient_uid = v_uid
    and not is_read
    and (p_ids is null or id = any(p_ids));

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create or replace function private.bug_report_json(r public.bug_reports)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id,
    'reporterUid', r.reporter_uid,
    'reporterName', (select p.full_name from public.profiles p where p.firebase_uid = r.reporter_uid),
    'reporterEmail', (select p.email from public.profiles p where p.firebase_uid = r.reporter_uid),
    'reporterRole', r.reporter_role,
    'title', r.title,
    'description', r.description,
    'category', r.category,
    'severity', r.severity,
    'pageRoute', r.page_route,
    'contextMetadata', r.context_metadata,
    'status', r.status,
    'adminResponse', r.admin_response,
    'handledBy', r.handled_by,
    'resolvedAt', r.resolved_at,
    'createdAt', r.created_at,
    'updatedAt', r.updated_at
  )
$$;

revoke execute on function private.bug_report_json(public.bug_reports)
  from public, anon, authenticated;

create or replace function public.create_bug_report(
  p_title text,
  p_description text,
  p_category text default 'general',
  p_severity text default 'medium',
  p_page_route text default null,
  p_context_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid text := public.current_uid();
  v_role text;
  v_title text := btrim(coalesce(p_title, ''));
  v_desc text := btrim(coalesce(p_description, ''));
  v_cat text := coalesce(nullif(btrim(coalesce(p_category, '')), ''), 'general');
  v_sev text := coalesce(nullif(btrim(coalesce(p_severity, '')), ''), 'medium');
  v_report public.bug_reports;
  v_admin record;
  v_reporter_name text;
begin
  if v_uid is null then
    raise exception 'Chưa đăng nhập';
  end if;
  if not public.has_role(array['student', 'teacher', 'admin']) then
    raise exception 'Tài khoản chưa được phê duyệt để gửi báo lỗi';
  end if;

  if length(v_title) < 3 or length(v_title) > 200 then
    raise exception 'Tiêu đề báo lỗi phải từ 3 đến 200 ký tự';
  end if;
  if length(v_desc) < 10 or length(v_desc) > 5000 then
    raise exception 'Mô tả báo lỗi phải từ 10 đến 5000 ký tự';
  end if;
  if v_sev not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Mức độ nghiêm trọng không hợp lệ';
  end if;

  select full_name, role into v_reporter_name, v_role
  from public.profiles where firebase_uid = v_uid;

  v_role := case
    when public.app_role() in ('student', 'teacher', 'admin') then public.app_role()
    else coalesce(v_role, 'student')
  end;

  insert into public.bug_reports(
    reporter_uid, reporter_role, title, description, category, severity, page_route, context_metadata
  ) values (
    v_uid,
    v_role,
    v_title,
    v_desc,
    left(v_cat, 60),
    v_sev,
    case when p_page_route is not null then left(btrim(p_page_route), 500) else null end,
    case when jsonb_typeof(p_context_metadata) = 'object' then p_context_metadata else '{}'::jsonb end
  )
  returning * into v_report;

  for v_admin in
    select firebase_uid from public.profiles
    where role = 'admin' and approval_status = 'approved'
  loop
    perform private.emit_in_app_notification(
      v_admin.firebase_uid,
      v_uid,
      'bug_report_created',
      'Có phiếu báo lỗi mới',
      format('%s (%s): %s', coalesce(v_reporter_name, 'Người dùng'), v_role, v_title),
      '/admin/bug-reports?reportId=' || v_report.id::text,
      jsonb_build_object('reportId', v_report.id, 'severity', v_sev, 'reporterRole', v_role)
    );
  end loop;

  return private.bug_report_json(v_report);
end
$$;

create or replace function public.list_bug_reports(
  p_status text default null,
  p_role text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid text := public.current_uid();
  v_is_admin boolean := public.has_role(array['admin']);
  v_items jsonb;
begin
  if v_uid is null then
    raise exception 'Chưa đăng nhập';
  end if;
  if not public.has_role(array['student', 'teacher', 'admin']) then
    raise exception 'Không có quyền xem danh sách báo lỗi';
  end if;

  select coalesce(jsonb_agg(private.bug_report_json(r) order by r.created_at desc), '[]'::jsonb)
  into v_items
  from public.bug_reports r
  where (v_is_admin or r.reporter_uid = v_uid)
    and (p_status is null or btrim(p_status) = '' or r.status = btrim(p_status))
    and (p_role is null or btrim(p_role) = '' or r.reporter_role = btrim(p_role));

  return v_items;
end
$$;

create or replace function public.update_bug_report_status(
  p_report_id uuid,
  p_status text,
  p_admin_response text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid text := public.current_uid();
  v_report public.bug_reports;
  v_status text := btrim(coalesce(p_status, ''));
  v_status_label text;
begin
  if not public.has_role(array['admin']) then
    raise exception 'Chỉ quản trị viên mới có quyền xử lý báo lỗi';
  end if;
  if v_status not in ('new', 'in_progress', 'resolved') then
    raise exception 'Trạng thái xử lý báo lỗi không hợp lệ';
  end if;

  select * into v_report from public.bug_reports where id = p_report_id for update;
  if not found then
    raise exception 'Không tìm thấy phiếu báo lỗi';
  end if;

  update public.bug_reports
  set status = v_status,
      admin_response = case
        when p_admin_response is not null then left(btrim(p_admin_response), 5000)
        else admin_response
      end,
      handled_by = v_uid,
      resolved_at = case
        when v_status = 'resolved' then coalesce(resolved_at, now())
        else null
      end,
      updated_at = now()
  where id = p_report_id
  returning * into v_report;

  v_status_label := case v_status
    when 'new' then 'Mới'
    when 'in_progress' then 'Đang xử lý'
    else 'Đã giải quyết'
  end;

  perform private.emit_in_app_notification(
    v_report.reporter_uid,
    v_uid,
    'bug_report_updated',
    'Cập nhật xử lý báo lỗi',
    format('Phiếu "%s" đã chuyển sang trạng thái: %s.', v_report.title, v_status_label),
    '/' || v_report.reporter_role || '/bug-reports?reportId=' || v_report.id::text,
    jsonb_build_object('reportId', v_report.id, 'status', v_status)
  );

  return private.bug_report_json(v_report);
end
$$;

-- 4. Covering Indexes for Existing 8 Unindexed Foreign Keys (Supabase Performance Advisor)
create index if not exists ai_extraction_jobs_material_id_idx
  on public.ai_extraction_jobs(material_id);

create index if not exists exam_answers_question_id_idx
  on public.exam_answers(question_id);

create index if not exists notification_delivery_logs_outbox_id_idx
  on public.notification_delivery_logs(outbox_id);

create index if not exists notification_outbox_recipient_uid_idx
  on public.notification_outbox(recipient_uid);

create index if not exists notification_outbox_template_code_idx
  on public.notification_outbox(template_code);

create index if not exists profiles_reviewed_by_idx
  on public.profiles(reviewed_by);

create index if not exists profiles_teacher_reviewed_by_idx
  on public.profiles(teacher_reviewed_by);

create index if not exists teacher_requests_reviewed_by_idx
  on public.teacher_requests(reviewed_by);

-- 5. Execute Grants
revoke execute on function
  public.list_my_notifications(integer, boolean),
  public.mark_notifications_read(uuid[]),
  public.create_bug_report(text, text, text, text, text, jsonb),
  public.list_bug_reports(text, text),
  public.update_bug_report_status(uuid, text, text)
  from public, anon;

grant execute on function
  public.list_my_notifications(integer, boolean),
  public.mark_notifications_read(uuid[]),
  public.create_bug_report(text, text, text, text, text, jsonb),
  public.list_bug_reports(text, text),
  public.update_bug_report_status(uuid, text, text)
  to authenticated;
