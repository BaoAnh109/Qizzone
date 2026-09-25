-- Assigning an existing exam only changes its audience. Keep it independent
-- from save_quiz so quizzes with existing attempts can still be distributed.
create function public.set_quiz_assignments(
  p_id uuid,
  p_assigned_classes text[],
  p_assigned_emails text[]
) returns void
language plpgsql security definer set search_path='' as $$
declare
  class_values jsonb;
  email_values jsonb;
begin
  if not public.has_role(array['teacher','admin']) then
    raise exception 'Chỉ giáo viên được giao đề';
  end if;
  if p_id is null or not public.owns_quiz(p_id) then
    raise exception 'Không có quyền giao đề';
  end if;
  if p_assigned_classes is null or p_assigned_emails is null then
    raise exception 'Danh sách lớp hoặc email không hợp lệ';
  end if;
  if cardinality(p_assigned_classes) > 500 or cardinality(p_assigned_emails) > 5000 then
    raise exception 'Danh sách giao đề quá dài';
  end if;
  if exists (
    select 1 from unnest(p_assigned_classes) as requested(value)
    where length(btrim(value)) > 100
  ) then
    raise exception 'Tên lớp không được vượt quá 100 ký tự';
  end if;
  if exists (
    select 1 from unnest(p_assigned_emails) as requested(value)
    where length(btrim(value)) > 320 or (btrim(value) <> '' and position('@' in btrim(value)) = 0)
  ) then
    raise exception 'Email học sinh không hợp lệ';
  end if;

  select coalesce(jsonb_agg(to_jsonb(item) order by first_position), '[]'::jsonb)
  into class_values
  from (
    select distinct on (lower(btrim(requested.value)))
      btrim(requested.value) as item,
      requested.position as first_position
    from unnest(p_assigned_classes) with ordinality as requested(value, position)
    where nullif(btrim(requested.value), '') is not null
    order by lower(btrim(requested.value)), requested.position
  ) normalized_classes;

  select coalesce(jsonb_agg(to_jsonb(item) order by first_position), '[]'::jsonb)
  into email_values
  from (
    select distinct on (lower(btrim(requested.value)))
      lower(btrim(requested.value)) as item,
      requested.position as first_position
    from unnest(p_assigned_emails) with ordinality as requested(value, position)
    where nullif(btrim(requested.value), '') is not null
    order by lower(btrim(requested.value)), requested.position
  ) normalized_emails;

  update public.quizzes
  set settings = settings || jsonb_build_object(
        'assignedClasses', class_values,
        'assignedEmails', email_values
      ),
      updated_at = now()
  where id = p_id;
end
$$;

revoke execute on function public.set_quiz_assignments(uuid,text[],text[]) from public, anon;
grant execute on function public.set_quiz_assignments(uuid,text[],text[]) to authenticated;
