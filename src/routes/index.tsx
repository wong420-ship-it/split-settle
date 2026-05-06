import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";
import seatSoloLogo from "@/assets/seatsolo-mark.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Seat Solo — Dine together, Pay Alone" },
      {
        name: "description",
        content:
          "Split a restaurant bill in real time. Each guest claims their own items — no math, no awkwardness.",
      },
    ],
  }),
  component: Index,
});

async function createSessionAndGo(navigate: ReturnType<typeof useNavigate>) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return;
  const { data, error } = await supabase
    .from("bill_sessions")
    .insert({ host_id: userData.user.id, restaurant_name: "My Bill" })
    .select("share_code")
    .single();
  if (error || !data) {
    toast.error(error?.message ?? "Could not create bill");
    return;
  }
  navigate({ to: "/host/dashboard", search: { code: data.share_code } });
}

function Index() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"host" | "join" | null>(null);

  // If we land back here after OAuth with a session, auto-create a bill.
  useEffect(() => {
    const pending = typeof window !== "undefined" && sessionStorage.getItem("seatsolo:pendingHost");
    if (!pending) return;
    sessionStorage.removeItem("seatsolo:pendingHost");
    setLoading("host");
    (async () => {
      // Wait briefly for session to hydrate
      for (let i = 0; i < 20; i++) {
        const { data } = await supabase.auth.getSession();
        if (data.session) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      await createSessionAndGo(navigate);
      setLoading(null);
    })();
  }, [navigate]);

  const startBill = async () => {
    setLoading("host");
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session) {
      await createSessionAndGo(navigate);
      setLoading(null);
      return;
    }
    sessionStorage.setItem("seatsolo:pendingHost", "1");
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      sessionStorage.removeItem("seatsolo:pendingHost");
      toast.error("Sign-in failed. Please try again.");
      setLoading(null);
      return;
    }
    if (result.redirected) return;
    // Tokens returned inline
    await createSessionAndGo(navigate);
    setLoading(null);
  };

  const joinBill = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) return;
    setLoading("join");
    const { data, error } = await supabase
      .from("bill_sessions")
      .select("share_code")
      .eq("share_code", trimmed)
      .maybeSingle();
    if (error) {
      toast.error("Couldn't check code. Try again.");
      setLoading(null);
      return;
    }
    if (!data) {
      toast.error("Code not found");
      setLoading(null);
      return;
    }
    navigate({ to: "/join/$code", params: { code: trimmed } });
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-10 pt-8">
        <header className="flex flex-col gap-3">
          <div className="flex justify-end">
            <img src={seatSoloLogo} alt="Seat Solo" className="h-20 w-auto" />
          </div>
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-foreground">
            Dine Together,
            <br />
            <span className="text-primary">Pay Alone.</span>
          </h1>
          <p className="text-base text-muted-foreground">
            Snap the receipt. Share a code. Everyone taps what they had. No math.
          </p>
        </header>

        <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">Hosting dinner?</h2>
          <Button
            size="lg"
            className="h-12 w-full text-base"
            onClick={startBill}
            disabled={loading !== null}
          >
            {loading === "host" ? "Starting…" : "Start a New Bill"}
          </Button>
          <p className="text-xs text-muted-foreground">
            You'll sign in with Google so only you can edit your bill.
          </p>
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
        </section>
      </div>
    </AppShell>
  );
}
