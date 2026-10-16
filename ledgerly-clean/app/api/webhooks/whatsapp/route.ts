import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendWhatsAppText, verifyMetaSignature } from "@/lib/notify";
import { answerCommand } from "@/lib/digest";
import { todayIST } from "@/lib/dates";
import { loadUser } from "@/lib/userdata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LINK_RE = /^\s*ledgerly\s+(\d{6})\s*$/i;

/** Meta calls this once when you add the webhook, to check you own it. */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  if (sp.get("hub.mode") === "subscribe" && sp.get("hub.verify_token") && sp.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(sp.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

type Incoming = { from?: string; id?: string; type?: string; text?: { body?: string } };

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: { entry?: { changes?: { value?: { messages?: Incoming[] } }[] }[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ received: true });
  }

  const messages: Incoming[] = [];
  for (const e of payload.entry ?? []) for (const c of e.changes ?? []) messages.push(...(c.value?.messages ?? []));

  const db = createServiceClient();
  for (const m of messages) {
    if (m.type !== "text" || !m.from || !m.id) continue;

    // Meta retries deliveries, so handle each message id once.
    const dedupeId = `wa_${m.id}`;
    const seen = await db.from("webhook_events").select("id").eq("id", dedupeId).maybeSingle();
    if (seen.data) continue;
    await db.from("webhook_events").insert({ id: dedupeId, type: "whatsapp.message" });

    const from = m.from; // digits with country code, no plus
    const text = m.text?.body ?? "";

    try {
      // 1. Linking: the user sends "LEDGERLY 123456" from the number they want to link.
      const link = text.match(LINK_RE);
      if (link) {
        const { data: p } = await db
          .from("profiles")
          .select("id, plan, wa_link_expires")
          .eq("wa_link_code", link[1])
          .maybeSingle();
        if (!p || !p.wa_link_expires || new Date(p.wa_link_expires) < new Date()) {
          await sendWhatsAppText(from, "That code is not valid or has expired. Generate a new one in Ledgerly settings.");
        } else if (p.plan !== "premium") {
          await sendWhatsAppText(from, "WhatsApp delivery is part of Ledgerly Premium.");
        } else {
          const { error } = await db
            .from("profiles")
            .update({ wa_phone: from, wa_verified: true, whatsapp_opt_in: true, wa_link_code: null, wa_link_expires: null })
            .eq("id", p.id);
          await sendWhatsAppText(
            from,
            error
              ? "This number is already linked to another Ledgerly account. Unlink it there first."
              : "Linked. Your monthly khata, weekly digest and bill reminders will arrive here. Send help to see what you can ask."
          );
        }
        continue;
      }

      // 2. Everyone else must already be a linked number.
      const { data: prof } = await db
        .from("profiles")
        .select("id, plan")
        .eq("wa_phone", from)
        .eq("wa_verified", true)
        .maybeSingle();
      if (!prof) {
        await sendWhatsAppText(from, "To link this number, open Ledgerly settings, choose Link WhatsApp, and send the code shown there.");
        continue;
      }

      if (text.trim().toLowerCase() === "stop") {
        await db.from("profiles").update({ whatsapp_opt_in: false }).eq("id", prof.id);
        await sendWhatsAppText(from, "Okay, no more WhatsApp messages. You can turn them back on in Ledgerly settings.");
        continue;
      }

      const data = await loadUser(prof.id);
      await sendWhatsAppText(from, answerCommand(text, data.txns, data.bills, data.goals, prof.plan === "premium", todayIST()));
    } catch (e) {
      console.error("whatsapp handler failed", e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ received: true });
}
