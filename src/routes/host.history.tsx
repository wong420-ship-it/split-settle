import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type SessionRow = {
  id: string;
  restaurant_name: string;
  share_code: string;
  tax_amount: number;
  tip_percentage: number;
  created_at: string;
};

type Summary = {
  session: SessionRow;
  total: number;
  guestCount: number;
  unpaidCount: number;
  unclaimedCount: number;
  status: "Settled" | "Open" | "Empty";
};

export const Route = createFileRoute("/host/history")({
  head: () => ({
    meta: [
      { title: "Your Bills — Seat Solo" },
      { name: "description", content: "Reopen and review your past bills." },
    ],
  }),
  component: HostHistory,
});

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor(diffMs / day);
  if (days < 1) {
    const hours = Math.floor(diffMs / (60 * 60 * 1000));
    if (hours < 1) return "Just now";
    return `${hours}h ago`;
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function HostHistory() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [summaries, setSummaries] = useState<Summary[]>([]);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        navigate({ to: "/" });
        return;
      }
      const { data: sessions, error } = await supabase
        .from("bill_sessions")
        .select("id, restaurant_name, share_code, tax_amount, tip_percentage, created_at")
        .eq("host_id", u.user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        toast.error("Couldn't load your bills");
        setLoading(false);
        return;
      }
      const rows = (sessions ?? []) as SessionRow[];
      if (rows.length === 0) {
        setSummaries([]);
        setLoading(false);
        return;
      }
      const sessionIds = rows.map((r) => r.id);
      const [{ data: items }, { data: guests }] = await Promise.all([
        supabase.from("bill_items").select("id, price, session_id").in("session_id", sessionIds),
        supabase.from("session_users").select("id, session_id, paid_at").in("session_id", sessionIds),
      ]);
      const itemRows = (items ?? []) as { id: string; price: number; session_id: string }[];
      const guestRows = (guests ?? []) as { id: string; session_id: string; paid_at: string | null }[];

      const itemIds = itemRows.map((i) => i.id);
      let claimRows: { item_id: string }[] = [];
      if (itemIds.length > 0) {
        const { data: claims } = await supabase
          .from("item_claims")
          .select("item_id")
          .in("item_id", itemIds);
        claimRows = (claims ?? []) as { item_id: string }[];
      }
      const claimedItemSet = new Set(claimRows.map((c) => c.item_id));

      const itemsBySession = new Map<string, { id: string; price: number }[]>();
      for (const it of itemRows) {
        const arr = itemsBySession.get(it.session_id) ?? [];
        arr.push({ id: it.id, price: Number(it.price) });
        itemsBySession.set(it.session_id, arr);
      }
      const guestsBySession = new Map<string, { paid_at: string | null }[]>();
      for (const g of guestRows) {
        const arr = guestsBySession.get(g.session_id) ?? [];
        arr.push({ paid_at: g.paid_at });
        guestsBySession.set(g.session_id, arr);
      }

      const out: Summary[] = rows.map((s) => {
        const sItems = itemsBySession.get(s.id) ?? [];
        const sGuests = guestsBySession.get(s.id) ?? [];
        const subtotal = sItems.reduce((acc, i) => acc + i.price, 0);
        const total =
          subtotal + Number(s.tax_amount ?? 0) + (subtotal * Number(s.tip_percentage ?? 0)) / 100;
        const unclaimedCount = sItems.filter((i) => !claimedItemSet.has(i.id)).length;
        const unpaidCount = sGuests.filter((g) => !g.paid_at).length;
        const guestCount = sGuests.length;
        let status: Summary["status"];
        if (sItems.length === 0 && guestCount === 0) status = "Empty";
        else if (guestCount > 0 && unpaidCount === 0 && unclaimedCount === 0) status = "Settled";
        else status = "Open";
        return { session: s, total, guestCount, unpaidCount, unclaimedCount, status };
      });
      setSummaries(out);
      setLoading(false);
    })();
  }, [navigate]);

  return (
    <AppShell>
      <div className="flex flex-col gap-5 pt-6">
        <header className="flex flex-col gap-1">
          <Link to="/" className="text-xs text-muted-foreground">← Back</Link>
          <h1 className="mt-1 text-2xl font-bold">Your bills</h1>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : summaries.length === 0
              ? "Nothing here yet."
              : `${summaries.length} ${summaries.length === 1 ? "bill" : "bills"} — most recent first`}
          </p>
        </header>

        {loading ? (
          <ul className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <li key={i} className="h-20 animate-pulse rounded-2xl border border-border bg-card" />
            ))}
          </ul>
        ) : summaries.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">
              You haven't started any bills yet.
            </p>
            <Link to="/">
              <Button size="lg" className="h-11">Start your first bill</Button>
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {summaries.map(({ session: s, total, guestCount, unpaidCount, unclaimedCount, status }) => {
              const badgeClass =
                status === "Settled"
                  ? "bg-primary/15 text-primary"
                  : status === "Open"
                  ? "bg-secondary text-secondary-foreground"
                  : "bg-muted text-muted-foreground";
              const blockers: string[] = [];
              if (unpaidCount > 0)
                blockers.push(`${unpaidCount} unpaid`);
              if (unclaimedCount > 0)
                blockers.push(`${unclaimedCount} unclaimed`);
              return (
                <li key={s.id}>
                  <Link
                    to="/host/dashboard"
                    search={{ code: s.share_code }}
                    className="block rounded-2xl border border-border bg-card p-4 transition hover:border-primary/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold text-foreground">
                            {s.restaurant_name || "My Bill"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            · {relativeDate(s.created_at)}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          ${total.toFixed(2)} · {guestCount} {guestCount === 1 ? "guest" : "guests"} ·{" "}
                          <span className="font-mono uppercase tracking-wider">{s.share_code}</span>
                        </div>
                        {status === "Open" && blockers.length > 0 && (
                          <div className="mt-1 text-xs text-destructive">{blockers.join(" · ")}</div>
                        )}
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClass}`}>
                        {status}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
