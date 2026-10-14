import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const BASE: Record<string, string> = {
  test_mode: "https://test.dodopayments.com",
  live_mode: "https://live.dodopayments.com",
};

/** Creates a Dodo checkout session for the Premium subscription and returns its URL. */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const apiKey = process.env.DODO_PAYMENTS_API_KEY;
  const productId = process.env.DODO_PREMIUM_PRODUCT_ID;
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  if (!apiKey || !productId || !site) {
    console.error("Dodo checkout is not configured: set DODO_PAYMENTS_API_KEY, DODO_PREMIUM_PRODUCT_ID, NEXT_PUBLIC_SITE_URL");
    return NextResponse.json({ error: "Payments are not set up yet." }, { status: 503 });
  }

  const { data: profile } = await supabase.from("profiles").select("plan").eq("id", user.id).maybeSingle();
  if (profile?.plan === "premium") {
    return NextResponse.json({ error: "You are already on Premium." }, { status: 409 });
  }

  const base = BASE[process.env.DODO_PAYMENTS_ENVIRONMENT ?? "test_mode"] ?? BASE.test_mode;
  const res = await fetch(`${base}/checkouts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: { email: user.email },
      return_url: `${site}/khata?upgraded=1`,
      metadata: { supabase_user_id: user.id },
    }),
  });

  if (!res.ok) {
    console.error("Dodo checkout failed", res.status, await res.text().catch(() => ""));
    return NextResponse.json({ error: "Could not open checkout. Try again." }, { status: 502 });
  }
  const json = (await res.json()) as { checkout_url?: string | null };
  if (!json.checkout_url) {
    return NextResponse.json({ error: "Could not open checkout. Try again." }, { status: 502 });
  }
  return NextResponse.json({ url: json.checkout_url });
}
