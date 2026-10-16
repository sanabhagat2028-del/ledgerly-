import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { parseTelegramLink, sendTelegram, telegramCommand, verifyTelegramSecret } from "@/lib/notify";
import { answerCommand } from "@/lib/digest";
import { todayIST } from "@/lib/dates";
import { loadUser } from "@/lib/userdata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Update = {
  update_id?: number;
  message?: { chat?: { id?: number; type?: string }; text?: string };
};

const NOT_LINKED =
  "To link this chat, open Ledgerly on the web, go to Messages from Ledgerly, choose Link Telegram, and tap the button it shows.";

/** Telegram posts every message sent to the bot here. The secret header proves it is Telegram. */
export async function POST(request: Request) {
  if (!verifyTelegramSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  let update: Update;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const chatId = update.message?.chat?.id;
  const text = update.message?.text;
  // Only private chats with the bot. Ignore groups, channels and non-text messages.
  if (!chatId || typeof text !== "string" || update.message?.chat?.type !== "private" || update.update_id === undefined) {
    return NextResponse.json({ ok: true });
  }

  const db = createServiceClient();

  // Telegram retries if we are slow, so handle each update once.
  const dedupeId = `tg_${update.update_id}`;
  const seen = await db.from("webhook_events").select("id").eq("id", dedupeId).maybeSingle();
  if (seen.data) return NextResponse.json({ ok: true });
  await db.from("webhook_events").insert({ id: dedupeId, type: "telegram.message" });

  try {
    // 1. Linking: "/start 123456" (from the deep link) or just the six digits.
    const code = parseTelegramLink(text);
    if (code) {
      const { data: p } = await db
        .from("profiles")
        .select("id, plan, tg_link_expires")
        .eq("tg_link_code", code)
        .maybeSingle();
      if (!p || !p.tg_link_expires || new Date(p.tg_link_expires) < new Date()) {
        await sendTelegram(chatId, "That code is not valid or has expired. Generate a new one in Ledgerly.");
      } else if (p.plan !== "premium") {
        await sendTelegram(chatId, "Telegram delivery is part of Ledgerly Premium.");
      } else {
        const { error } = await db
          .from("profiles")
          .update({ tg_chat_id: chatId, tg_verified: true, telegram_opt_in: true, tg_link_code: null, tg_link_expires: null })
          .eq("id", p.id);
        await sendTelegram(
          chatId,
          error
            ? "This chat is already linked to another Ledgerly account. Unlink it there first."
            : "Linked. Your monthly khata, weekly digest and bill reminders will arrive here. Send help to see what you can ask."
        );
      }
      return NextResponse.json({ ok: true });
    }

    // 2. Everyone else must already be a linked chat.
    const { data: prof } = await db.from("profiles").select("id, plan").eq("tg_chat_id", chatId).eq("tg_verified", true).maybeSingle();
    if (!prof) {
      await sendTelegram(chatId, NOT_LINKED);
      return NextResponse.json({ ok: true });
    }

    const cmd = telegramCommand(text);
    if (cmd.toLowerCase() === "stop") {
      await db.from("profiles").update({ telegram_opt_in: false }).eq("id", prof.id);
      await sendTelegram(chatId, "Okay, no more Telegram messages. You can turn them back on in Ledgerly.");
      return NextResponse.json({ ok: true });
    }

    const data = await loadUser(prof.id);
    const reply = answerCommand(cmd === "start" ? "help" : cmd, data.txns, data.bills, data.goals, prof.plan === "premium", todayIST());
    await sendTelegram(chatId, reply);
  } catch (e) {
    console.error("telegram handler failed", e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ ok: true });
}
