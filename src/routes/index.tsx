import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Seat Solo — Split the bill, item by item" },
      {
        name: "description",
        content:
          "Split a restaurant bill in real time. Each guest claims their own items — no math, no awkwardness.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState<"host" | "join" | null>(null);

  const startBill = () => {
    setLoading("host");
    setTimeout(() => navigate({ to: "/host/dashboard" }), 400);
  };

  const joinBill = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 4) return;
    setLoading("join");
    setTimeout(
      () => navigate({ to: "/join/$code", params: { code: code.toUpperCase() } }),
      400,
    );
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-10 pt-8">
        <header className="flex flex-col gap-3">
          <div className="inline-flex w-fit items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
            <span className="h-2 w-2 rounded-full bg-primary" /> Seat Solo
          </div>
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-foreground">
            Split the bill,
            <br />
            <span className="text-primary">item by item.</span>
          </h1>
          <p className="text-base text-muted-foreground">
            Snap the receipt. Share a code. Everyone taps what they had. No math.
          </p>
        </header>

        <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">Hosting dinner?</h2>
          <Button size="lg" className="h-12 w-full text-base" onClick={startBill} disabled={loading !== null}>
            {loading === "host" ? "Starting…" : "Start a New Bill"}
          </Button>
        </section>

        <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">Got a code?</h2>
          <form onSubmit={joinBill} className="flex flex-col gap-3">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="6-character code"
              maxLength={6}
              className="h-12 text-center text-lg font-mono tracking-[0.4em] uppercase"
            />
            <Button
              type="submit"
              variant="secondary"
              size="lg"
              className="h-12 w-full text-base"
              disabled={code.trim().length < 4 || loading !== null}
            >
              {loading === "join" ? "Joining…" : "Join a Bill"}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Try <button type="button" className="underline" onClick={() => setCode("TONY42")}>TONY42</button> for a demo.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
