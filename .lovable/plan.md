## Goal
Let the host snap a receipt photo with their phone camera, in addition to picking an existing image.

## Current state
The "Upload receipt" button uses a single `<input type="file" accept="image/*" capture="environment">`. On mobile browsers, `capture="environment"` is a *hint* — many browsers (especially iOS Safari) ignore it and show a chooser anyway, while others jump straight to the camera with no way to pick from the library. Either way, there's no explicit "Take photo" option.

## Changes (all in `src/routes/host.dashboard.tsx`)

1. Replace the single "Upload receipt" button with a small action group:
   - **Take photo** — opens the camera directly (uses a hidden input with `capture="environment"`).
   - **Upload image** — opens the file picker (no `capture` attribute, so the user picks from photo library / files).
2. Wire both buttons to two separate hidden `<input type="file" accept="image/*">` refs, both calling the existing `handleReceiptUpload` handler. No changes to OCR logic, the edge function, or the review modal.
3. Keep the loading state ("Reading your receipt…") shared between both buttons; disable both while OCR is in flight.
4. Layout: two equal-width buttons side by side under the manual "Add Item" form, matching existing rounded outline button style. Camera icon (lucide `Camera`) for the first, `Upload` icon kept for the second.

## Notes
- Desktop browsers without a camera will still show a file chooser when "Take photo" is tapped — acceptable fallback behavior.
- No backend, schema, or edge function changes needed.
