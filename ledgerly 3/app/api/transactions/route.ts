import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CATEGORIES } from "@/lib/parser";

const MAX_BATCH = 500;
const CATS = new Set<string>(CATEGORIES);

type Incoming = {
  occurred_on: string;
  merchant: string;
  category: string;
  amount: number;
  direction: "debit" | "credit";
  fingerprint: string;
};

function valid(t: unknown): t is Incoming {
  if (!t || typeof t !== "object") return false;
  const x = t as Record<string, unknown>;
  return (
    typeof x.occurred_on === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(x.occurred_on) &&
    typeof x.merchant === "string" &&
    x.merchant.length > 0 &&
    x.merchant.length <= 60 &&
    typeof x.category === "string" &&
    CATS.has(x.category) &&
    typeof x.amount === "number" &&
    Number.isFinite(x.amount) &&
    x.amount > 0 &&
    x.amount < 1e9 &&
    (x.direction === "debit" || x.direction === "credit") &&
    typeof x.fingerprint === "string" &&
    x.fingerprint.length > 0 &&
    x.fingerprint.length <= 200
  );
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to add messages." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const list: unknown = body?.transactions;
  if (!Array.isArray(list) || list.length === 0) {
    return NextResponse.json({ error: "No transactions to add." }, { status: 400 });
  }
  if (list.length > MAX_BATCH) {
    return NextResponse.json({ error: `Add at most ${MAX_BATCH} messages at a time.` }, { status: 400 });
  }
  const rows = list.filter(valid).map((t) => ({ ...t, user_id: user.id }));
  if (rows.length === 0) {
    return NextResponse.json({ error: "None of those messages could be read." }, { status: 400 });
  }

  // ignoreDuplicates: re-pasting the same messages adds nothing.
  const { data, error } = await supabase
    .from("transactions")
    .upsert(rows, { onConflict: "user_id,fingerprint", ignoreDuplicates: true })
    .select("id");
  if (error) {
    console.error("transactions insert failed", error.message);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
  const added = data?.length ?? 0;
  return NextResponse.json({ added, duplicates: rows.length - added });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const id = body?.id;
  const category = body?.category;
  if (typeof id !== "string" || typeof category !== "string" || !CATS.has(category)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { error } = await supabase.from("transactions").update({ category }).eq("id", id);
  if (error) return NextResponse.json({ error: "Could not update." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
