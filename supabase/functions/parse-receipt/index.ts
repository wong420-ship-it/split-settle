// Mindee receipt OCR edge function
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("MINDEE_API_KEY");
    if (!apiKey) {
      return json({ error: "Receipt parsing is not configured." }, 500);
    }

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return json({ error: "Please upload an image file." }, 400);
    }

    const form = await req.formData();
    const file = form.get("document");
    if (!(file instanceof File)) {
      return json({ error: "No image file was provided." }, 400);
    }

    const upstream = new FormData();
    upstream.append("document", file, file.name || "receipt.jpg");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    let resp: Response;
    try {
      resp = await fetch(
        "https://api.mindee.net/v1/products/mindee/expense_receipts/v5/predict",
        {
          method: "POST",
          headers: { Authorization: `Token ${apiKey}` },
          body: upstream,
          signal: controller.signal,
        },
      );
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
      console.error("Mindee error:", resp.status, txt);
      return json({ error: "Receipt service rejected this image." }, 502);
    }

    const data = await resp.json();
    const pred = data?.document?.inference?.prediction;
    if (!pred) return json({ error: "Couldn't read this receipt." }, 422);

    const items = (pred.line_items ?? [])
      .map((li: any) => ({
        name: (li?.description ?? "").toString().trim() || "Item",
        price: typeof li?.total_amount === "number" ? li.total_amount : Number(li?.total_amount) || 0,
      }))
      .filter((i: any) => i.price > 0);

    const tax = pred.taxes?.[0]?.value ?? null;
    const total = pred.total_amount?.value ?? null;
    const restaurant = pred.supplier_name?.value ?? null;

    return json({ items, tax, total, restaurant }, 200);
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
