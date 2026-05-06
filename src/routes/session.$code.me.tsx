import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getGuest } from "@/lib/guest";
import { Check } from "lucide-react";
import { toast } from "sonner";

type Session = { id: string; restaurant_name: string; tax_amount: number; tip_percentage: number };
type Item = { id: string; name: string; price: number };
type Claim = { item_id: string; user_id: string };

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
      const { data: its } = await supabase
        .from("bill_items")
        .select("id, name, price")
        .eq("session_id", s.id);
      const itemList = (its ?? []) as Item[];
      setItems(itemList);
      if (itemList.length) {
        const { data: cs } = await supabase
          .from("item_claims")
          .select("item_id, user_id")
          .in("item_id", itemList.map((i) => i.id));
        setClaims((cs ?? []) as Claim[]);
      }
      const { data: meRow } = await supabase
        .from("session_users")
        .select("paid_at")
        .eq("id", guest.id)
        .maybeSingle();
      setPaidAt((meRow as { paid_at: string | null } | null)?.paid_at ?? null);
      setLoading(false);
    })();
  }, [code, navigate]);

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

        <section className="rounded-2xl bg-primary p-5 text-primary-foreground">
          <div className="text-xs uppercase tracking-wider opacity-80">You owe</div>
          <div className="font-mono text-4xl font-bold">${total.toFixed(2)}</div>
        </section>

        <Button variant="outline" size="lg" className="h-12">Mark as paid</Button>
        <Link to="/" className="text-center text-sm text-muted-foreground underline">
          Back to home
        </Link>
      </div>
    </AppShell>
  );
}
