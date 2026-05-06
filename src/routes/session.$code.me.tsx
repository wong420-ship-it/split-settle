import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { mockBill } from "@/lib/mockData";

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
  // Mock: pretend "You" claimed items 2 and 4
  const myItems = [mockBill.items[1], mockBill.items[3]];
  const subtotal = myItems.reduce((s, i) => s + i.price, 0);
  const billSubtotal = mockBill.items.reduce((s, i) => s + i.price, 0);
  const share = billSubtotal > 0 ? subtotal / billSubtotal : 0;
  const myTax = mockBill.tax * share;
  const myTip = ((billSubtotal * mockBill.tipPercent) / 100) * share;
  const total = subtotal + myTax + myTip;

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header>
          <Link to="/session/$code/claim" params={{ code }} className="text-xs text-muted-foreground">
            ← Back to items
          </Link>
          <h1 className="mt-2 text-2xl font-bold">Your share</h1>
          <p className="text-sm text-muted-foreground">at {mockBill.restaurant}</p>
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
                  <span className="font-mono">${item.price.toFixed(2)}</span>
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
