
-- share_code generator
CREATE OR REPLACE FUNCTION public.generate_share_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, 1 + floor(random() * length(chars))::int, 1);
  END LOOP;
  RETURN result;
END;
$$;

CREATE TABLE public.bill_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_name text NOT NULL DEFAULT 'My Bill',
  tax_amount numeric NOT NULL DEFAULT 0,
  tip_percentage numeric NOT NULL DEFAULT 18,
  share_code text NOT NULL UNIQUE DEFAULT public.generate_share_code(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.session_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.bill_sessions(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.bill_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.bill_sessions(id) ON DELETE CASCADE,
  name text NOT NULL,
  price numeric NOT NULL,
  claimed_by_user_id uuid REFERENCES public.session_users(id) ON DELETE SET NULL,
  claimed_at timestamptz
);

CREATE INDEX idx_session_users_session ON public.session_users(session_id);
CREATE INDEX idx_bill_items_session ON public.bill_items(session_id);
CREATE INDEX idx_bill_sessions_share_code ON public.bill_sessions(share_code);

ALTER TABLE public.bill_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_items ENABLE ROW LEVEL SECURITY;

-- bill_sessions
CREATE POLICY "Anyone can read sessions" ON public.bill_sessions
  FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create their own sessions" ON public.bill_sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Host can update own sessions" ON public.bill_sessions
  FOR UPDATE TO authenticated USING (auth.uid() = host_id);
CREATE POLICY "Host can delete own sessions" ON public.bill_sessions
  FOR DELETE TO authenticated USING (auth.uid() = host_id);

-- session_users (permissive for MVP)
CREATE POLICY "Anyone can read session users" ON public.session_users
  FOR SELECT USING (true);
CREATE POLICY "Anyone can join a session" ON public.session_users
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update session users" ON public.session_users
  FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete session users" ON public.session_users
  FOR DELETE USING (true);

-- bill_items (permissive for MVP)
CREATE POLICY "Anyone can read items" ON public.bill_items
  FOR SELECT USING (true);
CREATE POLICY "Anyone can add items" ON public.bill_items
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update items" ON public.bill_items
  FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete items" ON public.bill_items
  FOR DELETE USING (true);

-- realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.bill_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.session_users;
