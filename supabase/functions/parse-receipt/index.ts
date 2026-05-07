// Receipt OCR via Lovable AI Gateway (Gemini vision)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "Receipt parsing is not configured." }, 500);

    // --- Auth: require a logged-in user (host) ---
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return json({ error: "Server misconfigured." }, 500);
    }
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    if (!token) return json({ error: "Unauthorized" }, 401);
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return json({ error: "Please upload an image file." }, 400);
    }

    const form = await req.formData();
    const file = form.get("document");
    if (!(file instanceof File)) {
      return json({ error: "No image file was provided." }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    // base64 encode
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const b64 = btoa(bin);
    const mime = file.type || "image/jpeg";
    const dataUrl = `data:${mime};base64,${b64}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let resp: Response;
    try {
      resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content:
                "You extract structured data from receipt images. Respond ONLY with valid JSON matching the requested schema. No prose.",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Extract line items, tax, fees, total, and restaurant/merchant name from this receipt.
Return JSON exactly in this shape:
{
  "restaurant": string | null,
  "items": [{ "name": string, "quantity": number, "unit_price": number }],
  "fees": [{ "name": string, "amount": number }],
  "tax": number | null,
  "total": number | null
}
- Use the merchant/restaurant name from the top of the receipt.
- Each item is one ordered line item. "quantity" is how many were ordered (e.g. "3 Chocolate Cake" => quantity 3). Default to 1 if not shown.
- "unit_price" is the price for ONE of that item (post-discount, pre-tax if shown that way). If the receipt only shows a line total, divide by quantity.
- "fees" captures non-item charges that affect the bill total: service fee, admin fee, gratuity/auto-gratuity, delivery fee, surcharge, health/wellness fee, corkage, bag fee, etc. Each has a short label and a positive dollar amount.
- Skip subtotal/tax/tip/total lines from items AND fees (tax goes in the tax field; tip the user enters themselves).
- Prices must be numbers (no currency symbols).
- If a value is unknown, use null (or [] for fees).`,
                },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
      });
    } catch (e) {
      clearTimeout(timeout);
      const msg = (e as Error).name === "AbortError"
        ? "Receipt parsing timed out. Try again."
        : "Couldn't reach the receipt service.";
      return json({ error: msg }, 504);
    }
    clearTimeout(timeout);

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      console.error("AI gateway error:", resp.status, txt);
      if (resp.status === 429) return json({ error: "Too many receipts right now — try again in a moment." }, 429);
      if (resp.status === 402) return json({ error: "Receipt parsing credits exhausted." }, 402);
      return json({ error: "Receipt service rejected this image." }, 502);
    }

    const data = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Bad JSON from model:", content);
      return json({ error: "Couldn't read this receipt." }, 422);
    }

    const items = Array.isArray(parsed.items)
      ? parsed.items.flatMap((i: any) => {
          const name = String(i?.name ?? "").trim() || "Item";
          const rawQty = Number(i?.quantity);
          const qty = Number.isFinite(rawQty) && rawQty >= 1 ? Math.floor(rawQty) : 1;
          let unit = typeof i?.unit_price === "number" ? i.unit_price : Number(i?.unit_price);
          if (!Number.isFinite(unit) || unit <= 0) {
            // Fallback: legacy "price" field treated as line total
            const legacy = typeof i?.price === "number" ? i.price : Number(i?.price);
            if (Number.isFinite(legacy) && legacy > 0) unit = legacy / qty;
          }
          if (!Number.isFinite(unit) || unit <= 0) return [];
          return Array.from({ length: qty }, () => ({ name, price: Number(unit.toFixed(2)) }));
        })
      : [];

    const num = (v: any) => (typeof v === "number" ? v : v == null ? null : Number(v) || null);

    const fees = Array.isArray(parsed.fees)
      ? parsed.fees
          .map((f: any) => ({
            name: String(f?.name ?? "").trim() || "Fee",
            amount: typeof f?.amount === "number" ? f.amount : Number(f?.amount),
          }))
          .filter((f: any) => Number.isFinite(f.amount) && f.amount > 0)
          .map((f: any) => ({ name: f.name, amount: Number(f.amount.toFixed(2)) }))
      : [];

    return json(
      {
        items,
        fees,
        tax: num(parsed.tax),
        total: num(parsed.total),
        restaurant: parsed.restaurant ? String(parsed.restaurant) : null,
      },
      200,
    );
  } catch (e) {
    console.error("parse-receipt error:", e);
    return json({ error: "Something went wrong reading the receipt." }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
