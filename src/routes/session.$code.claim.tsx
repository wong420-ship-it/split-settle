import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { getGuest } from "@/lib/guest";
import { Check, Users } from "lucide-react";

type Session = { id: string; restaurant_name: string };
type Item = { id: string; name: string; price: number };
type Claim = { item_id: string; user_id: string };
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
  const [claims, setClaims] = useState<Claim[]>([]);
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
        supabase.from("bill_items").select("id, name, price").eq("session_id", s.id),
        supabase.from("session_users").select("id, display_name").eq("session_id", s.id),
      ]);
      setItems((its ?? []) as Item[]);
      setGuests((gs ?? []) as Guest[]);
      const itemIds = (its ?? []).map((i: any) => i.id);
      if (itemIds.length) {
        const { data: cs } = await supabase
          .from("item_claims")
          .select("item_id, user_id")
          .in("item_id", itemIds);
        setClaims((cs ?? []) as Claim[]);
      }
      setLoading(false);
    })();
  }, [code, navigate]);

  useEffect(() => {
    if (!session) return;
    const refetchItems = () =>
      supabase
        .from("bill_items")
        .select("id, name, price")
        .eq("session_id", session.id)
        .then(({ data }) => data && setItems(data as Item[]));
    const refetchClaims = async () => {
      const { data: its } = await supabase
        .from("bill_items")
        .select("id")
        .eq("session_id", session.id);
      const ids = (its ?? []).map((i: any) => i.id);
      if (!ids.length) {
        setClaims([]);
        return;
      }
      const { data: cs } = await supabase
        .from("item_claims")
        .select("item_id, user_id")
        .in("item_id", ids);
      setClaims((cs ?? []) as Claim[]);
    };
    const channel = supabase
      .channel(`claim-${session.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bill_items", filter: `session_id=eq.${session.id}` },
        () => {
          refetchItems();
          refetchClaims();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "item_claims" },
        () => refetchClaims(),
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

  const claimsByItem = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of claims) {
      const arr = m.get(c.item_id) ?? [];
      arr.push(c.user_id);
      m.set(c.item_id, arr);
    }
    return m;
  }, [claims]);

  const toggle = async (item: Item) => {
    if (!meId) return;
    const claimers = claimsByItem.get(item.id) ?? [];
    const mine = claimers.includes(meId);
    if (mine) {
      setClaims((p) => p.filter((c) => !(c.item_id === item.id && c.user_id === meId)));
      await supabase.from("item_claims").delete().eq("item_id", item.id).eq("user_id", meId);
    } else {
      setClaims((p) => [...p, { item_id: item.id, user_id: meId }]);
      await supabase.from("item_claims").insert({ item_id: item.id, user_id: meId });
    }
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

  const myTotal = items.reduce((sum, i) => {
    const claimers = claimsByItem.get(i.id) ?? [];
    if (!meId || !claimers.includes(meId)) return sum;
    return sum + Number(i.price) / claimers.length;
  }, 0);

  return (
    <AppShell>
      <div className="flex flex-col gap-5 pb-24">
        <header>
          <Link to="/" className="text-xs text-muted-foreground">← Home</Link>
          <h1 className="mt-2 text-2xl font-bold">{session.restaurant_name}</h1>
          <p className="text-sm text-muted-foreground">
            Tap items you ordered. Tap the same item as someone else to split it.
          </p>
        </header>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">No items yet — your host is adding them.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {items.map((item) => {
              const claimers = claimsByItem.get(item.id) ?? [];
              const mine = !!meId && claimers.includes(meId);
              const splitN = claimers.length;
              const myShare = splitN > 0 ? Number(item.price) / splitN : Number(item.price);
              const others = claimers.filter((id) => id !== meId);
              return (
                <li key={item.id}>
                  <button
                    onClick={() => toggle(item)}
                    className={`flex w-full items-center justify-between rounded-2xl border p-4 text-left transition-all ${
                      mine
                        ? "border-primary bg-primary/10"
                        : claimers.length > 0
                          ? "border-border bg-card hover:border-primary/50"
                          : "border-border bg-card hover:border-primary/50 active:scale-[0.99]"
                    }`}
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-foreground">{item.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {mine && splitN === 1 ? (
                          <span className="inline-flex items-center gap-1 text-primary">
                            <Check className="h-3 w-3" /> Claimed by you
                          </span>
                        ) : mine && splitN > 1 ? (
                          <span className="inline-flex items-center gap-1 text-primary">
                            <Users className="h-3 w-3" /> Split {splitN} ways with{" "}
                            {others.map(guestName).join(", ")}
                          </span>
                        ) : splitN > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3 w-3" /> {claimers.map(guestName).join(", ")} —
                            tap to split
                          </span>
                        ) : (
                          "Tap to claim"
                        )}
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="font-mono font-semibold text-foreground">
                        ${Number(item.price).toFixed(2)}
                      </span>
                      {splitN > 1 && (
                        <span className="font-mono text-xs text-muted-foreground">
                          ${myShare.toFixed(2)} ea
                        </span>
                      )}
                    </div>
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
