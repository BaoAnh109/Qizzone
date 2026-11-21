-- Support safe one-time migration of verified legacy Firebase UID profiles to Supabase Auth UUIDs.

alter table public.quizzes
  drop constraint if exists quizzes_teacher_uid_fkey,
  add constraint quizzes_teacher_uid_fkey
    foreign key (teacher_uid) references public.profiles(firebase_uid) on update cascade;

alter table public.exam_attempts
  drop constraint if exists exam_attempts_student_uid_fkey,
  add constraint exam_attempts_student_uid_fkey
    foreign key (student_uid) references public.profiles(firebase_uid) on update cascade;

alter table public.practice_sessions
  drop constraint if exists practice_sessions_student_uid_fkey,
  add constraint practice_sessions_student_uid_fkey
    foreign key (student_uid) references public.profiles(firebase_uid) on update cascade;

alter table public.data_migrations
  drop constraint if exists data_migrations_firebase_uid_fkey,
  add constraint data_migrations_firebase_uid_fkey
    foreign key (firebase_uid) references public.profiles(firebase_uid) on update cascade;

alter table public.profiles
  drop constraint if exists profiles_reviewed_by_fkey,
  add constraint profiles_reviewed_by_fkey
    foreign key (reviewed_by) references public.profiles(firebase_uid) on update cascade;

alter table public.profiles
  drop constraint if exists profiles_teacher_reviewed_by_fkey,
  add constraint profiles_teacher_reviewed_by_fkey
    foreign key (teacher_reviewed_by) references public.profiles(firebase_uid) on update cascade;

alter table public.user_roles
  drop constraint if exists user_roles_user_uid_fkey,
  add constraint user_roles_user_uid_fkey
    foreign key (user_uid) references public.profiles(firebase_uid) on update cascade on delete cascade;

alter table public.teacher_requests
  drop constraint if exists teacher_requests_user_uid_fkey,
  add constraint teacher_requests_user_uid_fkey
    foreign key (user_uid) references public.profiles(firebase_uid) on update cascade on delete cascade;

alter table public.teacher_requests
  drop constraint if exists teacher_requests_reviewed_by_fkey,
  add constraint teacher_requests_reviewed_by_fkey
    foreign key (reviewed_by) references public.profiles(firebase_uid) on update cascade;

alter table public.materials
  drop constraint if exists materials_owner_uid_fkey,
  add constraint materials_owner_uid_fkey
    foreign key (owner_uid) references public.profiles(firebase_uid) on update cascade on delete cascade;

alter table public.ai_extraction_jobs
  drop constraint if exists ai_extraction_jobs_owner_uid_fkey,
  add constraint ai_extraction_jobs_owner_uid_fkey
    foreign key (owner_uid) references public.profiles(firebase_uid) on update cascade on delete cascade;

alter table public.ai_usage_daily
  drop constraint if exists ai_usage_daily_user_uid_fkey,
  add constraint ai_usage_daily_user_uid_fkey
    foreign key (user_uid) references public.profiles(firebase_uid) on update cascade on delete cascade;

alter table public.notification_preferences
  drop constraint if exists notification_preferences_user_uid_fkey,
  add constraint notification_preferences_user_uid_fkey
    foreign key (user_uid) references public.profiles(firebase_uid) on update cascade on delete cascade;

alter table public.notification_outbox
  drop constraint if exists notification_outbox_recipient_uid_fkey,
  add constraint notification_outbox_recipient_uid_fkey
    foreign key (recipient_uid) references public.profiles(firebase_uid) on update cascade on delete cascade;

create or replace function public.relink_legacy_profile_v3(
  p_email text,
  p_new_uid uuid
) returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_uid text;
  v_row public.profiles;
begin
  select p.firebase_uid into v_old_uid
  from public.profiles p
  where lower(p.email) = lower(btrim(p_email))
    and p.firebase_uid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  for update;

  if not found then
    return null;
  end if;

  update public.profiles
  set firebase_uid = p_new_uid::text,
      id = p_new_uid,
      updated_at = now()
  where firebase_uid = v_old_uid
  returning * into v_row;

  update public.role_audit_logs
  set actor_uid = p_new_uid::text
  where actor_uid = v_old_uid;

  update public.role_audit_logs
  set target_uid = p_new_uid::text
  where target_uid = v_old_uid;

  update public.quiz_versions
  set created_by = p_new_uid::text
  where created_by = v_old_uid;

  return v_row;
end
$$;

revoke all on function public.relink_legacy_profile_v3(text, uuid) from public, anon, authenticated;
grant execute on function public.relink_legacy_profile_v3(text, uuid) to service_role;
