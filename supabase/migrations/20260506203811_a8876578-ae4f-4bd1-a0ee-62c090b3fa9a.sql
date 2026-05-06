-- Clean orphans
DELETE FROM public.item_claims
WHERE item_id NOT IN (SELECT id FROM public.bill_items)
   OR user_id NOT IN (SELECT id FROM public.session_users);
DELETE FROM public.bill_items
WHERE session_id NOT IN (SELECT id FROM public.bill_sessions);
DELETE FROM public.session_users
WHERE session_id NOT IN (SELECT id FROM public.bill_sessions);

-- Drop existing FKs if present, then recreate with CASCADE
ALTER TABLE public.bill_items DROP CONSTRAINT IF EXISTS bill_items_session_id_fkey;
ALTER TABLE public.bill_items
  ADD CONSTRAINT bill_items_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES public.bill_sessions(id) ON DELETE CASCADE;

ALTER TABLE public.session_users DROP CONSTRAINT IF EXISTS session_users_session_id_fkey;
ALTER TABLE public.session_users
  ADD CONSTRAINT session_users_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES public.bill_sessions(id) ON DELETE CASCADE;

ALTER TABLE public.item_claims DROP CONSTRAINT IF EXISTS item_claims_item_id_fkey;
ALTER TABLE public.item_claims
  ADD CONSTRAINT item_claims_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES public.bill_items(id) ON DELETE CASCADE;

ALTER TABLE public.item_claims DROP CONSTRAINT IF EXISTS item_claims_user_id_fkey;
ALTER TABLE public.item_claims
  ADD CONSTRAINT item_claims_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.session_users(id) ON DELETE CASCADE;