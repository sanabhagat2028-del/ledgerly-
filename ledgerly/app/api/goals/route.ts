import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function context() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, premium: false };
  const { data: profile } = await supabase.from("profiles").select("plan").eq("id", user.id).maybeSingle();
  return { supabase, user, premium: profile?.plan === "premium" };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

// Savings goals are a Premium feature. The check lives here, not in the UI.
export async function POST(request: Request) {
  const { supabase, user, premium } = await context();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!premium) return NextResponse.json({ error: "Savings goals are part of Premium." }, { status: 402 });

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const target = num(body?.target_amount);
  if (!name || name.length > 80 || !(target > 0) || target > 1e9) {
    return NextResponse.json({ error: "Give the goal a name and a target amount." }, { status: 400 });
  }
  const { error } = await supabase.from("goals").insert({ name, target_amount: target });
  if (error) return NextResponse.json({ error: "Could not save the goal." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const { supabase, user, premium } = await context();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!premium) return NextResponse.json({ error: "Savings goals are part of Premium." }, { status: 402 });

  const body = await request.json().catch(() => null);
  const id = body?.id;
  const add = num(body?.add);
  if (typeof id !== "string" || !(add > 0) || add > 1e9) {
    return NextResponse.json({ error: "Enter an amount to add." }, { status: 400 });
  }
  const { data: goal } = await supabase.from("goals").select("saved_amount").eq("id", id).maybeSingle();
  if (!goal) return NextResponse.json({ error: "Goal not found." }, { status: 404 });
  const { error } = await supabase
    .from("goals")
    .update({ saved_amount: Number(goal.saved_amount) + add })
    .eq("id", id);
  if (error) return NextResponse.json({ error: "Could not update the goal." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { supabase, user } = await context();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  const { error } = await supabase.from("goals").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
