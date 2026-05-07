## Faster, more transparent receipt OCR (accuracy-preserving)

Goal: cut perceived latency, auto-recover from hangs, always tell the user what stage they're in — **without losing any OCR accuracy**.

### Accuracy guardrails (the main concern)

Receipts are text-dense and accuracy is sensitive to resolution and JPEG artifacts. So:

- **Only resize when the image is genuinely oversized.** If the long edge is ≤ 2000px, send the original file untouched.
- **Conservative downscale target:** max 2000px on the long edge (not 1600). Gemini 2.5 Flash reads small thermal-receipt fonts comfortably at this size; this matches what production receipt-OCR pipelines use.
- **High-quality JPEG re-encode:** quality 0.92 (not 0.85). Avoids ringing around thin digits/decimal points.
- **Skip compression for already-small files** (< 1.5 MB) — no point re-encoding.
- **Skip compression for non-JPEG inputs** like HEIC/PNG screenshots — pass through.
- **Hard fallback:** if `canvas.toBlob` returns null, throws, or produces a *larger* file than the original, send the original.
- **No server-side image changes** — edge function still receives the same bytes it would today, just smaller when safe.

Net effect: an 8 MB phone photo (typically 4032×3024) becomes ~1.2–1.8 MB at 2000×1500 with q=0.92 — visually indistinguishable from the original at receipt-reading scale. A 900 KB photo is sent as-is.

If you'd rather skip compression entirely and only ship the retry + progress UX, say so and I'll drop step 1.

### Why not a background job queue

The "return jobId, poll status table" pattern is the textbook fix but needs a new table + RLS + background dispatch + polling endpoint + UX changes. Too much new surface area the night before a live demo. Items 2–4 below get most of the perceived speedup with no schema changes.

### Changes

**1. Optional, conservative client-side compression (`src/routes/host.dashboard.tsx`)**
- New `maybeCompressImage(file)` helper using a `<canvas>`.
- Guards above (size threshold, type check, dimension check, fallback to original).
- Stage label: "Optimizing image…" (only shown if compression actually runs).

**2. Retry + timeout wrapper around the fetch (`processReceipt`)**
- `AbortController` with 35s timeout per attempt.
- On `AbortError`, network error, or 502/504: auto-retry **once** after 1s.
- Same compressed bytes reused on retry (no double-work).
- If both attempts fail: clear toast + a **"Try again"** button on the preview card so the host doesn't have to re-pick the file.

**3. Staged progress UI (replaces single "Reading receipt…" line)**
- Stages: `optimizing` → `uploading` → `reading` → `retrying`.
- Elapsed-seconds counter ("Reading receipt… 8s").
- After 15s on `reading`: "Taking longer than usual — still working…".
- After 25s: "If this hangs we'll retry automatically".
- Cancel button wired to the AbortController.

**4. Edge function: tighter timeout (`supabase/functions/parse-receipt/index.ts`)**
- AI gateway timeout: 45s → 30s, so the client's auto-retry kicks in sooner on a stalled call instead of waiting nearly a minute. No parsing/prompt changes.

### Files touched

- `src/routes/host.dashboard.tsx` — `maybeCompressImage()`, rewrite `processReceipt` with AbortController + retry + stages, elapsed-time effect, "Try again" button.
- `supabase/functions/parse-receipt/index.ts` — timeout 45000 → 30000.

### Out of scope

- Background job table + polling (deferred; safe follow-up after demo).
- Prompt or model changes.
- Server-side image processing.

### Demo-safety notes

- Compression is opt-in per-image via the guards; worst case it falls back to the original file.
- Retry capped at 1 to avoid hammering the AI gateway during the live demo.
- No DB schema or RLS changes.
