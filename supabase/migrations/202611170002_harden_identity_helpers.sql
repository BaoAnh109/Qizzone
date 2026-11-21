-- Pin helper functions to pg_catalog plus their schema-qualified dependencies.
-- This removes mutable search_path behavior without changing their result.
ALTER FUNCTION public.current_uid() SET search_path = '';
ALTER FUNCTION public.app_role() SET search_path = '';
