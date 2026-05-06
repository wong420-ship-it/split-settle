WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY session_id ORDER BY created_at ASC) AS rn
  FROM public.session_users
  WHERE display_name LIKE '% (host)'
)
DELETE FROM public.item_claims
WHERE user_id IN (SELECT id FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY session_id ORDER BY created_at ASC) AS rn
  FROM public.session_users
  WHERE display_name LIKE '% (host)'
)
DELETE FROM public.session_users
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);