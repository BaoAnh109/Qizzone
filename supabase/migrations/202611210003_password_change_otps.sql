-- Store short-lived (15-minute) hashed OTPs for verified password changes.
create table if not exists private.password_change_otps (
  id uuid primary key default gen_random_uuid(),
  user_uid text not null,
  otp_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_change_otps_uid_created_idx
  on private.password_change_otps(user_uid, created_at desc);

alter table private.password_change_otps enable row level security;
revoke all on private.password_change_otps from public, anon, authenticated;
grant all on private.password_change_otps to service_role;

create or replace function public.create_password_change_otp_v3(
  p_uid text,
  p_otp_hash text,
  p_ttl_seconds integer default 900,
  p_cooldown_seconds integer default 60
) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz;
  v_ttl integer := greatest(60, least(3600, coalesce(p_ttl_seconds, 900)));
  v_cooldown integer := greatest(0, least(300, coalesce(p_cooldown_seconds, 60)));
begin
  if coalesce(length(btrim(p_uid)), 0) = 0 or coalesce(length(btrim(p_otp_hash)), 0) = 0 then
    raise exception 'INVALID_INPUT';
  end if;

  if exists (
    select 1
    from private.password_change_otps o
    where o.user_uid = p_uid
      and o.created_at > now() - make_interval(secs => v_cooldown)
  ) then
    raise exception 'RATE_LIMIT';
  end if;

  delete from private.password_change_otps
  where user_uid = p_uid
    and used_at is null;

  v_expires := now() + make_interval(secs => v_ttl);
  insert into private.password_change_otps (user_uid, otp_hash, expires_at)
  values (p_uid, p_otp_hash, v_expires);

  return v_expires;
end
$$;

create or replace function public.verify_password_change_otp_v3(
  p_uid text,
  p_otp_hash text,
  p_max_attempts integer default 5
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row private.password_change_otps;
  v_limit integer := greatest(1, least(20, coalesce(p_max_attempts, 5)));
begin
  select *
  into v_row
  from private.password_change_otps o
  where o.user_uid = p_uid
    and o.used_at is null
  order by o.created_at desc
  limit 1
  for update;

  if not found then
    return 'missing';
  end if;

  if now() > v_row.expires_at then
    update private.password_change_otps
    set used_at = now()
    where id = v_row.id;
    return 'expired';
  end if;

  if v_row.attempts >= v_limit then
    update private.password_change_otps
    set used_at = now()
    where id = v_row.id;
    return 'too_many_attempts';
  end if;

  if v_row.otp_hash <> p_otp_hash then
    update private.password_change_otps
    set attempts = attempts + 1,
        used_at = case when attempts + 1 >= v_limit then now() else null end
    where id = v_row.id;
    return 'invalid';
  end if;

  update private.password_change_otps
  set used_at = now()
  where id = v_row.id;

  return 'ok';
end
$$;

revoke execute on function public.create_password_change_otp_v3(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.create_password_change_otp_v3(text, text, integer, integer) to service_role;

revoke execute on function public.verify_password_change_otp_v3(text, text, integer) from public, anon, authenticated;
grant execute on function public.verify_password_change_otp_v3(text, text, integer) to service_role;
