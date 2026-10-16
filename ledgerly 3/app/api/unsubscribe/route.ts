import { createServiceClient } from "@/lib/supabase/server";
import { checkUnsubToken } from "@/lib/notify";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function unsubscribe(u: string | null, t: string | null) {
  if (!u || !t || !UUID.test(u) || !checkUnsubToken(u, t)) return false;
  const { error } = await createServiceClient().from("profiles").update({ email_digest: false }).eq("id", u);
  return !error;
}

const page = (msg: string, status = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ledgerly</title><body style="font:18px/1.6 Georgia,serif;max-width:32rem;margin:4rem auto;padding:0 1.2rem;color:#1a1a1a;background:#f4efe4"><p>${msg}</p>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );

// Link in the email.
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  return (await unsubscribe(sp.get("u"), sp.get("t")))
    ? page("You are unsubscribed. No more Ledgerly emails. You can turn them back on in your khata settings.")
    : page("That link is not valid. Sign in to Ledgerly and turn emails off in settings.", 400);
}

// Gmail and Apple Mail's one-click unsubscribe.
export async function POST(request: Request) {
  const sp = new URL(request.url).searchParams;
  return (await unsubscribe(sp.get("u"), sp.get("t"))) ? new Response("ok") : new Response("invalid", { status: 400 });
}
