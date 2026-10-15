import { NextResponse } from "next/server";
import { admin, getAuthed } from "@/lib/auth";

/**
 * "Delete my data anytime": removes every entry, goal and bill for the signed-in user,
 * and unlinks WhatsApp. The account itself and the plan are kept.
 */
export async function DELETE() {
  const me = await getAuthed();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const db = admin();
  const results = await Promise.all([
    db.from("transactions").delete().eq("user_id", me.userId),
    db.from("goals").delete().eq("user_id", me.userId),
    db.from("bills").delete().eq("user_id", me.userId),
    db.from("notification_log").delete().eq("user_id", me.userId),
    db
      .from("profiles")
      .update({ wa_phone: null, wa_verified: false, wa_link_code: null, wa_link_expires: null, whatsapp_opt_in: false })
      .eq("id", me.userId),
  ]);
  if (results.some((r) => r.error)) {
    return NextResponse.json({ error: "Could not delete everything. Try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
