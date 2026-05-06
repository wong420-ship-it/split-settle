## Generate architecture diagrams for SeatSolo

Create six Mermaid diagrams saved to `/mnt/documents/` and surfaced as artifacts.

### Diagrams

1. **System architecture** (`seatsolo_architecture.mmd`) — Browser/PWA → TanStack Start (Vite, Cloudflare Workers SSR) → Lovable Cloud (Postgres, Auth, Realtime, Storage) + `parse-receipt` edge function → Lovable AI Gateway (Gemini).
2. **User flow** (`seatsolo_user_flow.mmd`) — Host path (create bill → scan → review → publish → dashboard) and guest path (join code → claim items → mark paid), joining at the live session.
3. **Database ERD** (`seatsolo_erd.mmd`) — `bills`, `bill_items`, `item_claims`, `session_users` (and any related tables found in `src/integrations/supabase/types.ts`) with PK/FK relationships and key columns.
4. **Receipt OCR sequence** (`seatsolo_ocr_sequence.mmd`) — Host → upload to Storage → invoke `parse-receipt` → Lovable AI → parsed JSON → review UI → insert `bill_items`.
5. **Realtime data flow** (`seatsolo_realtime.mmd`) — Postgres changes on `bill_items` / `item_claims` / `session_users` → Supabase Realtime channels → host dashboard + guest claim/me screens, with toast/UI side effects.
6. **Route map** (`seatsolo_routes.mmd`) — All routes from `routeTree.gen.ts` and the navigation transitions between them.

### Process

- Read `src/integrations/supabase/types.ts`, `supabase/functions/parse-receipt/index.ts`, and the four route files to ground each diagram in actual code.
- Write each `.mmd` file, then emit a `<lov-artifact>` tag per diagram with `mime_type="text/vnd.mermaid"`.
- Avoid emojis (lexer issues); rely on theme-default colors for light/dark legibility.

### Out of scope

No code changes to the app itself — diagrams only.
