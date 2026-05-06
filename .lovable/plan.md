## Bug

When a host opens an old bill from history on a different device (or after clearing site data), `host.dashboard.tsx` cannot find the saved `seatsolo:host-guest:<sessionId>` key in `localStorage`, so it inserts a brand-new "(host)" row in `session_users` every visit. The screenshot shows three "Jonathan Wong (host)" entries from three opens.

There is also no DB-level uniqueness preventing duplicates, so multiple tabs / devices can each create their own.

## Fix

In `src/routes/host.dashboard.tsx`, before falling through to the insert path, check the already-loaded `guestList` for any existing guest whose `display_name` ends with `" (host)"`. If one exists, adopt it as the host's guest row and write its id back to `localStorage` so subsequent loads stay stable.

Logic added between the localStorage lookup and the insert block:

```ts
if (!existingHost) {
  existingHost = guestList.find((g) => / \(host\)$/.test(g.display_name)) ?? null;
  if (existingHost) {
    hostId = existingHost.id;
    localStorage.setItem(hostKey, existingHost.id);
  }
}
```

The existing insert path remains as a last resort for genuinely new sessions.

## Cleanup of existing duplicates

For sessions that already have multiple "(host)" rows (like the one in the screenshot), we keep the oldest one (matched by `created_at asc`) and delete the others, plus any `item_claims` they hold. Done as a one-shot SQL migration:

```sql
WITH ranked AS (
  SELECT id, session_id,
         row_number() OVER (PARTITION BY session_id
                            ORDER BY created_at ASC) AS rn
  FROM public.session_users
  WHERE display_name LIKE '% (host)'
)
DELETE FROM public.item_claims
WHERE user_id IN (SELECT id FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT id, session_id,
         row_number() OVER (PARTITION BY session_id
                            ORDER BY created_at ASC) AS rn
  FROM public.session_users
  WHERE display_name LIKE '% (host)'
)
DELETE FROM public.session_users
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
```

## Out of scope

- Adding a true DB unique constraint (would require a `is_host` column or similar schema change). The display-name check + localStorage is enough to stop the duplicates in practice.

## Files

- Edit: `src/routes/host.dashboard.tsx`
- New migration: cleanup duplicate "(host)" rows
