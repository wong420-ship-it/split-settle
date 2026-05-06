import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getGuest } from "@/lib/guest";

type Session = { id: string; restaurant_name: string; tax_amount: number; tip_percentage: number };
type Item = { id: string; name: string; price: number; claimed_by_user_id: string | null };

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
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
        .select("id, name, price, claimed_by_user_id")
        .eq("session_id", s.id);
      setItems((its ?? []) as Item[]);
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

  const myItems = items.filter((i) => i.claimed_by_user_id === meId);
  const subtotal = myItems.reduce((s, i) => s + Number(i.price), 0);
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
                  <span>{item.name}</span>
                  <span className="font-mono">${Number(item.price).toFixed(2)}</span>
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
