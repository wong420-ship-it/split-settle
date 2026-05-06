import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { Check, Copy, Plus, Trash2, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Session = {
  id: string;
  restaurant_name: string;
  tax_amount: number;
  tip_percentage: number;
  share_code: string;
};
type Item = { id: string; name: string; price: number; claimed_by_user_id: string | null };
type Guest = { id: string; display_name: string };

export const Route = createFileRoute("/host/dashboard")({
  validateSearch: (s: Record<string, unknown>) => ({ code: (s.code as string) || "" }),
  head: () => ({
    meta: [
      { title: "Host Dashboard — Seat Solo" },
      { name: "description", content: "Review your parsed receipt and share with guests." },
    ],
  }),
  component: HostDashboard,
});

function HostDashboard() {
  const { code } = Route.useSearch();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [adding, setAdding] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewItems, setReviewItems] = useState<{ name: string; price: string }[]>([]);
  const [reviewTax, setReviewTax] = useState<number | null>(null);
  const [reviewRestaurant, setReviewRestaurant] = useState<string | null>(null);
  const [savingReview, setSavingReview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load session + verify auth
  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        navigate({ to: "/" });
        return;
      }
      if (!code) {
        navigate({ to: "/" });
        return;
      }
      const { data: s } = await supabase
        .from("bill_sessions")
        .select("id, restaurant_name, tax_amount, tip_percentage, share_code")
        .eq("share_code", code)
        .eq("host_id", u.user.id)
        .maybeSingle();
      if (!s) {
        toast.error("Bill not found");
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

  // Realtime
  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel(`host-${session.id}`)
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

  const updateField = async (field: "tax_amount" | "tip_percentage", value: number) => {
    if (!session) return;
    setSession({ ...session, [field]: value });
    const patch = field === "tax_amount" ? { tax_amount: value } : { tip_percentage: value };
    await supabase.from("bill_sessions").update(patch).eq("id", session.id);
  };

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !newName.trim() || !newPrice) return;
    setAdding(true);
    const { error } = await supabase
      .from("bill_items")
      .insert({ session_id: session.id, name: newName.trim(), price: parseFloat(newPrice) });
    if (error) toast.error(error.message);
    setNewName("");
    setNewPrice("");
    setAdding(false);
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !session) return;
    setOcrLoading(true);
    try {
      const fd = new FormData();
      fd.append("document", file);
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-receipt`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: fd,
      });
      const json = await resp.json();
      if (!resp.ok) {
        toast.error(json.error || "Couldn't read receipt.");
        return;
      }
      if (!json.items || json.items.length === 0) {
        toast.error("Couldn't read items from this receipt — please add them manually.");
        return;
      }
      setReviewItems(json.items.map((i: any) => ({ name: i.name, price: String(i.price) })));
      setReviewTax(typeof json.tax === "number" ? json.tax : null);
      setReviewRestaurant(json.restaurant || null);
      setReviewOpen(true);
    } catch (err) {
      toast.error("Receipt upload failed.");
    } finally {
      setOcrLoading(false);
    }
  };

  const saveReview = async () => {
    if (!session) return;
    const rows = reviewItems
      .map((r) => ({ name: r.name.trim(), price: parseFloat(r.price) }))
      .filter((r) => r.name && !isNaN(r.price) && r.price > 0);
    if (rows.length === 0) {
      toast.error("Add at least one valid item.");
      return;
    }
    setSavingReview(true);
    const { error } = await supabase
      .from("bill_items")
      .insert(rows.map((r) => ({ session_id: session.id, name: r.name, price: r.price })));
    if (error) {
      toast.error(error.message);
      setSavingReview(false);
      return;
    }
    const patch: Record<string, any> = {};
    if (reviewTax != null) patch.tax_amount = reviewTax;
    if (reviewRestaurant && (!session.restaurant_name || session.restaurant_name === "My Bill")) {
      patch.restaurant_name = reviewRestaurant;
    }
    if (Object.keys(patch).length) {
      await supabase.from("bill_sessions").update(patch).eq("id", session.id);
      setSession({ ...session, ...patch });
    }
    setSavingReview(false);
    setReviewOpen(false);
    toast.success(`Added ${rows.length} item${rows.length === 1 ? "" : "s"}.`);
  };
    return (
      <AppShell>
        <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
          Loading your bill…
        </div>
      </AppShell>
    );
  }

  const subtotal = items.reduce((s, i) => s + Number(i.price), 0);
  const tax = Number(session.tax_amount);
  const tip = Number(session.tip_percentage);
  const tipAmount = (subtotal * tip) / 100;
  const total = subtotal + tax + tipAmount;
  const link = `${typeof window !== "undefined" ? window.location.origin : ""}/join/${session.share_code}`;

  return (
    <AppShell>
      <div className="flex flex-col gap-6 pb-12">
        <header>
          <Link to="/" className="text-xs text-muted-foreground">← Back</Link>
          <h1 className="mt-2 text-2xl font-bold">{session.restaurant_name}</h1>
          <p className="text-sm text-muted-foreground">
            {items.length} {items.length === 1 ? "item" : "items"}
          </p>
        </header>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Items</h2>
          {items.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No items yet — add your first one below.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <li key={item.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="text-foreground">{item.name}</span>
                  <span className="font-mono text-foreground">${Number(item.price).toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addItem} className="mt-3 flex gap-2 border-t border-border pt-3">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Item name"
              className="h-10 flex-1"
            />
            <Input
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              placeholder="0.00"
              type="number"
              step="0.01"
              className="h-10 w-20"
            />
            <Button type="submit" size="icon" disabled={adding || !newName.trim() || !newPrice} className="h-10 w-10 shrink-0">
              <Plus className="h-4 w-4" />
            </Button>
          </form>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <label className="rounded-2xl border border-border bg-card p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tax</div>
            <div className="mt-2 flex items-center gap-1">
              <span className="text-muted-foreground">$</span>
              <Input
                type="number"
                step="0.01"
                value={tax}
                onChange={(e) => updateField("tax_amount", parseFloat(e.target.value) || 0)}
                className="h-8 border-0 p-0 text-lg font-semibold focus-visible:ring-0"
              />
            </div>
          </label>
          <label className="rounded-2xl border border-border bg-card p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tip</div>
            <div className="mt-2 flex items-center gap-1">
              <Input
                type="number"
                value={tip}
                onChange={(e) => updateField("tip_percentage", parseFloat(e.target.value) || 0)}
                className="h-8 border-0 p-0 text-lg font-semibold focus-visible:ring-0"
              />
              <span className="text-muted-foreground">%</span>
            </div>
          </label>
        </section>

        <section className="rounded-2xl bg-secondary p-4">
          <div className="flex justify-between text-sm text-secondary-foreground">
            <span>Subtotal</span><span className="font-mono">${subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm text-secondary-foreground">
            <span>Tax</span><span className="font-mono">${tax.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm text-secondary-foreground">
            <span>Tip ({tip}%)</span><span className="font-mono">${tipAmount.toFixed(2)}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-border pt-2 font-bold text-foreground">
            <span>Total</span><span className="font-mono">${total.toFixed(2)}</span>
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-2xl border-2 border-primary/30 bg-accent p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-accent-foreground">Share with your table</div>
          <div className="text-2xl font-bold tracking-[0.3em] text-foreground">{session.share_code}</div>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="flex items-center justify-between rounded-lg bg-card p-3 text-sm"
          >
            <span className="truncate text-muted-foreground">{link}</span>
            {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
          </button>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> Joined ({guests.length})
          </div>
          {guests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one's here yet — share your code to get started.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {guests.map((g) => (
                <li key={g.id} className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-sm font-medium">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                    {g.display_name[0]?.toUpperCase()}
                  </span>
                  {g.display_name}
                </li>
              ))}
            </ul>
          )}
        </section>

        <Link to="/session/$code/claim" params={{ code: session.share_code }}>
          <Button variant="outline" size="lg" className="h-12 w-full text-base">View as guest →</Button>
        </Link>
      </div>
    </AppShell>
  );
}
