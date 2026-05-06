import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppShell } from "@/components/AppShell";
import { mockBill } from "@/lib/mockData";
import { Check, Copy, Users } from "lucide-react";

export const Route = createFileRoute("/host/dashboard")({
  head: () => ({
    meta: [
      { title: "Host Dashboard — Seat Solo" },
      { name: "description", content: "Review your parsed receipt and share with guests." },
    ],
  }),
  component: HostDashboard,
});

function HostDashboard() {
  const [tax, setTax] = useState(mockBill.tax);
  const [tip, setTip] = useState(mockBill.tipPercent);
  const [shared, setShared] = useState(false);
  const [copied, setCopied] = useState(false);

  const subtotal = mockBill.items.reduce((s, i) => s + i.price, 0);
  const tipAmount = (subtotal * tip) / 100;
  const total = subtotal + tax + tipAmount;
  const link = `seatsolo.app/join/${mockBill.code}`;

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header>
          <Link to="/" className="text-xs text-muted-foreground">← Back</Link>
          <h1 className="mt-2 text-2xl font-bold">{mockBill.restaurant}</h1>
          <p className="text-sm text-muted-foreground">Receipt parsed · {mockBill.items.length} items</p>
        </header>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Items</h2>
          <ul className="divide-y divide-border">
            {mockBill.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-foreground">{item.name}</span>
                <span className="font-mono text-foreground">${item.price.toFixed(2)}</span>
              </li>
            ))}
          </ul>
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
                onChange={(e) => setTax(parseFloat(e.target.value) || 0)}
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
                onChange={(e) => setTip(parseFloat(e.target.value) || 0)}
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

        {!shared ? (
          <Button size="lg" className="h-12 text-base" onClick={() => setShared(true)}>
            Generate Share Link
          </Button>
        ) : (
          <section className="flex flex-col gap-3 rounded-2xl border-2 border-primary/30 bg-accent p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-accent-foreground">Share with your table</div>
            <div className="text-2xl font-bold tracking-[0.3em] text-foreground">{mockBill.code}</div>
            <button
              onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="flex items-center justify-between rounded-lg bg-card p-3 text-sm"
            >
              <span className="truncate text-muted-foreground">{link}</span>
              {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
            </button>
          </section>
        )}

        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> Joined ({mockBill.guests.length})
          </div>
          {mockBill.guests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one's here yet — share your code to get started.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {mockBill.guests.map((g) => (
                <li key={g} className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-sm font-medium">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                    {g[0]}
                  </span>
                  {g}
                </li>
              ))}
            </ul>
          )}
        </section>

        <Link to="/session/$code/claim" params={{ code: mockBill.code }}>
          <Button variant="outline" size="lg" className="h-12 w-full text-base">View as guest →</Button>
        </Link>
      </div>
    </AppShell>
  );
}
