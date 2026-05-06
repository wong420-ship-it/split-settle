## Goal

Give the host clear visual feedback while the receipt OCR is running, so it doesn't feel frozen during the 5–45s wait.

## Changes (`src/routes/host.dashboard.tsx`)

Update the `pendingPreview` block (around lines 597–613) so that while `ocrLoading` is true:

1. **Spinner overlay on the thumbnail** — dim the receipt image (`brightness-75`) and center a `Loader2` (already imported) spinning in the middle.
2. **Indeterminate progress bar** — under the "Reading receipt…" label, render a thin track (`h-1.5 w-full bg-border rounded-full`) with an inner bar that animates left↔right to convey continuous activity. Implemented as an inline keyframe so we don't touch global CSS unnecessarily — or add one small `@keyframes ocr-progress` block in `src/styles.css` if cleaner.
3. **Status text refinement** — keep "Reading receipt…" but the progress bar carries the "something is happening" signal.

No behavior changes; cancel button stays hidden during loading (already the case).

## Out of scope

- Real progress percentage (the edge function doesn't stream progress).
- Time estimates or retry UI.
