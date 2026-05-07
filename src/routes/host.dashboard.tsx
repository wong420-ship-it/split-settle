import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

const MAX_PRICE = 100000;
const MAX_TIP = 100;
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { Camera, Check, Copy, History, Loader2, MoreVertical, Pencil, Plus, Share2, Trash2, Upload, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";

type Session = {
  id: string;
  restaurant_name: string;
  tax_amount: number;
  tip_percentage: number;
  share_code: string;
};
type Item = { id: string; name: string; price: number };
type Guest = { id: string; display_name: string; paid_at: string | null };
type Claim = { item_id: string; user_id: string };

// Conservative client-side compression: only kicks in for big JPEG/PNG/WebP photos.
// Falls back to the original file on any failure or if the result isn't smaller.
async function maybeCompressImage(file: File): Promise<{ file: File; compressed: boolean }> {
  try {
    const SIZE_THRESHOLD = 1.5 * 1024 * 1024; // 1.5 MB
    const MAX_EDGE = 2000;
    const QUALITY = 0.92;
    const compressibleTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (file.size < SIZE_THRESHOLD) return { file, compressed: false };
    if (!compressibleTypes.includes(file.type.toLowerCase())) return { file, compressed: false };

    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) return { file, compressed: false };
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (longEdge <= MAX_EDGE) {
      bitmap.close?.();
      return { file, compressed: false };
    }
    const scale = MAX_EDGE / longEdge;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return { file, compressed: false };
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", QUALITY),
    );
    if (!blob || blob.size >= file.size) return { file, compressed: false };
    const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return { file: new File([blob], newName, { type: "image/jpeg" }), compressed: true };
  } catch {
    return { file, compressed: false };
  }
}

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
  const [hostGuestId, setHostGuestId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [adding, setAdding] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrStage, setOcrStage] = useState<"idle" | "optimizing" | "uploading" | "reading" | "retrying">("idle");
  const [ocrElapsed, setOcrElapsed] = useState(0);
  const [ocrFailed, setOcrFailed] = useState(false);
  const ocrAbortRef = useRef<AbortController | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewItems, setReviewItems] = useState<{ name: string; price: string }[]>([]);
  const [reviewTax, setReviewTax] = useState<number | null>(null);
  const [reviewFees, setReviewFees] = useState<{ name: string; amount: string }[]>([]);
  const [reviewRestaurant, setReviewRestaurant] = useState<string | null>(null);
  const [savingReview, setSavingReview] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hostInsertRef = useRef<Promise<Guest | null> | null>(null);
  const [tipInput, setTipInput] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [removeGuestTarget, setRemoveGuestTarget] = useState<Guest | null>(null);
  const [deleteBillOpen, setDeleteBillOpen] = useState(false);
  const [deletingBill, setDeletingBill] = useState(false);
  const [hasScannedReceipt, setHasScannedReceipt] = useState(false);

  // OCR elapsed-time ticker
  useEffect(() => {
    if (!ocrLoading) return;
    const start = Date.now();
    setOcrElapsed(0);
    const id = setInterval(() => setOcrElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(id);
  }, [ocrLoading]);

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
      // Apply remembered tip preference if this is a fresh bill (still default 18).
      if (typeof window !== "undefined" && Number(s.tip_percentage) === 18) {
        const savedRaw = localStorage.getItem("seatsolo:lastTipPct");
        const saved = savedRaw == null ? null : parseFloat(savedRaw);
        if (saved !== null && Number.isFinite(saved) && saved !== 18 && saved >= 0 && saved <= MAX_TIP) {
          await supabase.from("bill_sessions").update({ tip_percentage: saved }).eq("id", s.id);
          (s as Session).tip_percentage = saved;
          setSession({ ...(s as Session), tip_percentage: saved });
        }
      }
      const [{ data: its }, { data: gs }] = await Promise.all([
        supabase.from("bill_items").select("id, name, price").eq("session_id", s.id),
        supabase.from("session_users").select("id, display_name, paid_at").eq("session_id", s.id),
      ]);
      setItems((its ?? []) as Item[]);
      let guestList = (gs ?? []) as Guest[];
      // Auto-add host as a guest so they can claim items.
      const hostName =
        (u.user.user_metadata?.full_name as string | undefined) ||
        (u.user.user_metadata?.name as string | undefined) ||
        u.user.email?.split("@")[0] ||
        "Host";
      const hostKey = `seatsolo:host-guest:${s.id}`;
      let hostId = typeof window !== "undefined" ? localStorage.getItem(hostKey) : null;
      let existingHost = hostId ? guestList.find((g) => g.id === hostId) : null;
      // Fallback: if localStorage was cleared or this is a different device,
      // reuse any existing "(host)" guest on the session instead of inserting
      // a duplicate. Old bills opened from history would otherwise add a new
      // host row on every visit.
      if (!existingHost) {
        existingHost = guestList.find((g) => / \(host\)$/.test(g.display_name)) ?? null;
        if (existingHost) {
          hostId = existingHost.id;
          if (typeof window !== "undefined") localStorage.setItem(hostKey, existingHost.id);
        }
      }
      if (!existingHost) {
        // StrictMode-safe: dedupe concurrent inserts via a ref-stored promise.
        if (!hostInsertRef.current) {
          hostInsertRef.current = (async () => {
            const { data: inserted } = await supabase
              .from("session_users")
              .insert({ session_id: s.id, display_name: `${hostName} (host)` })
              .select("id, display_name, paid_at")
              .maybeSingle();
            if (inserted && typeof window !== "undefined") {
              localStorage.setItem(hostKey, inserted.id);
            }
            return inserted as Guest | null;
          })();
        }
        const inserted = await hostInsertRef.current;
        if (inserted) {
          hostId = inserted.id;
          if (!guestList.find((g) => g.id === inserted.id)) {
            guestList = [...guestList, inserted];
          }
        }
      }
      setHostGuestId(hostId);
      setGuests(guestList);
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
    // Subscribe per-item to keep claim updates scoped to this session.
    const itemIds = items.map((i) => i.id);
    const channel = supabase.channel(`host-${session.id}`);
    channel
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
            .select("id, display_name, paid_at")
            .eq("session_id", session.id)
            .then(({ data }) => {
              if (!data) return;
              const next = data as Guest[];
              setGuests((prev) => {
                const prevIds = new Set(prev.map((p) => p.id));
                for (const g of next) {
                  // Skip the host's own row when announcing new joiners.
                  const isHost = / \(host\)$/.test(g.display_name);
                  if (!prevIds.has(g.id) && !isHost && prev.length > 0) {
                    toast(`${g.display_name} joined`);
                  }
                  if (!g.paid_at) continue;
                  const before = prev.find((p) => p.id === g.id);
                  if (before && !before.paid_at) {
                    toast.success(`${g.display_name} marked as paid`);
                  }
                }
                return next;
              });
            });
        },
      );
    for (const id of itemIds) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "item_claims", filter: `item_id=eq.${id}` },
        () => refetchClaims(),
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session, items]);

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

  const allGuestsPaid = guests.length > 0 && guests.every((g) => g.paid_at);

  const updateField = async (field: "tax_amount" | "tip_percentage", value: number) => {
    if (!session) return;
    setSession({ ...session, [field]: value });
    const patch = field === "tax_amount" ? { tax_amount: value } : { tip_percentage: value };
    if (field === "tip_percentage" && typeof window !== "undefined") {
      localStorage.setItem("seatsolo:lastTipPct", String(value));
    }
    await supabase.from("bill_sessions").update(patch).eq("id", session.id);
  };

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !newName.trim() || !newPrice) return;
    const price = parseFloat(newPrice);
    if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) {
      toast.error("Price must be between $0.01 and $100,000.");
      return;
    }
    const name = newName.trim().slice(0, 120);
    setAdding(true);
    const { error } = await supabase
      .from("bill_items")
      .insert({ session_id: session.id, name, price });
    if (error) toast.error(error.message);
    setNewName("");
    setNewPrice("");
    setAdding(false);
  };

  const toggleClaim = async (itemId: string, userId: string, claimed: boolean) => {
    setClaims((prev) =>
      claimed
        ? prev.filter((c) => !(c.item_id === itemId && c.user_id === userId))
        : [...prev, { item_id: itemId, user_id: userId }],
    );
    if (claimed) {
      const { error } = await supabase
        .from("item_claims")
        .delete()
        .eq("item_id", itemId)
        .eq("user_id", userId);
      if (error) toast.error(error.message);
    } else {
      const { error } = await supabase
        .from("item_claims")
        .insert({ item_id: itemId, user_id: userId });
      if (error) toast.error(error.message);
    }
  };

  const startEditItem = (item: Item) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditPrice(String(item.price));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditPrice("");
  };

  const saveEdit = async (itemId: string) => {
    const name = editName.trim().slice(0, 120);
    const price = parseFloat(editPrice);
    if (!name) {
      toast.error("Name is required.");
      return;
    }
    if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) {
      toast.error("Price must be between $0.01 and $100,000.");
      return;
    }
    setSavingEdit(true);
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, name, price } : i)));
    const { error } = await supabase
      .from("bill_items")
      .update({ name, price })
      .eq("id", itemId);
    setSavingEdit(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    cancelEdit();
  };

  const confirmDeleteItem = async () => {
    if (!deleteId) return;
    const id = deleteId;
    setDeleteId(null);
    setItems((prev) => prev.filter((i) => i.id !== id));
    setClaims((prev) => prev.filter((c) => c.item_id !== id));
    // Delete dependent claims first (no FK cascade in schema).
    await supabase.from("item_claims").delete().eq("item_id", id);
    const { error } = await supabase.from("bill_items").delete().eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Item removed");
  };

  const confirmRemoveGuest = async () => {
    const g = removeGuestTarget;
    if (!g) return;
    setRemoveGuestTarget(null);
    setGuests((prev) => prev.filter((x) => x.id !== g.id));
    setClaims((prev) => prev.filter((c) => c.user_id !== g.id));
    const { error: claimsErr } = await supabase
      .from("item_claims")
      .delete()
      .eq("user_id", g.id);
    if (claimsErr) {
      toast.error(claimsErr.message);
      return;
    }
    const { error } = await supabase
      .from("session_users")
      .delete()
      .eq("id", g.id);
    if (error) toast.error(error.message);
    else toast.success(`Removed ${g.display_name}`);
  };

  const confirmDeleteBill = async () => {
    if (!session) return;
    setDeletingBill(true);
    const { error } = await supabase
      .from("bill_sessions")
      .delete()
      .eq("id", session.id);
    setDeletingBill(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (typeof window !== "undefined") {
      localStorage.removeItem(`seatsolo:host-guest:${session.id}`);
    }
    setDeleteBillOpen(false);
    toast.success("Bill deleted");
    navigate({ to: "/host/history" });
  };

  const claimAllUnclaimed = async () => {
    if (!session || !hostGuestId) return;
    const unclaimed = items.filter((i) => (claimsByItem.get(i.id) ?? []).length === 0);
    if (!unclaimed.length) return;
    const rows = unclaimed.map((i) => ({ item_id: i.id, user_id: hostGuestId }));
    setClaims((prev) => [...prev, ...rows]);
    const { error } = await supabase.from("item_claims").insert(rows);
    if (error) toast.error(error.message);
    else toast.success(`Claimed ${unclaimed.length} item${unclaimed.length === 1 ? "" : "s"}`);
  };

  const shareLink = async (link: string) => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "Join my bill on Seat Solo",
          text: `Join my bill on Seat Solo (code ${session?.share_code})`,
          url: link,
        });
        return;
      } catch (err) {
        // User cancelled — fall through to clipboard fallback only on real errors.
        if ((err as Error)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard?.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't share or copy.");
    }
  };

  const handleReceiptSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(file);
    setPendingPreview(URL.createObjectURL(file));
    void processReceipt(file);
  };

  const clearPending = () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(null);
    setPendingPreview(null);
  };

  const cancelOcr = () => {
    ocrAbortRef.current?.abort();
    ocrAbortRef.current = null;
    setOcrLoading(false);
    setOcrStage("idle");
    setOcrFailed(false);
    clearPending();
  };

  const processReceipt = async (fileArg?: File) => {
    const file = fileArg ?? pendingFile;
    if (!file || !session) return;
    setOcrLoading(true);
    setOcrFailed(false);
    setOcrElapsed(0);
    try {
      // 1. Optimize image (conservative; falls back to original)
      setOcrStage("optimizing");
      const { file: uploadFile } = await maybeCompressImage(file);

      // 2. Auth
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (!authSession?.access_token) {
        toast.error("Please sign in again to scan receipts.");
        setOcrLoading(false);
        setOcrStage("idle");
        return;
      }

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-receipt`;
      const fd = new FormData();
      fd.append("document", uploadFile);

      // 3. Fetch with timeout + 1 retry on hang/transient failure
      const attempt = async (): Promise<Response> => {
        const ctrl = new AbortController();
        ocrAbortRef.current = ctrl;
        const timer = setTimeout(() => ctrl.abort(), 35000);
        try {
          return await fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${authSession.access_token}` },
            body: fd,
            signal: ctrl.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      };

      setOcrStage("uploading");
      let resp: Response;
      try {
        resp = await attempt();
        setOcrStage("reading");
      } catch (e) {
        if ((e as Error).name === "AbortError" && !ocrAbortRef.current) {
          // user cancelled
          return;
        }
        setOcrStage("retrying");
        await new Promise((r) => setTimeout(r, 1000));
        resp = await attempt();
        setOcrStage("reading");
      }

      // Retry once on 5xx as well
      if (resp.status >= 500 && resp.status < 600) {
        setOcrStage("retrying");
        await new Promise((r) => setTimeout(r, 1000));
        resp = await attempt();
        setOcrStage("reading");
      }

      const json = await resp.json().catch(() => ({} as any));
      if (!resp.ok) {
        toast.error(json.error || "Couldn't read receipt.");
        setOcrFailed(true);
        return;
      }
      if (!json.items || json.items.length === 0) {
        toast.error("Couldn't read items from this receipt — please add them manually.");
        clearPending();
        return;
      }
      setReviewItems(json.items.map((i: any) => ({ name: i.name, price: String(i.price) })));
      setReviewTax(typeof json.tax === "number" ? json.tax : null);
      setReviewFees(
        Array.isArray(json.fees)
          ? json.fees.map((f: any) => ({ name: String(f.name ?? "Fee"), amount: String(f.amount) }))
          : [],
      );
      setReviewRestaurant(json.restaurant || null);
      setReviewOpen(true);
      clearPending();
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error("[parse-receipt] failed:", err);
      toast.error("Receipt upload failed. Tap Try again.");
      setOcrFailed(true);
    } finally {
      ocrAbortRef.current = null;
      setOcrLoading(false);
      setOcrStage("idle");
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
    const payload = rows.map((r) => ({ session_id: session.id, name: r.name, price: r.price }));
    const { data: inserted, error } = await supabase
      .from("bill_items")
      .insert(payload)
      .select("id, name, price");
    if (error) {
      console.error("[parse-receipt] insert failed:", error);
      toast.error(`Couldn't add items: ${error.message}`);
      setSavingReview(false);
      return;
    }
    if (!inserted || inserted.length === 0) {
      console.error("[parse-receipt] insert returned no rows", { payload });
      toast.error("Items didn't save. Please try again or add manually.");
      setSavingReview(false);
      return;
    }
    if (inserted.length !== rows.length) {
      toast.warning(`Only ${inserted.length} of ${rows.length} items saved.`);
    }
    // Optimistically merge so the user sees them immediately even if realtime is delayed
    setItems((prev) => {
      const ids = new Set(prev.map((p) => p.id));
      const fresh = (inserted as Item[]).filter((i) => !ids.has(i.id));
      return [...prev, ...fresh];
    });
    const feesTotal = reviewFees.reduce((s, f) => {
      const n = parseFloat(f.amount);
      return Number.isFinite(n) && n > 0 ? s + n : s;
    }, 0);
    const patch: { tax_amount?: number; restaurant_name?: string } = {};
    const addTax = (reviewTax ?? 0) + feesTotal;
    if (addTax > 0) {
      // Append to existing tax instead of overwriting (e.g. multiple receipts).
      patch.tax_amount = Number(session.tax_amount ?? 0) + addTax;
    }
    if (reviewRestaurant && (!session.restaurant_name || session.restaurant_name === "My Bill")) {
      patch.restaurant_name = reviewRestaurant;
    }
    if (Object.keys(patch).length) {
      await supabase.from("bill_sessions").update(patch).eq("id", session.id);
      setSession({ ...session, ...patch });
    }
    setSavingReview(false);
    setReviewOpen(false);
    setHasScannedReceipt(true);
    toast.success(`Added ${inserted.length} item${inserted.length === 1 ? "" : "s"}.`);
  };

  if (loading || !session) {
    return (
      <AppShell>
        <div className="flex flex-col gap-6">
          <div className="space-y-2">
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
            <div className="h-7 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 h-3 w-12 animate-pulse rounded bg-muted" />
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-muted/60" />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="h-20 animate-pulse rounded-2xl bg-card" />
            <div className="h-20 animate-pulse rounded-2xl bg-card" />
          </div>
          <div className="h-24 animate-pulse rounded-2xl bg-secondary" />
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

  // Per-guest running totals (subtotal share + proportional tax/tip).
  const guestTotals = new Map<string, number>();
  for (const g of guests) {
    const sub = items.reduce((s, i) => {
      const claimers = claimsByItem.get(i.id) ?? [];
      if (!claimers.includes(g.id)) return s;
      return s + Number(i.price) / claimers.length;
    }, 0);
    const ratio = subtotal > 0 ? sub / subtotal : 0;
    guestTotals.set(g.id, sub + tax * ratio + tipAmount * ratio);
  }

  // Host's own share, computed the same way as guests.
  const hostItems = hostGuestId
    ? items
        .filter((i) => (claimsByItem.get(i.id) ?? []).includes(hostGuestId))
        .map((i) => {
          const n = (claimsByItem.get(i.id) ?? []).length || 1;
          return { ...i, share: Number(i.price) / n, splitN: n };
        })
    : [];
  const hostSubtotal = hostItems.reduce((s, i) => s + i.share, 0);
  const hostShareRatio = subtotal > 0 ? hostSubtotal / subtotal : 0;
  const hostTax = tax * hostShareRatio;
  const hostTip = tipAmount * hostShareRatio;
  const hostTotal = hostSubtotal + hostTax + hostTip;
  const hostGuest = guests.find((g) => g.id === hostGuestId) ?? null;
  const hostPaidAt = hostGuest?.paid_at ?? null;

  const toggleHostPaid = async () => {
    if (!hostGuestId) return;
    const next = hostPaidAt ? null : new Date().toISOString();
    setGuests((prev) =>
      prev.map((g) => (g.id === hostGuestId ? { ...g, paid_at: next } : g)),
    );
    const { error } = await supabase
      .from("session_users")
      .update({ paid_at: next })
      .eq("id", hostGuestId);
    if (error) {
      toast.error(`Couldn't update: ${error.message}`);
      setGuests((prev) =>
        prev.map((g) => (g.id === hostGuestId ? { ...g, paid_at: hostPaidAt } : g)),
      );
      return;
    }
    toast.success(next ? "Marked as paid" : "Marked unpaid");
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-6 pb-32">
        <header>
          <div className="flex items-center justify-between">
            <Link to="/" className="text-xs text-muted-foreground">← Back</Link>
            <div className="flex items-center gap-1">
              <Link
                to="/host/history"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <History className="h-3.5 w-3.5" /> Your bills
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Bill options"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={(e) => {
                      e.preventDefault();
                      setDeleteBillOpen(true);
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Delete this bill
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
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
                const claimerSet = new Set(claimers);
                const isEditing = editingId === item.id;
                return (
                  <li key={item.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                    {isEditing ? (
                      <div className="flex w-full flex-col gap-2">
                        <div className="flex gap-2">
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="Item name"
                            className="h-9 flex-1"
                            autoFocus
                          />
                          <Input
                            value={editPrice}
                            onChange={(e) => setEditPrice(e.target.value)}
                            placeholder="0.00"
                            type="number"
                            step="0.01"
                            className="h-9 w-20"
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={cancelEdit}
                            disabled={savingEdit}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => saveEdit(item.id)}
                            disabled={savingEdit}
                          >
                            {savingEdit ? "Saving…" : "Save"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="text-foreground">{item.name}</span>
                          {splitN === 0 ? (
                            <span className={`text-xs ${allGuestsPaid ? "text-destructive font-medium" : "text-muted-foreground"}`}>Unclaimed</span>
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
                        <div className="flex items-center gap-1.5 shrink-0">
                          <div className="flex flex-col items-end">
                            <span className="font-mono text-foreground">${Number(item.price).toFixed(2)}</span>
                            {splitN > 1 && (
                              <span className="font-mono text-xs text-muted-foreground">
                                ${(Number(item.price) / splitN).toFixed(2)} ea
                              </span>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            onClick={() => startEditItem(item)}
                            aria-label="Edit item"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                disabled={guests.length === 0}
                                aria-label="Assign item"
                              >
                                <UserPlus className="h-3.5 w-3.5" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-56 p-2">
                              <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Assign to
                              </div>
                              {guests.length === 0 ? (
                                <p className="px-2 py-1 text-xs text-muted-foreground">No one's joined yet.</p>
                              ) : (
                                <ul className="flex flex-col">
                                  {guests.map((g) => {
                                    const checked = claimerSet.has(g.id);
                                    return (
                                      <li key={g.id}>
                                        <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary">
                                          <Checkbox
                                            checked={checked}
                                            onCheckedChange={() => toggleClaim(item.id, g.id, checked)}
                                          />
                                          <span className="flex-1 truncate">
                                            {g.display_name}
                                            {g.id === hostGuestId && " (you)"}
                                          </span>
                                        </label>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </PopoverContent>
                          </Popover>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteId(item.id)}
                            aria-label="Delete item"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </>
                    )}
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
                <div className="relative h-24 w-24 shrink-0">
                  <img
                    src={pendingPreview}
                    alt="Receipt preview"
                    className={`h-24 w-24 rounded-md border border-border object-cover transition ${
                      ocrLoading ? "brightness-50" : ""
                    }`}
                  />
                  {ocrLoading && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 className="h-7 w-7 animate-spin text-white drop-shadow" />
                    </div>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {pendingFile?.name || "Receipt"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ocrLoading
                        ? `${
                            ocrStage === "optimizing"
                              ? "Optimizing image…"
                              : ocrStage === "uploading"
                                ? "Uploading…"
                                : ocrStage === "retrying"
                                  ? "Retrying…"
                                  : "Reading receipt…"
                          } ${ocrElapsed}s`
                        : ocrFailed
                          ? "Couldn't read this receipt."
                          : "Ready"}
                    </p>
                    {ocrLoading && ocrStage === "reading" && ocrElapsed >= 15 && ocrElapsed < 25 && (
                      <p className="mt-1 text-xs text-muted-foreground">Taking longer than usual — still working…</p>
                    )}
                    {ocrLoading && ocrStage === "reading" && ocrElapsed >= 25 && (
                      <p className="mt-1 text-xs text-muted-foreground">If this hangs we'll retry automatically.</p>
                    )}
                  </div>
                  {ocrLoading && (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full w-1/3 rounded-full bg-primary"
                        style={{ animation: "ocr-progress 1.4s ease-in-out infinite" }}
                      />
                    </div>
                  )}
                </div>
              </div>
              {ocrLoading ? (
                <Button type="button" variant="ghost" onClick={cancelOcr} className="h-10 w-full">
                  Cancel
                </Button>
              ) : ocrFailed ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setOcrFailed(false);
                      clearPending();
                    }}
                    className="h-10"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void processReceipt(pendingFile ?? undefined)}
                    className="h-10"
                  >
                    Try again
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="ghost" onClick={clearPending} className="h-10 w-full">
                  Cancel
                </Button>
              )}
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {hasScannedReceipt && (
                <p className="text-xs text-muted-foreground">
                  Got another receipt? Scan it to merge items into this bill.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={ocrLoading}
                  className="h-10"
                >
                  <Camera className="mr-2 h-4 w-4" />
                  {hasScannedReceipt ? "Scan another" : "Take photo"}
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
            </div>
          )}
        </section>

        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tax</div>
            <div className="mt-2 flex items-center gap-1">
              <span className="text-muted-foreground">$</span>
              <span className="text-lg font-semibold text-foreground">{tax.toFixed(2)}</span>
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">From receipt</div>
          </div>
          <label className="rounded-2xl border border-border bg-card p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tip</div>
            <div className="mt-2 flex items-center gap-1">
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                max={MAX_TIP}
                value={tipInput === "" ? (Number.isFinite(tip) ? String(tip) : "") : tipInput}
                onChange={(e) => {
                  const raw = e.target.value;
                  setTipInput(raw);
                  if (raw === "") {
                    updateField("tip_percentage", 0);
                    return;
                  }
                  const n = parseFloat(raw);
                  if (Number.isFinite(n) && n >= 0 && n <= MAX_TIP) {
                    updateField("tip_percentage", n);
                  }
                }}
                onBlur={() => setTipInput("")}
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

        {hostGuestId && (
          <section
            className={`sticky bottom-2 z-10 flex flex-col gap-3 rounded-2xl p-5 shadow-lg ${
              hostPaidAt
                ? "bg-secondary text-secondary-foreground"
                : "bg-primary text-primary-foreground"
            }`}
          >
            <div>
              <div className="text-xs uppercase tracking-wider opacity-80">
                {hostPaidAt ? "You paid" : "Your share"}
              </div>
              <div className="font-mono text-4xl font-bold">${hostTotal.toFixed(2)}</div>
              <div className="mt-1 text-xs opacity-80">
                {hostItems.length === 0
                  ? "Claim items above to add to your share"
                  : `${hostItems.length} item${hostItems.length === 1 ? "" : "s"} · ${(hostShareRatio * 100).toFixed(0)}% of bill`}
              </div>
              {hostPaidAt && (
                <div className="mt-1 text-xs opacity-80">
                  Marked paid {new Date(hostPaidAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </div>
              )}
            </div>
            <Button
              variant={hostPaidAt ? "outline" : "secondary"}
              size="lg"
              className="h-11"
              onClick={toggleHostPaid}
            >
              {hostPaidAt ? (
                <>
                  <Check className="mr-2 h-4 w-4" /> Paid — tap to undo
                </>
              ) : (
                "Mark as paid"
              )}
            </Button>
          </section>
        )}

        <section className="flex flex-col gap-3 rounded-2xl border-2 border-primary/30 bg-accent p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-accent-foreground">Share with your table</div>
          <div className="text-2xl font-bold tracking-[0.3em] text-foreground">{session.share_code}</div>
          <Button
            type="button"
            size="lg"
            className="h-11 w-full"
            onClick={() => void shareLink(link)}
          >
            <Share2 className="mr-2 h-4 w-4" /> Share link
          </Button>
          <button
            type="button"
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

        {guests.length > 0 && (() => {
          const paidCount = guests.filter((g) => g.paid_at).length;
          const allPaid = paidCount === guests.length;
          const pct = Math.round((paidCount / guests.length) * 100);
          const unclaimedItems = items.filter((i) => (claimsByItem.get(i.id) ?? []).length === 0);
          const unclaimedTotal = unclaimedItems.reduce((s, i) => s + Number(i.price), 0);
          const hasUnclaimed = unclaimedItems.length > 0;
          const paidButUnclaimed = allPaid && hasUnclaimed;
          const fullyDone = allPaid && !hasUnclaimed;
          return (
            <section
              className={`rounded-2xl border p-4 ${
                paidButUnclaimed
                  ? "border-destructive bg-destructive/10"
                  : fullyDone
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card"
              }`}
            >
              <div className="flex items-center justify-between text-sm font-semibold">
                <span className={paidButUnclaimed ? "text-destructive" : "text-foreground"}>
                  {paidButUnclaimed
                    ? "Paid — but items are unclaimed"
                    : fullyDone
                    ? "Everyone has paid 🎉"
                    : "Payments"}
                </span>
                <span className="font-mono text-foreground">
                  {paidCount} / {guests.length}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className={`h-full transition-all ${paidButUnclaimed ? "bg-destructive" : "bg-primary"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {!allPaid && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Waiting on{" "}
                  {guests
                    .filter((g) => !g.paid_at)
                    .map((g) => g.display_name)
                    .join(", ")}
                </p>
              )}
              {paidButUnclaimed && (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-destructive">
                    {unclaimedItems.map((i) => i.name).join(", ")} · ${unclaimedTotal.toFixed(2)} not covered
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Claim them yourself or assign to a guest before closing out.
                  </p>
                  {hostGuestId && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={claimAllUnclaimed}
                    >
                      Claim leftovers
                    </Button>
                  )}
                </div>
              )}
            </section>
          );
        })()}

        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> Joined ({guests.length})
          </div>
          {guests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one's here yet — share your code to get started.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {guests.map((g) => (
                <li
                  key={g.id}
                  className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${
                    g.paid_at
                      ? "bg-primary/15 text-foreground"
                      : "bg-secondary text-secondary-foreground"
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      g.paid_at
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {g.paid_at ? <Check className="h-3.5 w-3.5" /> : g.display_name[0]?.toUpperCase()}
                  </span>
                  <span>{g.display_name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    ${(guestTotals.get(g.id) ?? 0).toFixed(2)}
                  </span>
                  {g.paid_at && (
                    <span className="text-xs font-normal text-primary">paid</span>
                  )}
                  {g.id !== hostGuestId && (
                    <button
                      type="button"
                      onClick={() => setRemoveGuestTarget(g)}
                      aria-label={`Remove ${g.display_name}`}
                      className="-mr-1 ml-0.5 flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
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
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Tax & fees
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setReviewFees([...reviewFees, { name: "", amount: "" }])}
              >
                <Plus className="mr-1 h-3 w-3" /> Add fee
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Input value="Tax" disabled className="flex-1" />
              <Input
                type="number"
                step="0.01"
                value={reviewTax ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setReviewTax(v === "" ? null : parseFloat(v));
                }}
                placeholder="0.00"
                className="w-20"
              />
            </div>
            {reviewFees.map((fee, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={fee.name}
                  onChange={(e) => {
                    const next = [...reviewFees];
                    next[idx] = { ...next[idx], name: e.target.value };
                    setReviewFees(next);
                  }}
                  placeholder="Service fee"
                  className="flex-1"
                />
                <Input
                  type="number"
                  step="0.01"
                  value={fee.amount}
                  onChange={(e) => {
                    const next = [...reviewFees];
                    next[idx] = { ...next[idx], amount: e.target.value };
                    setReviewFees(next);
                  }}
                  placeholder="0.00"
                  className="w-20"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setReviewFees(reviewFees.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Tax & fees are split across the table proportionally to each person's share.
            </p>
          </div>
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

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the item and any claims on it. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteItem}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteBillOpen} onOpenChange={(open) => !deletingBill && setDeleteBillOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this bill?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const isOpen = guests.some((g) => !g.paid_at) || items.some((i) => (claimsByItem.get(i.id) ?? []).length === 0);
                return isOpen
                  ? "This bill still has unpaid guests or unclaimed items. Deleting it permanently removes the bill, all items, guests, and claims. This can't be undone."
                  : "This permanently removes the bill, all items, guests, and claims. This can't be undone.";
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingBill}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteBill();
              }}
              disabled={deletingBill}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingBill ? "Deleting…" : "Delete bill"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!removeGuestTarget} onOpenChange={(open) => !open && setRemoveGuestTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeGuestTarget?.display_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They'll be removed from the bill and any items they claimed will become unclaimed. They can rejoin with the share code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemoveGuest}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
