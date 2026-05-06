ALTER TABLE public.session_users ADD COLUMN paid_at timestamptz;
ALTER PUBLICATION supabase_realtime SET (publish = 'insert, update, delete');