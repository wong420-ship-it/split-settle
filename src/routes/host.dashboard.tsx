import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { Camera, Check, Copy, Plus, Trash2, Upload, Users } from "lucide-react";
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
type Item = { id: string; name: string; price: number };
type Guest = { id: string; display_name: string };
type Claim = { item_id: string; user_id: string };

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
  const [claims, setClaims] = useState<Claim[]>([]);
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
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
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

  // Realtime
  useEffect(() => {
    if (!session) return;
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
      .channel(`host-${session.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bill_items", filter: `session_id=eq.${session.id}` },
        () => {
          supabase
            .from("bill_items")
            .select("id, name, price")
            .eq("session_id", session.id)
            .then(({ data }) => data && setItems(data as Item[]));
          refetchClaims();
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "item_claims" },
        () => refetchClaims(),
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

  const guestName = (id: string) => guests.find((g) => g.id === id)?.display_name ?? "Someone";

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

  const handleReceiptSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(file);
    setPendingPreview(URL.createObjectURL(file));
  };

  const clearPending = () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(null);
    setPendingPreview(null);
  };

  const processReceipt = async () => {
    if (!pendingFile || !session) return;
    setOcrLoading(true);
    try {
      const fd = new FormData();
      fd.append("document", pendingFile);
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
        clearPending();
        return;
      }
      setReviewItems(json.items.map((i: any) => ({ name: i.name, price: String(i.price) })));
      setReviewTax(typeof json.tax === "number" ? json.tax : null);
      setReviewRestaurant(json.restaurant || null);
      setReviewOpen(true);
      clearPending();
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
    const patch: { tax_amount?: number; restaurant_name?: string } = {};
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

  if (loading || !session) {
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
              {items.map((item) => {
                const claimers = claimsByItem.get(item.id) ?? [];
                const splitN = claimers.length;
                return (
                  <li key={item.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-foreground">{item.name}</span>
                      {splitN === 0 ? (
                        <span className="text-xs text-muted-foreground">Unclaimed</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-primary">
                          {splitN > 1 ? <Users className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                          <span className="truncate">
                            {claimers.map(guestName).join(", ")}
                            {splitN > 1 && ` · split ${splitN} ways`}
                          </span>
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className="font-mono text-foreground">${Number(item.price).toFixed(2)}</span>
                      {splitN > 1 && (
                        <span className="font-mono text-xs text-muted-foreground">
                          ${(Number(item.price) / splitN).toFixed(2)} ea
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
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
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleReceiptSelect}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleReceiptSelect}
          />
          {pendingPreview ? (
            <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-secondary/40 p-3">
              <div className="flex gap-3">
                <img
                  src={pendingPreview}
                  alt="Receipt preview"
                  className="h-24 w-24 shrink-0 rounded-md border border-border object-cover"
                />
                <div className="flex min-w-0 flex-1 flex-col justify-between">
                  <p className="truncate text-sm font-medium text-foreground">
                    {pendingFile?.name || "Receipt"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Ready to scan. Review the image, then read items.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={clearPending}
                  disabled={ocrLoading}
                  className="h-10 flex-1"
                >
                  Remove
                </Button>
                <Button
                  type="button"
                  onClick={processReceipt}
                  disabled={ocrLoading}
                  className="h-10 flex-1"
                >
                  {ocrLoading ? "Reading…" : "Read items"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => cameraInputRef.current?.click()}
                disabled={ocrLoading}
                className="h-10"
              >
                <Camera className="mr-2 h-4 w-4" />
                Take photo
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={ocrLoading}
                className="h-10"
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload image
              </Button>
            </div>
          )}
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

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review receipt items</DialogTitle>
          </DialogHeader>
          {reviewRestaurant && (
            <p className="text-sm text-muted-foreground">From: {reviewRestaurant}</p>
          )}
          <div className="flex flex-col gap-2">
            {reviewItems.map((row, idx) => (
              <div key={idx} className="flex gap-2">
                <Input
                  value={row.name}
                  onChange={(e) => {
                    const next = [...reviewItems];
                    next[idx] = { ...next[idx], name: e.target.value };
                    setReviewItems(next);
                  }}
                  placeholder="Item"
                  className="flex-1"
                />
                <Input
                  value={row.price}
                  onChange={(e) => {
                    const next = [...reviewItems];
                    next[idx] = { ...next[idx], price: e.target.value };
                    setReviewItems(next);
                  }}
                  type="number"
                  step="0.01"
                  className="w-20"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setReviewItems(reviewItems.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setReviewItems([...reviewItems, { name: "", price: "" }])}
            >
              <Plus className="mr-1 h-4 w-4" /> Add row
            </Button>
          </div>
          {reviewTax != null && (
            <p className="text-sm text-muted-foreground">Tax detected: ${reviewTax.toFixed(2)}</p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReviewOpen(false)} disabled={savingReview}>
              Cancel
            </Button>
            <Button onClick={saveReview} disabled={savingReview}>
              {savingReview ? "Adding…" : "Add to bill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
