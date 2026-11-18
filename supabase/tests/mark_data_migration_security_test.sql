BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;
SELECT plan(9);

INSERT INTO public.profiles (firebase_uid, email, full_name, role, approval_status)
VALUES (
  'pgtap-migration-marker-student',
  'pgtap-migration-marker@example.test',
  'Migration Marker Test Student',
  'student',
  'approved'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"pgtap-migration-marker-student","role":"authenticated","app_role":"student"}',
  true
);

SELECT lives_ok(
  $$SELECT public.mark_data_migration('legacy-browser-v1', 'partial', '{"quizzes":2}'::jsonb)$$,
  'the supported browser migration marker can be recorded'
);
SELECT is(
  (SELECT count(*)::integer FROM public.data_migrations WHERE firebase_uid = 'pgtap-migration-marker-student'),
  1,
  'the first marker creates one row for the current user'
);
SELECT lives_ok(
  $$SELECT public.mark_data_migration('legacy-browser-v1', 'completed', '{"quizzes":2,"success":2}'::jsonb)$$,
  'the supported marker can be updated to completed'
);
SELECT is(
  (SELECT status FROM public.data_migrations WHERE firebase_uid = 'pgtap-migration-marker-student'),
  'completed',
  'the existing marker is updated rather than duplicated'
);
SELECT throws_ok(
  $$SELECT public.mark_data_migration('arbitrary-source', 'partial', '{}'::jsonb)$$,
  'P0001',
  'Nguồn migration không hợp lệ',
  'arbitrary source identifiers are rejected'
);
SELECT throws_ok(
  $$SELECT public.mark_data_migration('legacy-browser-v1', 'failed', '{}'::jsonb)$$,
  'P0001',
  'Trạng thái migration không hợp lệ',
  'unsupported marker states are rejected'
);
SELECT throws_ok(
  $$SELECT public.mark_data_migration('legacy-browser-v1', 'partial', jsonb_build_object('detail', repeat('x', 65537)))$$,
  'P0001',
  'Báo cáo migration không hợp lệ hoặc vượt quá giới hạn',
  'oversized marker reports are rejected'
);
SELECT throws_ok(
  $$SELECT public.mark_data_migration('legacy-browser-v1', 'partial', '[]'::jsonb)$$,
  'P0001',
  'Báo cáo migration không hợp lệ hoặc vượt quá giới hạn',
  'non-object marker reports are rejected'
);

SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.mark_data_migration('legacy-browser-v1', 'partial', '{}'::jsonb)$$,
  'P0001',
  'Chưa đăng nhập',
  'marker writes require a Firebase user identity'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
