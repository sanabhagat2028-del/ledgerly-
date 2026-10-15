import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { dueReminders, monthlyKhata, weeklyDigest } from "@/lib/digest";
import { addMonths, todayIST } from "@/lib/dates";
import { emailConfigured, sendEmail, sendWhatsAppTemplate, unsubUrl, whatsappConfigured } from "@/lib/notify";
import { loadUser } from "@/lib/userdata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE = 500;

type Item = { key: string; text: string };

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Runs once a day (see vercel.json). Vercel sends `Authorization: Bearer $CRON_SECRET`.
 * - Bill and EMI reminders on each bill's "remind me" day (Premium)
 * - Weekly digest on Sundays (email for everyone who has it on, WhatsApp for Premium)
 * - Monthly khata on the 1st, for the month that just ended
 * The notification_log table makes a re-run harmless: nothing is sent twice.
 */
export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = todayIST();
  const db = createServiceClient();
  const stats = { users: 0, emails: 0, whatsapp: 0, skipped: 0, failed: 0 };
  const canEmail = emailConfigured();
  const canWhatsApp = whatsappConfigured();
  if (!canEmail && !canWhatsApp) return NextResponse.json({ ...stats, note: "No delivery channel is configured." });

  for (let from = 0; ; from += PAGE) {
    const { data: users, error } = await db
      .from("profiles")
      .select("id, email, plan, email_digest, whatsapp_opt_in, wa_phone, wa_verified")
      .or("email_digest.eq.true,whatsapp_opt_in.eq.true")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("cron: could not list users", error.message);
      return NextResponse.json({ error: "Could not list users" }, { status: 500 });
    }
    if (!users || users.length === 0) break;

    for (const u of users) {
      stats.users++;
      try {
        const premium = u.plan === "premium";
        const data = await loadUser(u.id);
        const wantsEmail = canEmail && u.email_digest && !!u.email;
        const wantsWa = canWhatsApp && premium && u.whatsapp_opt_in && u.wa_verified && !!u.wa_phone;
        if (!wantsEmail && !wantsWa) {
          stats.skipped++;
          continue;
        }

        const items: Item[] = [];
        if (premium) items.push(...dueReminders(data.bills, data.txns, today));
        if (today.dow === 0) {
          const w = weeklyDigest(data.txns, today);
          if (w) items.push({ key: `week:${today.iso}`, text: w });
        }
        if (today.day === 1) {
          const ym = addMonths(today.iso, -1).slice(0, 7);
          const m = monthlyKhata(data.txns, ym, data.goals, premium);
          if (m) items.push({ key: `month:${ym}`, text: m });
        }
        if (items.length === 0) continue;

        const sentFor = async (channel: "email" | "whatsapp") => {
          const { data: log } = await db
            .from("notification_log")
            .select("key")
            .eq("user_id", u.id)
            .eq("channel", channel)
            .in("key", items.map((i) => i.key));
          const done = new Set((log ?? []).map((l) => l.key));
          return items.filter((i) => !done.has(i.key));
        };
        const record = (channel: "email" | "whatsapp", sent: Item[]) =>
          db.from("notification_log").upsert(sent.map((i) => ({ user_id: u.id, key: i.key, channel })), { onConflict: "user_id,key,channel", ignoreDuplicates: true });

        if (wantsEmail) {
          const todo = await sentFor("email");
          if (todo.length) {
            const subject = todo.some((i) => i.key.startsWith("rem:")) ? "A bill is due soon" : todo.some((i) => i.key.startsWith("month:")) ? "Your monthly khata" : "Your week in rupees";
            const ok = await sendEmail({ to: u.email!, subject, text: todo.map((i) => i.text).join("\n\n"), unsubscribeUrl: unsubUrl(u.id) });
            if (ok) {
              await record("email", todo);
              stats.emails++;
            } else stats.failed++;
          }
        }
        if (wantsWa) {
          const todo = await sentFor("whatsapp");
          if (todo.length) {
            const ok = await sendWhatsAppTemplate(u.wa_phone!, todo.map((i) => i.text).join("\n"));
            if (ok) {
              await record("whatsapp", todo);
              stats.whatsapp++;
            } else stats.failed++;
          }
        }
      } catch (e) {
        stats.failed++;
        console.error("cron: user failed", u.id, e instanceof Error ? e.message : e);
      }
    }
    if (users.length < PAGE) break;
  }

  return NextResponse.json({ date: today.iso, ...stats });
}
