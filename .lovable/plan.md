## Goal

Remove the extra "Read items" tap. As soon as a host picks a photo (camera or file), kick off OCR automatically.

## Changes (`src/routes/host.dashboard.tsx`)

1. **`handleReceiptSelect`**: After setting `pendingFile`/`pendingPreview`, immediately call `processReceipt(file)` instead of waiting for a button tap.
2. **`processReceipt`**: Accept the file as an argument (fallback to `pendingFile`) so it doesn't race with the just-set state.
3. **Preview UI (lines ~595–631)**: While `ocrLoading`, show the preview thumbnail with a "Reading receipt…" status and a spinner. Replace the two-button row with a single "Cancel" (disabled while loading is mid-flight, or allow abort — keep simple: hide cancel during loading). Drop the "Read items" button entirely.
4. **Error path**: If OCR fails or returns no items, keep `pendingPreview` cleared (already does) and surface the existing toast — user can re-pick. No retry button needed since re-tapping Camera/Upload restarts the flow.

## Out of scope

- Adding an abort/cancel mid-OCR (network call is ~5–45s; not worth the complexity now).
- Changing the camera/upload entry buttons.
