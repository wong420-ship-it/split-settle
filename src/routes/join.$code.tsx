import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { getGuest, setGuest } from "@/lib/guest";
import { toast } from "sonner";

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

  // If already joined, skip ahead
  useEffect(() => {
    const existing = getGuest(code);
    if (existing) navigate({ to: "/session/$code/claim", params: { code } });
  }, [code, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return;
    setLoading(true);
    const { data: s, error: se } = await supabase
      .from("bill_sessions")
      .select("id")
      .eq("share_code", code.toUpperCase())
      .maybeSingle();
    if (se || !s) {
      toast.error("Code not found");
      setLoading(false);
      return;
    }
    const { data: u, error } = await supabase
      .from("session_users")
      .insert({ session_id: s.id, display_name: trimmed })
      .select("id, display_name")
      .single();
    if (error || !u) {
      toast.error(error?.message ?? "Could not join");
      setLoading(false);
      return;
    }
    setGuest(code, { id: u.id, name: u.display_name });
    navigate({ to: "/session/$code/claim", params: { code } });
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
