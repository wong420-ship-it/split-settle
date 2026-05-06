CREATE TABLE public.item_claims (
  item_id UUID NOT NULL,
  user_id UUID NOT NULL,
  claimed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, user_id)
);

ALTER TABLE public.item_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read claims" ON public.item_claims FOR SELECT USING (true);
CREATE POLICY "Anyone can add claims" ON public.item_claims FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete claims" ON public.item_claims FOR DELETE USING (true);

CREATE INDEX idx_item_claims_item ON public.item_claims(item_id);
CREATE INDEX idx_item_claims_user ON public.item_claims(user_id);

-- Migrate existing single-claim rows
INSERT INTO public.item_claims (item_id, user_id, claimed_at)
SELECT id, claimed_by_user_id, COALESCE(claimed_at, now())
FROM public.bill_items
WHERE claimed_by_user_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE public.bill_items DROP COLUMN claimed_by_user_id;
ALTER TABLE public.bill_items DROP COLUMN claimed_at;

ALTER PUBLICATION supabase_realtime ADD TABLE public.item_claims;
ALTER TABLE public.item_claims REPLICA IDENTITY FULL;