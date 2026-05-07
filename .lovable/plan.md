## Fix: receipts failing to parse after the latest update

### Root cause

Edge function logs show Gemini's JSON response being **truncated mid-generation**, e.g.:

```
"items": [{ "name": "CAESAR SALAD", "quantity": 2, "unit_price": 12.00
  immunotherapy for autoimmune kidney disease...
```

The previous change lowered the AI gateway timeout in `parse-receipt` from 45s → 30s so the client retry would kick in sooner. In practice Gemini 2.5 Flash regularly takes 25–40s on a dense receipt, so the 30s `AbortController` fires *while the model is still streaming JSON back*. The partial response then fails `JSON.parse` and the host sees "Couldn't read this receipt." Retrying often hits the same ceiling.

The OCR was working before precisely because it had headroom past 30s.

### Changes

**1. `supabase/functions/parse-receipt/index.ts`** — restore a safe AI gateway timeout
- `30000` → `55000` ms (slightly under the platform edge cap, comfortably above typical Gemini latency).
- Everything else in the function stays exactly as-is (auth, prompt, parsing, fee handling). No accuracy impact.

**2. `src/routes/host.dashboard.tsx`** — align client timeout with the new server budget
- Per-attempt fetch timeout: `35000` → `60000` ms so the client doesn't abort before the edge function has a chance to return.
- Retry policy unchanged: still 1 auto-retry on `AbortError` / 5xx, same compressed bytes reused, same "Try again" button on hard failure.
- Stage UI thresholds unchanged ("Taking longer than usual…" at 15s, "we'll retry automatically" at 25s) — these are still useful messaging for the host even with the longer ceiling.

### Why this is safe

- No prompt, model, or image-processing changes — OCR accuracy is untouched.
- Compression guards from the prior change stay in place (only kicks in for >1.5 MB JPEG/PNG/WebP with long edge >2000px, q=0.92, falls back to original).
- Retry + cancel + staged progress UI all stay. We're only widening the timeout window that was set too tight.
- No DB schema or RLS changes.

### Out of scope

- Background job queue (still deferred).
- Switching models or trimming the prompt.
