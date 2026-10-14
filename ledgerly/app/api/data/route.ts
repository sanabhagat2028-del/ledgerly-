import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** "Delete my data anytime": removes every transaction and goal for the signed-in user. */
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const a = await supabase.from("transactions").delete().eq("user_id", user.id);
  const b = await supabase.from("goals").delete().eq("user_id", user.id);
  if (a.error || b.error) {
    return NextResponse.json({ error: "Could not delete everything. Try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
