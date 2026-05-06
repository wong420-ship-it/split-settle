import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/join/$code")({
  head: () => ({
    meta: [
      { title: "Join Bill — Seat Solo" },
      { name: "description", content: "Join your table to claim your items." },
    ],
  }),
  component: Join,
});

function Join() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setTimeout(() => navigate({ to: "/session/$code/claim", params: { code } }), 500);
  };

  return (
    <AppShell>
      <div className="flex min-h-[80vh] flex-col justify-center gap-8">
        <div className="flex flex-col gap-2 text-center">
          <div className="mx-auto inline-flex w-fit items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
            Joining bill <span className="font-mono font-bold">{code}</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">What's your name?</h1>
          <p className="text-sm text-muted-foreground">So your table knows who claimed what.</p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="First name"
            className="h-14 text-center text-lg"
          />
          <Button type="submit" size="lg" className="h-12 text-base" disabled={!name.trim() || loading}>
            {loading ? "Joining…" : "Join the table"}
          </Button>
        </form>
      </div>
    </AppShell>
  );
}
