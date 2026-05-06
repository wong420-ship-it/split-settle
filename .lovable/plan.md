## Goal
Allow multiple guests to share a single item (e.g. split fries 2-ways), with the cost divided evenly among everyone who claimed it.

## Data model change
Replace the single `claimed_by_user_id` column on `bill_items` with a many-to-many join table:

```text
item_claims
  item_id     uuid  -> bill_items.id (cascade delete)
  user_id     uuid  -> session_users.id (cascade delete)
  claimed_at  timestamptz default now()
  PRIMARY KEY (item_id, user_id)
```

RLS: same permissive "anyone can read/insert/delete" pattern already used on `bill_items` (no auth for guests). Add `item_claims` to the realtime publication.

We will drop `claimed_by_user_id` from `bill_items` after migrating any existing rows into `item_claims`.

## Claim screen behavior (`session.$code.claim.tsx`)
- Fetch claims alongside items; group by `item_id` to know who claimed each.
- A row shows up to N avatars/initials of claimers and a per-person price = `item.price / claimers.length`.
- Tap behavior:
  - If I haven't claimed it → insert `(item_id, my_user_id)` into `item_claims`.
  - If I have claimed it → delete my row (un-claim my share).
  - Items are NEVER locked — anyone can join an existing claim to split it.
- Subscribe to realtime changes on both `bill_items` and `item_claims` for the session so splits update live.
- "Your total" at the bottom = sum over my claimed items of `item.price / claimers.length`.

## Summary screen (`session.$code.me.tsx`)
- "What you ordered" lists each item I claimed with my share = `price / numClaimers`, and shows "shared with X others" when applicable.
- Subtotal/tax/tip math uses my per-item shares (not full item price). Bill subtotal stays the sum of all item prices, so tax/tip proration still works.

## Host views
Quick audit of `host.dashboard.tsx` to update any place that reads `claimed_by_user_id` (likely just status indicators) so it reflects the claim list instead.

## Out of scope
- Uneven splits (e.g. 70/30). Even-split only for v1.
- Auth changes — guests stay identified by localStorage `session_users.id`.

## Technical notes
- Migration: create `item_claims`, copy existing `(id, claimed_by_user_id)` rows where non-null, then `ALTER TABLE bill_items DROP COLUMN claimed_by_user_id, DROP COLUMN claimed_at`.
- Add `ALTER PUBLICATION supabase_realtime ADD TABLE public.item_claims;`.
- Update Supabase types are auto-regenerated.
