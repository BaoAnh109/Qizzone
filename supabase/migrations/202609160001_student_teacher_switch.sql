-- New accounts remain students. Teacher access is a separate, admin-reviewed
-- capability that can be activated in Firebase custom claims at switch time.
alter table public.profiles
  add column if not exists teacher_request_status text not null default 'none',
  add column if not exists teacher_request_blocked boolean not null default false,
  add column if not exists teacher_requested_at timestamptz,
  add column if not exists teacher_reviewed_at timestamptz,
  add column if not exists teacher_reviewed_by text references public.profiles(firebase_uid);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_teacher_request_status_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_teacher_request_status_check
      check (teacher_request_status in ('none', 'pending', 'approved', 'rejected'));
  end if;
end $$;

-- Preserve the old teacher-registration records while making their access state
-- explicit. Student rows remain eligible to request access later.
update public.profiles
set teacher_request_status = case
  when role = 'teacher' and approval_status = 'approved' then 'approved'
  when role = 'teacher' and approval_status = 'pending' then 'pending'
  when role = 'teacher' and approval_status = 'rejected' then 'rejected'
  else 'none'
end
where teacher_request_status = 'none' and role = 'teacher';

create index if not exists profiles_pending_teacher_request
  on public.profiles(teacher_request_status, teacher_requested_at)
  where role = 'student' and teacher_request_status = 'pending';

-- A teacher claim is valid for either a legacy teacher profile or a student
-- profile whose teacher access request was approved. The profile still has to
-- be approved, so stale Firebase claims cannot bypass an admin decision.
create or replace function public.has_role(roles text[]) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.profiles
    where firebase_uid = public.current_uid()
      and approval_status = 'approved'
      and public.app_role() = any(roles)
      and (
        role = public.app_role()
        or (
          role = 'student'
          and public.app_role() = 'teacher'
          and teacher_request_status = 'approved'
        )
      )
  )
$$;
