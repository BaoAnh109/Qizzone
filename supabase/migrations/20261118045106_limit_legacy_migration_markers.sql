-- The frontend only reports progress for its single legacy-browser importer.
-- Keep the marker RPC from accepting arbitrary IDs or unbounded caller payloads.
create or replace function public.mark_data_migration(
  p_source_id text,
  p_status text,
  p_report jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  caller_uid text := public.current_uid();
  report_value jsonb := coalesce(p_report, '{}'::jsonb);
begin
  if caller_uid is null or btrim(caller_uid) = '' then
    raise exception 'Chưa đăng nhập';
  end if;
  if p_source_id is distinct from 'legacy-browser-v1' then
    raise exception 'Nguồn migration không hợp lệ';
  end if;
  if p_status is null or p_status not in ('partial', 'completed') then
    raise exception 'Trạng thái migration không hợp lệ';
  end if;
  if jsonb_typeof(report_value) is distinct from 'object'
    or octet_length(report_value::text) > 65536 then
    raise exception 'Báo cáo migration không hợp lệ hoặc vượt quá giới hạn';
  end if;

  insert into public.data_migrations(firebase_uid, source_id, status, report, updated_at)
  values (caller_uid, p_source_id, p_status, report_value, now())
  on conflict (firebase_uid, source_id, version)
  do update set status = excluded.status,
                report = excluded.report,
                updated_at = excluded.updated_at;
end
$function$;
