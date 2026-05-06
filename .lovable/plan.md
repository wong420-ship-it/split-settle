## Quality-of-life improvements (excluding QR code)

Implement all proposed QoL improvements except #2 (QR code).

### Host dashboard (`src/routes/host.dashboard.tsx`)

1. **Native share sheet** — Add a "Share link" button in the share card. Uses `navigator.share({ title, text, url })` when available; falls back to clipboard copy with toast.
2. **Per-item delete with confirm** — Trash icon next to each item; shows AlertDialog before deleting (cascades to claims via existing FK behavior, or explicit delete).
3. **Inline edit item name/price** — Click pencil icon (or tap row) to swap into edit mode with two inputs + save/cancel. Validates price like add-item form.
4. **Remember tip %** — On bill load, if `tip_percentage` still equals the default 18 AND localStorage has `seatsolo:lastTip`, apply the saved value. Save current tip to localStorage whenever host changes it.
5. **Per-guest running total in "Joined" chip** — Compute each guest's owed share (subtotal portion + proportional tax/tip) and show as a small mono `$X.XX` next to their name.
6. **Toast on new guest joining** — In the realtime `session_users` handler, diff incoming list against previous; for new IDs (other than host), `toast(`${name} joined`)`.
7. **Sticky "Your share" bar** — Make the host share section sticky-bottom while scrolling (similar to claim screen). Compact variant on mobile.
8. **"Claim leftovers" quick action** — On the "Paid but unclaimed" warning card, add a button that bulk-inserts claims for the host on all unclaimed items.
9. **Clearer re-scan affordance** — After a successful review save, surface a small "Scan another receipt" link near the receipt buttons.
10. **Loading skeletons** — Replace "Loading your bill…" with skeleton blocks (header + items + totals shapes) using `Skeleton` from `@/components/ui/skeleton`.

### Claim screen (`src/routes/session.$code.claim.tsx`)

11. **Empty-state "listening" indicator** — When `items.length === 0`, add a small pulsing dot + "Listening for updates…" line under the existing copy.
12. **Haptic feedback on claim toggle** — Call `navigator.vibrate?.(10)` inside `toggle()`.
13. **Loading skeletons** — Replace "Loading…" with skeleton list.

### Summary screen (`src/routes/session.$code.me.tsx`)

14. **Haptic feedback on mark paid** — `navigator.vibrate?.(15)` when toggling paid.

### Home (`src/routes/index.tsx`)

15. **Smarter join code input** —
    - On paste/change, strip non-alphanumeric (e.g. `ABC-123` → `ABC123`).
    - Auto-submit when 6 valid chars are entered (debounced via effect).
    - On "code not found", keep existing error and add a hint to double-check casing/typos.

### Technical notes

- **Sticky bar**: use `position: sticky; bottom: 0` inside the scroll container, or `fixed inset-x-0 bottom-0` mirroring the claim screen pattern. Add bottom padding to page so content isn't obscured.
- **Inline edit**: keep state local per-row (`editingId`, `editName`, `editPrice`); on save call `supabase.from('bill_items').update(...)`. Optimistically merge into `items`.
- **Delete cascade**: claims on the deleted item — explicitly `delete from item_claims where item_id = ?` first, then delete the item, since no FK cascade is declared in schema.
- **Per-guest totals**: reuse the same formula as host share: `guestSubtotal = sum(item.price / claimers.length)`, then proportional tax/tip via `guestSubtotal / billSubtotal`.
- **Tip persistence key**: `seatsolo:lastTipPct`. Only override session value when current is exactly 18 (the DB default) to avoid clobbering an intentional choice.
- **Native share**: feature-detect `navigator.share` and `navigator.canShare?.({ url })`; fallback path is the existing clipboard copy.
- **No new dependencies required.**

### Out of scope

- QR code (per user request).
- Push notifications, payment deep links, multi-currency.
