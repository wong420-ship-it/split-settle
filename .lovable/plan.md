## Let host remove guests from a bill

Add a remove-guest action to the host dashboard. Removing a guest releases all of their item claims (so those items become unclaimed) and deletes them from the session. Guest devices already handle removal by redirecting to rejoin.

### Changes

**`src/routes/host.dashboard.tsx`**
- In the "Joined" section, add an "X" remove button on each guest chip (hidden on the host's own `(host)` row).
- Add an `AlertDialog` confirmation: *"Remove {name}? Items they claimed will become unclaimed."*
- Add `removeGuest(guestId)` that:
  - Deletes from `item_claims` where `user_id = guestId`
  - Deletes the `session_users` row
  - Optimistically updates local `guests` and `claims`
  - Shows a success toast
- Realtime subscriptions already refetch on changes, so the items list, totals, and the "Paid — but items are unclaimed" warning all update automatically.

### Already in place (no change)
- `session.$code.claim.tsx` and `session.$code.me.tsx` detect a missing guest row → clear local identity and redirect to `/join/$code`.
- RLS already allows public DELETE on `session_users` and `item_claims` (same trust model as the rest of the guest flow).

### Out of scope
- Preventing a removed guest from rejoining with a new name.
- Server-enforced host-only removal (would require a `createServerFn` + tightened RLS).
