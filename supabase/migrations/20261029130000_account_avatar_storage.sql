-- Public avatar reads are intentional; uploads are restricted to the authenticated Edge Function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'account-avatars',
  'account-avatars',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
