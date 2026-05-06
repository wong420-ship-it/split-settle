## Goal

Give signed-in hosts a single page that lists every bill they've ever created, shows its status, and lets them jump back into any of them.

## New route: `/host/history`

Create `src/routes/host.history.tsx`.

### Auth + load
- On mount: `supabase.auth.getUser()`. If no user, `navigate({ to: "/" })`.
- Query `bill_sessions` filtered by `host_id = user.id`, ordered `created_at desc`. RLS already permits this (`Anyone can read sessions`), but we filter client-side by host_id anyway since only the host should see this view.
- For each session, load in parallel:
  - `bill_items` (id, price) where `session_id = s.id`
  - `item_claims` (item_id) — fetch all claims for the visible session ids in a single `.in("item_id", [...])` query
  - `session_users` (id, paid_at) where `session_id = s.id`
- Compute per-session in memory (no extra columns):
  - `subtotal` = sum of item prices
  - `total` = subtotal + tax_amount + tip (subtotal × tip_percentage / 100)
  - `guestCount` = session_users.length
  - `unclaimedCount` = items with zero claims
  - `unpaidCount` = guests with `paid_at == null`
  - `status`:
    - `Settled` — guestCount > 0 && unpaidCount === 0 && unclaimedCount === 0
    - `Open` — anything else
    - `Empty` — no items AND no guests (started but never used)

### UI
List of cards, newest first. Each row:
- **Top line**: restaurant name (bold) + relative date ("2 days ago", "Mar 14")
- **Status badge**: Settled (primary), Open (secondary), Empty (muted)
- **Meta line**: `${total.toFixed(2)} · N guests · CODE`
- **Sub-warning** when Open: small destructive text noting `unpaidCount unpaid` and/or `unclaimedCount unclaimed` so hosts can spot what's blocking each one at a glance.
- Entire card is a `<Link to="/host/dashboard" search={{ code: s.share_code }}>` — single tap to reopen.

States:
- Loading: skeleton list.
- Empty (no bills at all): friendly empty state with a "Start a new bill" button linking to `/`.

Header: "← Back" link to `/`, page title "Your bills", subtitle showing total count.

### Performance
- Use `.in("session_id", ids)` batched queries instead of N+1. With 3 small parallel queries (items, claims, session_users) the whole page is one round trip per table regardless of how many bills.
- v1 caps at the most recent 50 bills (`.limit(50)`) — pagination is out of scope, but the cap prevents any pathological case.

## Entry points

1. **Home page (`src/routes/index.tsx`)**: When `supabase.auth.getSession()` returns a session, show a small "View your bills →" link under the "Hosting dinner?" card. Reuses the existing pendingHost effect — no new auth flow.
2. **Host dashboard (`src/routes/host.dashboard.tsx`)**: Add a small history icon button (lucide `History`) next to the existing "← Back" link in the header that goes to `/host/history`.

## Out of scope (v1)

- Delete / archive actions
- Search / filter / pagination beyond the 50-row cap
- Auto-marking very old bills as "Abandoned" — we can add this later as a pure display label if it becomes noisy

## Files

- **New**: `src/routes/host.history.tsx`
- **Edit**: `src/routes/index.tsx` (conditional history link)
- **Edit**: `src/routes/host.dashboard.tsx` (history icon in header)
