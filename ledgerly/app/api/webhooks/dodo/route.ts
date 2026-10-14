import { NextResponse } from "next/server";
import { Webhook } from "standardwebhooks";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const GRANT = new Set(["active", "renewed"]);
const REVOKE = new Set(["cancelled", "expired", "failed", "on_hold"]);

type SubscriptionData = {
  subscription_id?: string;
  status?: string;
  product_id?: string;
  customer?: { customer_id?: string; email?: string };
  metadata?: Record<string, unknown>;
};

/**
 * Dodo Payments webhook. Verifies the Standard Webhooks signature against the raw body,
 * then switches the user's plan in Supabase. Uses the service role because users cannot write `plan`.
 */
export async function POST(request: Request) {
  const secret = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
  if (!secret) {
    console.error("DODO_PAYMENTS_WEBHOOK_KEY is not set");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const raw = await request.text(); // raw, unparsed: the signature covers these exact bytes
  const headers = {
    "webhook-id": request.headers.get("webhook-id") ?? "",
    "webhook-signature": request.headers.get("webhook-signature") ?? "",
    "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
  };

  try {
    new Webhook(secret).verify(raw, headers);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(raw) as { type?: string; data?: SubscriptionData };
  const type = event.type ?? "";
  if (!type.startsWith("subscription.")) {
    return NextResponse.json({ received: true });
  }

  const admin = createServiceClient();
  const webhookId = headers["webhook-id"];

  // Idempotency: Dodo retries, so skip anything already handled.
  const seen = await admin.from("webhook_events").select("id").eq("id", webhookId).maybeSingle();
  if (seen.data) return NextResponse.json({ received: true, duplicate: true });

  const data = event.data ?? {};
  const wantedProduct = process.env.DODO_PREMIUM_PRODUCT_ID;
  if (wantedProduct && data.product_id && data.product_id !== wantedProduct) {
    return NextResponse.json({ received: true, ignored: "other product" });
  }

  // Decide what this event means for the plan.
  const suffix = type.slice("subscription.".length);
  let plan: "premium" | "free" | null = null;
  if (suffix === "updated") {
    if (data.status && GRANT.has(data.status)) plan = "premium";
    else if (data.status && REVOKE.has(data.status)) plan = "free";
  } else if (GRANT.has(suffix)) {
    plan = "premium";
  } else if (REVOKE.has(suffix)) {
    plan = "free";
  }

  if (plan) {
    // Find the user: the id we put in checkout metadata, else the customer email.
    const metaId = typeof data.metadata?.supabase_user_id === "string" ? data.metadata.supabase_user_id : null;
    let userId = metaId;
    if (!userId && data.customer?.email) {
      const byEmail = await admin
        .from("profiles")
        .select("id")
        .ilike("email", data.customer.email)
        .maybeSingle();
      userId = byEmail.data?.id ?? null;
    }
    if (!userId) {
      // Retrying cannot fix this, so acknowledge and log it.
      console.error("Dodo webhook: no matching user", { type, subscription: data.subscription_id });
      return NextResponse.json({ received: true, ignored: "no user" });
    }

    const update: Record<string, unknown> = { plan, plan_updated_at: new Date().toISOString() };
    if (data.customer?.customer_id) update.dodo_customer_id = data.customer.customer_id;
    if (data.subscription_id) update.dodo_subscription_id = data.subscription_id;

    const { error } = await admin.from("profiles").update(update).eq("id", userId);
    if (error) {
      console.error("Dodo webhook: profile update failed", error.message);
      return NextResponse.json({ error: "Update failed" }, { status: 500 }); // Dodo will retry
    }
  }

  await admin.from("webhook_events").insert({ id: webhookId, type });
  return NextResponse.json({ received: true });
}
