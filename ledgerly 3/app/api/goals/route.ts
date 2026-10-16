import { NextResponse } from "next/server";
import { admin, getAuthed } from "@/lib/auth";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
const NOT_PREMIUM = { error: "Savings goals are part of Premium." };

// Savings goals are Premium. Reads use the user's session (RLS). Writes use the service role,
// after the plan check, and every query is scoped to the signed-in user's id.
export async function POST(request: Request) {
  const me = await getAuthed();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!me.premium) return NextResponse.json(NOT_PREMIUM, { status: 402 });

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const target = num(body?.target_amount);
  if (!name || name.length > 80 || !(target > 0) || target > 1e9) {
    return NextResponse.json({ error: "Give the goal a name and a target amount." }, { status: 400 });
  }
  const { count } = await admin().from("goals").select("id", { count: "exact", head: true }).eq("user_id", me.userId);
  if ((count ?? 0) >= 20) return NextResponse.json({ error: "You can keep up to 20 goals." }, { status: 400 });

  const { error } = await admin().from("goals").insert({ user_id: me.userId, name, target_amount: target });
  if (error) return NextResponse.json({ error: "Could not save the goal." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const me = await getAuthed();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!me.premium) return NextResponse.json(NOT_PREMIUM, { status: 402 });

  const body = await request.json().catch(() => null);
  const id = body?.id;
  const add = num(body?.add);
  if (typeof id !== "string" || !(add > 0) || add > 1e9) {
    return NextResponse.json({ error: "Enter an amount to add." }, { status: 400 });
  }
  const db = admin();
  const { data: goal } = await db.from("goals").select("saved_amount").eq("id", id).eq("user_id", me.userId).maybeSingle();
  if (!goal) return NextResponse.json({ error: "Goal not found." }, { status: 404 });
  const { error } = await db
    .from("goals")
    .update({ saved_amount: Number(goal.saved_amount) + add })
    .eq("id", id)
    .eq("user_id", me.userId);
  if (error) return NextResponse.json({ error: "Could not update the goal." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const me = await getAuthed();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  const { error } = await admin().from("goals").delete().eq("id", id).eq("user_id", me.userId);
  if (error) return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
