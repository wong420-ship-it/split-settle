import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { getGuest } from "@/lib/guest";
import { Check } from "lucide-react";

type Session = { id: string; restaurant_name: string };
type Item = { id: string; name: string; price: number; claimed_by_user_id: string | null };
type Guest = { id: string; display_name: string };

export const Route = createFileRoute("/session/$code/claim")({
  head: () => ({
    meta: [
      { title: "Claim Items — Seat Solo" },
      { name: "description", content: "Tap the items you ordered." },
    ],
  }),
  component: Claim,
});

function Claim() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
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
        .select("id, restaurant_name")
        .eq("share_code", code.toUpperCase())
        .maybeSingle();
      if (!s) {
        navigate({ to: "/" });
        return;
      }
      setSession(s as Session);
      const [{ data: its }, { data: gs }] = await Promise.all([
        supabase.from("bill_items").select("id, name, price, claimed_by_user_id").eq("session_id", s.id),
        supabase.from("session_users").select("id, display_name").eq("session_id", s.id),
      ]);
      setItems((its ?? []) as Item[]);
      setGuests((gs ?? []) as Guest[]);
      setLoading(false);
    })();
  }, [code, navigate]);

  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel(`claim-${session.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bill_items", filter: `session_id=eq.${session.id}` },
        () => {
          supabase
            .from("bill_items")
            .select("id, name, price, claimed_by_user_id")
            .eq("session_id", session.id)
            .then(({ data }) => data && setItems(data as Item[]));
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_users", filter: `session_id=eq.${session.id}` },
        () => {
          supabase
            .from("session_users")
            .select("id, display_name")
            .eq("session_id", session.id)
            .then(({ data }) => data && setGuests(data as Guest[]));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  const toggle = async (item: Item) => {
    if (!meId) return;
    const mine = item.claimed_by_user_id === meId;
    if (item.claimed_by_user_id && !mine) return;
    const next = mine
      ? { claimed_by_user_id: null, claimed_at: null }
      : { claimed_by_user_id: meId, claimed_at: new Date().toISOString() };
    setItems((p) => p.map((i) => (i.id === item.id ? { ...i, ...next } : i)));
    await supabase.from("bill_items").update(next).eq("id", item.id);
  };

  const guestName = (id: string) => guests.find((g) => g.id === id)?.display_name ?? "Someone";

  if (loading || !session) {
    return (
      <AppShell>
        <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      </AppShell>
    );
  }

  const myTotal = items
    .filter((i) => i.claimed_by_user_id === meId)
    .reduce((s, i) => s + Number(i.price), 0);

  return (
    <AppShell>
      <div className="flex flex-col gap-5 pb-24">
        <header>
          <Link to="/" className="text-xs text-muted-foreground">← Home</Link>
          <h1 className="mt-2 text-2xl font-bold">{session.restaurant_name}</h1>
          <p className="text-sm text-muted-foreground">Tap the items you ordered.</p>
        </header>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">No items yet — your host is adding them.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {items.map((item) => {
              const mine = item.claimed_by_user_id === meId;
              const taken = !!item.claimed_by_user_id && !mine;
              return (
                <li key={item.id}>
                  <button
                    onClick={() => toggle(item)}
                    disabled={taken}
                    className={`flex w-full items-center justify-between rounded-2xl border p-4 text-left transition-all ${
                      mine
                        ? "border-primary bg-primary/10"
                        : taken
                          ? "border-border bg-muted opacity-60"
                          : "border-border bg-card hover:border-primary/50 active:scale-[0.99]"
                    }`}
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-foreground">{item.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {mine ? (
                          <span className="inline-flex items-center gap-1 text-primary">
                            <Check className="h-3 w-3" /> Claimed by you
                          </span>
                        ) : taken ? (
                          `Claimed by ${guestName(item.claimed_by_user_id!)}`
                        ) : (
                          "Tap to claim"
                        )}
                      </span>
                    </div>
                    <span className="font-mono font-semibold text-foreground">
                      ${Number(item.price).toFixed(2)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10">
        <div className="mx-auto max-w-[480px] border-t border-border bg-card/95 px-5 py-3 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground">Your total</div>
              <div className="text-xl font-bold font-mono">${myTotal.toFixed(2)}</div>
            </div>
            <Link to="/session/$code/me" params={{ code }}>
              <Button size="lg" className="h-11">View summary →</Button>
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
