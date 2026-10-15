import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Dashboard, { type Goal } from "@/components/Dashboard";
import type { Txn } from "@/lib/analysis";
import type { Bill } from "@/lib/upcoming";

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

  // The plan is read on its own so it never depends on the newer notification columns
  // (if the 0002 migration has not been run yet, only the settings query fails).
  const [profile, prefs, tx, goals, bills] = await Promise.all([
    supabase.from("profiles").select("plan").eq("id", user.id).maybeSingle(),
    supabase
      .from("profiles")
      .select("email_digest, whatsapp_opt_in, wa_verified, wa_phone")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("transactions")
      .select("id, occurred_on, merchant, category, amount, direction")
      .order("occurred_on", { ascending: false })
      .limit(5000),
    supabase.from("goals").select("id, name, target_amount, saved_amount").order("created_at", { ascending: true }),
    supabase.from("bills").select("id, name, amount, due_day, kind, remind_days_before").order("due_day", { ascending: true }),
  ]);

  const txns: Txn[] = (tx.data ?? []).map((t) => ({ ...t, amount: Number(t.amount) })) as Txn[];

  return (
    <Dashboard
      email={user.email ?? ""}
      plan={profile.data?.plan === "premium" ? "premium" : "free"}
      txns={txns}
      goals={(goals.data ?? []) as Goal[]}
      bills={(bills.data ?? []).map((b) => ({ ...b, amount: Number(b.amount) })) as Bill[]}
      settings={{
        emailDigest: prefs.data?.email_digest ?? true,
        whatsappOptIn: prefs.data?.whatsapp_opt_in ?? false,
        waVerified: prefs.data?.wa_verified ?? false,
        waPhoneMasked: prefs.data?.wa_phone ? `+${prefs.data.wa_phone.slice(0, 2)} ••••• ${prefs.data.wa_phone.slice(-4)}` : null,
        waAvailable: !!process.env.WHATSAPP_BUSINESS_NUMBER,
      }}
      justUpgraded={sp.upgraded === "1"}
    />
  );
}
