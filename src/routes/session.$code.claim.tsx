import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/AppShell";
import { mockBill, type Item } from "@/lib/mockData";
import { Check } from "lucide-react";

const ME = "You";

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
  const [items, setItems] = useState<Item[]>(mockBill.items);

  const toggle = (id: string) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, claimedBy: i.claimedBy === ME ? null : i.claimedBy ? i.claimedBy : ME }
          : i,
      ),
    );
  };

  const myTotal = items.filter((i) => i.claimedBy === ME).reduce((s, i) => s + i.price, 0);

  return (
    <AppShell>
      <div className="flex flex-col gap-5">
        <header>
          <Link to="/host/dashboard" className="text-xs text-muted-foreground">← Back to host view</Link>
          <h1 className="mt-2 text-2xl font-bold">{mockBill.restaurant}</h1>
          <p className="text-sm text-muted-foreground">Tap the items you ordered.</p>
        </header>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">No items yet — your host is adding them.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {items.map((item) => {
              const mine = item.claimedBy === ME;
              const taken = !!item.claimedBy && !mine;
              return (
                <li key={item.id}>
                  <button
                    onClick={() => toggle(item.id)}
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
                          `Claimed by ${item.claimedBy}`
                        ) : (
                          "Tap to claim"
                        )}
                      </span>
                    </div>
                    <span className="font-mono font-semibold text-foreground">${item.price.toFixed(2)}</span>
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
