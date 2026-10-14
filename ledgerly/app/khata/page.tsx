import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Dashboard, { type Goal } from "@/components/Dashboard";
import type { Txn } from "@/lib/analysis";

export const metadata = { title: "Your khata | Ledgerly" };
export const dynamic = "force-dynamic";

export default async function Khata({
  searchParams,
}: {
  searchParams: Promise<{ upgraded?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profile, tx, goals] = await Promise.all([
    supabase.from("profiles").select("plan").eq("id", user.id).maybeSingle(),
    supabase
      .from("transactions")
      .select("id, occurred_on, merchant, category, amount, direction")
      .order("occurred_on", { ascending: false })
      .limit(5000),
    supabase.from("goals").select("id, name, target_amount, saved_amount").order("created_at", { ascending: true }),
  ]);

  const txns: Txn[] = (tx.data ?? []).map((t) => ({ ...t, amount: Number(t.amount) })) as Txn[];

  return (
    <Dashboard
      email={user.email ?? ""}
      plan={profile.data?.plan === "premium" ? "premium" : "free"}
      txns={txns}
      goals={(goals.data ?? []) as Goal[]}
      justUpgraded={sp.upgraded === "1"}
    />
  );
}
