-- Teacher registrations are blocked until an approved admin updates both this
-- server-side status and the matching Firebase custom claims.
alter table public.profiles
  add column if not exists approval_status text not null default 'approved',
  add column if not exists approval_requested_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text references public.profiles(firebase_uid);

alter table public.profiles
  add constraint profiles_approval_status_check
  check (approval_status in ('approved', 'pending', 'rejected'));

create index if not exists profiles_pending_teacher
  on public.profiles(approval_status, created_at)
  where role = 'teacher';

-- A stale or forged app_role is insufficient: the database profile must also
-- be approved and match the role carried by the verified Firebase token.
create or replace function public.has_role(roles text[]) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.profiles
    where firebase_uid = public.current_uid()
      and approval_status = 'approved'
      and role = public.app_role()
      and role = any(roles)
  )
$$;
