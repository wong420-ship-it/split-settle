-- Restrict DELETE on session_users and item_claims to the session host.
-- INSERT/UPDATE remain open to support the anonymous guest flow (join, claim/unclaim, mark paid).

DROP POLICY IF EXISTS "Anyone can delete session users" ON public.session_users;
DROP POLICY IF EXISTS "Anyone can delete claims" ON public.item_claims;

CREATE POLICY "Host can delete session users"
ON public.session_users
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.bill_sessions s
    WHERE s.id = session_users.session_id
      AND s.host_id = auth.uid()
  )
);

CREATE POLICY "Host can delete claims"
ON public.item_claims
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.bill_items i
    JOIN public.bill_sessions s ON s.id = i.session_id
    WHERE i.id = item_claims.item_id
      AND s.host_id = auth.uid()
  )
);