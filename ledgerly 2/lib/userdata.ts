import { createServiceClient } from "@/lib/supabase/server";
import type { Txn } from "./analysis";
import type { Bill } from "./upcoming";

export type GoalRow = { id: string; name: string; target_amount: number; saved_amount: number };

/** Loads everything the digest and WhatsApp replies need for one user. Server only (service role). */
export async function loadUser(userId: string) {
  const db = createServiceClient();
  const [tx, bills, goals] = await Promise.all([
    db
      .from("transactions")
      .select("id, occurred_on, merchant, category, amount, direction")
      .eq("user_id", userId)
      .order("occurred_on", { ascending: false })
      .limit(5000),
    db.from("bills").select("id, name, amount, due_day, kind, remind_days_before").eq("user_id", userId),
    db.from("goals").select("id, name, target_amount, saved_amount").eq("user_id", userId),
  ]);
  return {
    txns: (tx.data ?? []).map((t) => ({ ...t, amount: Number(t.amount) })) as Txn[],
    bills: (bills.data ?? []).map((b) => ({ ...b, amount: Number(b.amount) })) as Bill[],
    goals: (goals.data ?? []).map((g) => ({ ...g, target_amount: Number(g.target_amount), saved_amount: Number(g.saved_amount) })) as GoalRow[],
  };
}
