import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { admin, getAuthed } from "@/lib/auth";

/**
 * Notification settings. The browser cannot write these columns directly (no RLS update policy),
 * so each change goes through here, after the session and plan are checked.
 */
export async function POST(request: Request) {
  const me = await getAuthed();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const action = body?.action;
  const db = admin();

  if (action === "email") {
    if (typeof body.value !== "boolean") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const { error } = await db.from("profiles").update({ email_digest: body.value }).eq("id", me.userId);
    if (error) return NextResponse.json({ error: "Could not save." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Everything below is WhatsApp, which is Premium.
  if (!me.premium) return NextResponse.json({ error: "WhatsApp delivery is part of Premium." }, { status: 402 });

  if (action === "whatsapp_link") {
    const business = (process.env.WHATSAPP_BUSINESS_NUMBER ?? "").replace(/\D/g, "");
    if (!business) return NextResponse.json({ error: "WhatsApp is not set up yet." }, { status: 503 });
    const code = String(randomInt(100000, 1000000));
    const { error } = await db
      .from("profiles")
      .update({ wa_link_code: code, wa_link_expires: new Date(Date.now() + 30 * 60 * 1000).toISOString() })
      .eq("id", me.userId);
    if (error) return NextResponse.json({ error: "Could not start linking." }, { status: 500 });
    const link = `https://wa.me/${business}?text=${encodeURIComponent(`LEDGERLY ${code}`)}`;
    return NextResponse.json({ code, link, expiresInMinutes: 30 });
  }

  if (action === "whatsapp_opt") {
    if (typeof body.value !== "boolean") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const { data: p } = await db.from("profiles").select("wa_verified").eq("id", me.userId).maybeSingle();
    if (!p?.wa_verified) return NextResponse.json({ error: "Link your WhatsApp number first." }, { status: 400 });
    const { error } = await db.from("profiles").update({ whatsapp_opt_in: body.value }).eq("id", me.userId);
    if (error) return NextResponse.json({ error: "Could not save." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "whatsapp_unlink") {
    const { error } = await db
      .from("profiles")
      .update({ wa_phone: null, wa_verified: false, whatsapp_opt_in: false, wa_link_code: null, wa_link_expires: null })
      .eq("id", me.userId);
    if (error) return NextResponse.json({ error: "Could not unlink." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid request." }, { status: 400 });
}
