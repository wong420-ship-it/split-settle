## Problem

When every guest has marked themselves paid, the host's payments card flips to the celebratory "Everyone has paid 🎉" state — even if one or more items on the receipt were never claimed by anyone. Those unclaimed items silently fall off the bill, so the host thinks they're done when they actually undercharged the table.

## Fix

In `src/routes/host.dashboard.tsx`, detect this combined state and surface it clearly so the celebration doesn't hide a real gap.

### 1. Compute unclaimed items

Inside the payments section IIFE (around line 705), derive the list of unclaimed items from existing state:

```ts
const unclaimedItems = items.filter((i) => (claimsByItem.get(i.id) ?? []).length === 0);
const unclaimedTotal = unclaimedItems.reduce((s, i) => s + Number(i.price), 0);
const hasUnclaimed = unclaimedItems.length > 0;
```

No new data fetching — `items` and `claimsByItem` are already in scope.

### 2. Suppress the false "all done" state

Change the celebration condition so it only fires when payments AND claims are both complete:

- `allPaid && !hasUnclaimed` → keep the green "Everyone has paid 🎉" card as-is.
- `allPaid && hasUnclaimed` → render a warning variant of the same card instead:
  - Border/background: `border-destructive bg-destructive/10` (matches the existing destructive token used elsewhere in the app).
  - Headline: "Paid — but items are unclaimed".
  - Subtext lists the unclaimed item names and the unclaimed subtotal, e.g. *"Truffle fries, Side salad · $14.50 not covered"*.
  - Short hint: "Claim them yourself or assign to a guest before closing out."
- `!allPaid` → unchanged (existing "Waiting on …" copy).

### 3. Also flag it on the Items list (lightweight)

The per-item "Unclaimed" label (line 445) is currently muted gray. When `allPaid && hasUnclaimed`, render that label in `text-destructive` instead so the offending rows visually match the warning banner. Normal in-progress sessions keep the muted styling so we don't cry wolf while people are still claiming.

### Out of scope

- No schema changes, no new actions. The host can already claim items themselves or assign via the existing popover — this change is purely about making the gap visible.
- No change to guest-facing screens.

## Files

- `src/routes/host.dashboard.tsx` — payments section conditional + items list label color.
