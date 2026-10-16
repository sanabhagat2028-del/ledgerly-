import { NextResponse } from "next/server";
import { admin, getAuthed } from "@/lib/auth";

const KINDS = new Set(["bill", "emi", "card"]);
const NOT_PREMIUM = { error: "Bill and EMI reminders are part of Premium." };

// Reminders are Premium. Writes use the service role after the plan check; every query is scoped to the user.
export async function POST(request: Request) {
  const me = await getAuthed();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!me.premium) return NextResponse.json(NOT_PREMIUM, { status: 402 });

  const b = await request.json().catch(() => null);
  const name = typeof b?.name === "string" ? b.name.trim() : "";
  const amount = typeof b?.amount === "number" ? b.amount : NaN;
  const dueDay = typeof b?.due_day === "number" ? Math.trunc(b.due_day) : NaN;
  const kind = typeof b?.kind === "string" && KINDS.has(b.kind) ? b.kind : "bill";
  const remind = typeof b?.remind_days_before === "number" ? Math.trunc(b.remind_days_before) : 3;

  if (!name || name.length > 60) return NextResponse.json({ error: "Give the bill a name." }, { status: 400 });
  if (!(amount > 0) || amount > 1e9) return NextResponse.json({ error: "Enter the amount in rupees." }, { status: 400 });
  if (!(dueDay >= 1 && dueDay <= 31)) return NextResponse.json({ error: "Due day must be between 1 and 31." }, { status: 400 });
  if (!(remind >= 0 && remind <= 14)) return NextResponse.json({ error: "Remind between 0 and 14 days before." }, { status: 400 });

  const db = admin();
  const { count } = await db.from("bills").select("id", { count: "exact", head: true }).eq("user_id", me.userId);
  if ((count ?? 0) >= 50) return NextResponse.json({ error: "You can keep up to 50 bills." }, { status: 400 });

  const { error } = await db
    .from("bills")
    .insert({ user_id: me.userId, name, amount, due_day: dueDay, kind, remind_days_before: remind });
  if (error) return NextResponse.json({ error: "Could not save the bill." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const me = await getAuthed();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  const { error } = await admin().from("bills").delete().eq("id", id).eq("user_id", me.userId);
  if (error) return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
