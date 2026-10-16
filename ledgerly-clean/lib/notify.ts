import { createHmac, timingSafeEqual } from "node:crypto";

/* ------------------------------- email (Resend) ------------------------------ */

export const emailConfigured = () => !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function sendEmail(opts: { to: string; subject: string; text: string; unsubscribeUrl?: string }): Promise<boolean> {
  if (!emailConfigured()) return false;
  const footer = opts.unsubscribeUrl ? `\n\nStop these emails: ${opts.unsubscribeUrl}` : "";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [opts.to],
      subject: opts.subject,
      text: opts.text + footer,
      html: `<div style="font:16px/1.6 Georgia,serif;color:#1a1a1a;white-space:pre-wrap">${esc(opts.text)}${
        opts.unsubscribeUrl ? `<br><br><a href="${esc(opts.unsubscribeUrl)}" style="color:#777;font-size:13px">Stop these emails</a>` : ""
      }</div>`,
      headers: opts.unsubscribeUrl
        ? { "List-Unsubscribe": `<${opts.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
        : undefined,
    }),
  });
  if (!res.ok) console.error("Resend failed", res.status, await res.text().catch(() => ""));
  return res.ok;
}

/** Signed token so the unsubscribe link works without signing in. */
export function unsubToken(userId: string): string {
  const secret = process.env.CRON_SECRET ?? "";
  return createHmac("sha256", secret).update(`unsub:${userId}`).digest("hex");
}

export function checkUnsubToken(userId: string, token: string): boolean {
  if (!process.env.CRON_SECRET) return false;
  const a = Buffer.from(unsubToken(userId));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function unsubUrl(userId: string): string | undefined {
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  if (!site || !process.env.CRON_SECRET) return undefined;
  return `${site}/api/unsubscribe?u=${userId}&t=${unsubToken(userId)}`;
}

/* ------------------------------- Telegram bot ------------------------------- */

export const telegramConfigured = () => !!process.env.TELEGRAM_BOT_TOKEN;

/** Sends a plain-text message. Telegram lets a bot message anyone who has started it, with no template. */
export async function sendTelegram(chatId: number | string, text: string): Promise<boolean> {
  if (!telegramConfigured()) return false;
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3800), disable_web_page_preview: true }),
  });
  if (!res.ok) console.error("Telegram send failed", res.status, await res.text().catch(() => ""));
  return res.ok;
}

/** Telegram echoes back the secret we gave it when setting the webhook, in this header. */
export function verifyTelegramSecret(header: string | null): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** "/start 123456", "/start@MyBot 123456" or a bare "123456" all link an account. */
export function parseTelegramLink(text: string): string | null {
  const m = text.trim().match(/^\/start(?:@\w+)?\s+(\d{6})$/i) ?? text.trim().match(/^(\d{6})$/);
  return m ? m[1] : null;
}

/** Strips "/", and the "@BotName" Telegram adds in groups, so "/month@MyBot" reads as "month". */
export function telegramCommand(text: string): string {
  return text.trim().replace(/^\//, "").replace(/@\w+/, "").trim();
}

/* ---------------------------- WhatsApp (Meta Cloud API) ---------------------------- */

const GRAPH = "https://graph.facebook.com/v21.0";

export const whatsappConfigured = () => !!process.env.WHATSAPP_ACCESS_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID;

async function graph(payload: Record<string, unknown>): Promise<boolean> {
  if (!whatsappConfigured()) return false;
  const res = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  if (!res.ok) console.error("WhatsApp send failed", res.status, await res.text().catch(() => ""));
  return res.ok;
}

/** Free-form reply. WhatsApp only allows this within 24 hours of the user's last message to us. */
export function sendWhatsAppText(to: string, body: string) {
  return graph({ to, type: "text", text: { body: body.slice(0, 3800) } });
}

/**
 * Business-initiated message. WhatsApp requires an approved template for these. Ours has one body variable,
 * and WhatsApp rejects newlines inside a variable, so line breaks become " | ".
 */
export function sendWhatsAppTemplate(to: string, text: string) {
  const param = text.replace(/\s*\n+\s*/g, " | ").replace(/ {2,}/g, " ").slice(0, 900);
  return graph({
    to,
    type: "template",
    template: {
      name: process.env.WHATSAPP_TEMPLATE_NAME || "ledgerly_update",
      language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" },
      components: [{ type: "body", parameters: [{ type: "text", text: param }] }],
    },
  });
}

export function verifyMetaSignature(raw: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const given = header.slice("sha256=".length);
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
