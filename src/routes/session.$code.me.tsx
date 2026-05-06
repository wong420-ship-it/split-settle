import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { clearGuest, getGuest } from "@/lib/guest";
import { Check } from "lucide-react";
import { toast } from "sonner";

type Session = { id: string; restaurant_name: string; tax_amount: number; tip_percentage: number };
type Item = { id: string; name: string; price: number };
type Claim = { item_id: string; user_id: string };
type Guest = { id: string; display_name: string; paid_at: string | null };

export const Route = createFileRoute("/session/$code/me")({
  head: () => ({
    meta: [
      { title: "Your Summary — Seat Solo" },
      { name: "description", content: "Your share of the bill." },
    ],
  }),
  component: Me,
});

function Me() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [paidAt, setPaidAt] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    const guest = getGuest(code);
    if (!guest) {
      navigate({ to: "/join/$code", params: { code } });
      return;
    }
    setMeId(guest.id);
    (async () => {
      const { data: s } = await supabase
        .from("bill_sessions")
        .select("id, restaurant_name, tax_amount, tip_percentage")
        .eq("share_code", code.toUpperCase())
        .maybeSingle();
      if (!s) {
        navigate({ to: "/" });
        return;
      }
      setSession(s as Session);
      setLoading(false);
    })();
  }, [code, navigate]);

  // Realtime + focus sync so items/claims/paid status stay fresh.
  useEffect(() => {
    if (!session || !meId) return;
    const refetchAll = async () => {
      const { data: its } = await supabase
        .from("bill_items")
        .select("id, name, price")
        .eq("session_id", session.id);
      const itemList = (its ?? []) as Item[];
      setItems(itemList);
      if (itemList.length) {
        const { data: cs } = await supabase
          .from("item_claims")
          .select("item_id, user_id")
          .in("item_id", itemList.map((i) => i.id));
        setClaims((cs ?? []) as Claim[]);
      } else {
        setClaims([]);
      }
      const { data: gs } = await supabase
        .from("session_users")
        .select("id, display_name, paid_at")
        .eq("session_id", session.id);
      const guestList = (gs ?? []) as Guest[];
      setGuests((prev) => {
        for (const g of guestList) {
          if (!g.paid_at || g.id === meId) continue;
          const before = prev.find((p) => p.id === g.id);
          if (before && !before.paid_at) {
            toast.success(`${g.display_name} marked as paid`);
          }
        }
        return guestList;
      });
      const me = guestList.find((g) => g.id === meId);
      if (!me) {
        // Host deleted this guest; reset local identity.
        clearGuest(code);
        navigate({ to: "/join/$code", params: { code } });
        return;
      }
      setPaidAt(me.paid_at ?? null);
    };
    refetchAll();
    const channel = supabase
      .channel(`me-${session.id}-${meId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bill_items", filter: `session_id=eq.${session.id}` },
        () => refetchAll(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "item_claims" },
        () => refetchAll(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_users", filter: `session_id=eq.${session.id}` },
        () => refetchAll(),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refetchAll();
      });
    const onFocus = () => refetchAll();
    const onVisible = () => {
      if (document.visibilityState === "visible") refetchAll();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const poll = window.setInterval(refetchAll, 15000);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(poll);
    };
  }, [session, meId]);

  if (loading || !session) {
    return (
      <AppShell>
        <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      </AppShell>
    );
  }

  const claimerCount = (itemId: string) => claims.filter((c) => c.item_id === itemId).length;
  const iClaimed = (itemId: string) => !!meId && claims.some((c) => c.item_id === itemId && c.user_id === meId);

  const myItems = items
    .filter((i) => iClaimed(i.id))
    .map((i) => {
      const n = claimerCount(i.id) || 1;
      return { ...i, share: Number(i.price) / n, splitN: n };
    });

  const subtotal = myItems.reduce((s, i) => s + i.share, 0);
  const billSubtotal = items.reduce((s, i) => s + Number(i.price), 0);
  const share = billSubtotal > 0 ? subtotal / billSubtotal : 0;
  const myTax = Number(session.tax_amount) * share;
  const myTip = ((billSubtotal * Number(session.tip_percentage)) / 100) * share;
  const total = subtotal + myTax + myTip;

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header>
          <Link to="/session/$code/claim" params={{ code }} className="text-xs text-muted-foreground">
            ← Back to items
          </Link>
          <h1 className="mt-2 text-2xl font-bold">Your share</h1>
          <p className="text-sm text-muted-foreground">at {session.restaurant_name}</p>
        </header>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            What you ordered
          </h2>
          {myItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">You haven't claimed anything yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {myItems.map((item) => (
                <li key={item.id} className="flex justify-between py-2.5 text-sm">
                  <div className="flex flex-col">
                    <span>{item.name}</span>
                    {item.splitN > 1 && (
                      <span className="text-xs text-muted-foreground">
                        Split {item.splitN} ways (${Number(item.price).toFixed(2)} total)
                      </span>
                    )}
                  </div>
                  <span className="font-mono">${item.share.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl bg-secondary p-4 text-sm">
          <div className="flex justify-between text-secondary-foreground">
            <span>Subtotal</span><span className="font-mono">${subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-secondary-foreground">
            <span>Your tax ({(share * 100).toFixed(0)}% share)</span>
            <span className="font-mono">${myTax.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-secondary-foreground">
            <span>Your tip</span><span className="font-mono">${myTip.toFixed(2)}</span>
          </div>
        </section>

        <section
          className={`rounded-2xl p-5 ${
            paidAt
              ? "bg-secondary text-secondary-foreground"
              : "bg-primary text-primary-foreground"
          }`}
        >
          <div className="text-xs uppercase tracking-wider opacity-80">
            {paidAt ? "You paid" : "You owe"}
          </div>
          <div className="font-mono text-4xl font-bold">${total.toFixed(2)}</div>
          {paidAt && (
            <div className="mt-1 text-xs opacity-80">
              Marked paid {new Date(paidAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </div>
          )}
        </section>

        <Button
          variant={paidAt ? "outline" : "default"}
          size="lg"
          className="h-12"
          disabled={marking || !meId}
          onClick={async () => {
            if (!meId) return;
            setMarking(true);
            const next = paidAt ? null : new Date().toISOString();
            const prev = paidAt;
            setPaidAt(next);
            const { error } = await supabase
              .from("session_users")
              .update({ paid_at: next })
              .eq("id", meId);
            setMarking(false);
            if (error) {
              setPaidAt(prev);
              toast.error(`Couldn't update: ${error.message}`);
              return;
            }
            toast.success(next ? "Marked as paid" : "Marked unpaid");
          }}
        >
          {paidAt ? (
            <>
              <Check className="mr-2 h-4 w-4" /> Paid — tap to undo
            </>
          ) : (
            "Mark as paid"
          )}
        </Button>

        {guests.length > 0 && (() => {
          const paidCount = guests.filter((g) => g.paid_at).length;
          const allPaid = paidCount === guests.length;
          const pct = Math.round((paidCount / guests.length) * 100);
          const unpaid = guests.filter((g) => !g.paid_at);
          return (
            <section
              className={`rounded-2xl border p-4 ${
                allPaid ? "border-primary bg-primary/10" : "border-border bg-card"
              }`}
            >
              <div className="flex items-center justify-between text-sm font-semibold">
                <span className="text-foreground">
                  {allPaid ? "Everyone has paid 🎉" : "Table payments"}
                </span>
                <span className="font-mono text-foreground">
                  {paidCount} / {guests.length}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <ul className="mt-3 flex flex-wrap gap-2">
                {guests.map((g) => (
                  <li
                    key={g.id}
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                      g.paid_at
                        ? "bg-primary/15 text-foreground"
                        : "bg-secondary text-secondary-foreground"
                    }`}
                  >
                    {g.paid_at && <Check className="h-3 w-3 text-primary" />}
                    <span>
                      {g.display_name}
                      {g.id === meId && " (you)"}
                    </span>
                  </li>
                ))}
              </ul>
              {!allPaid && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Waiting on {unpaid.map((g) => (g.id === meId ? "you" : g.display_name)).join(", ")}
                </p>
              )}
            </section>
          );
        })()}
        <Link to="/" className="text-center text-sm text-muted-foreground underline">
          Back to home
        </Link>
      </div>
    </AppShell>
  );
}
