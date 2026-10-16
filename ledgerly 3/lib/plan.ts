import { categoryTotals, inr, monthLabel, months as monthsOf, type Txn } from "./analysis";

/**
 * Rule-based savings plan. No guessing from a model: it uses the user's own last few months.
 * Card bill payments are left out of spend because the card purchases behind them are already counted.
 * Investments count as saving, not spending.
 */

const FIXED = new Set(["Rent", "EMIs", "Bills", "Health", "Groceries"]);
// How much of each flexible category we suggest trimming.
const TRIM: Record<string, number> = {
  "Food delivery": 0.25,
  Shopping: 0.2,
  Travel: 0.1,
  Subscriptions: 0.3,
  Other: 0.1,
};

export type PlanGoal = { id: string; name: string; target: number; saved: number };

export type Plan = {
  basis: string; // e.g. "July to September 2026"
  months: number;
  income: number | null; // average a month, null if no income recorded
  spend: number;
  invested: number;
  saving: number | null; // income - spend (invested counts as saved), null without income
  savingRate: number | null; // 0..1
  trims: { category: string; now: number; cut: number; target: number }[];
  trimTotal: number;
  planSaving: number | null; // current saving + trims
  goals: { name: string; remaining: number; monthsToGo: number | null }[];
  note: string | null;
};

function completeMonths(txns: Txn[]): string[] {
  const all = monthsOf(txns); // newest first
  if (all.length <= 1) return all;
  // Drop the newest month when it is partial: fewer days of data than the previous month had.
  const maxDay = (ym: string) => Math.max(...txns.filter((t) => t.occurred_on.startsWith(ym)).map((t) => +t.occurred_on.slice(8, 10)));
  const newest = all[0];
  const partial = maxDay(newest) < 25 && maxDay(all[1]) >= 25;
  return (partial ? all.slice(1) : all).slice(0, 3);
}

export function buildPlan(txns: Txn[], goals: PlanGoal[]): Plan | null {
  const ms = completeMonths(txns);
  if (ms.length === 0) return null;
  const n = ms.length;

  let income = 0;
  let spend = 0;
  let invested = 0;
  const catSum = new Map<string, number>();
  for (const ym of ms) {
    for (const c of categoryTotals(txns, ym)) {
      if (c.category === "Card bill") continue;
      if (c.category === "Investments") invested += c.total;
      else {
        spend += c.total;
        catSum.set(c.category, (catSum.get(c.category) ?? 0) + c.total);
      }
    }
    income += txns
      .filter((t) => t.direction === "credit" && t.occurred_on.startsWith(ym))
      .reduce((s, t) => s + t.amount, 0);
  }
  const avgIncome = income > 0 ? income / n : null;
  const avgSpend = spend / n;
  const avgInvested = invested / n;

  const trims = Array.from(catSum, ([category, total]) => ({ category, now: total / n }))
    .filter((c) => !FIXED.has(c.category) && TRIM[c.category] !== undefined && c.now >= 500)
    .map((c) => {
      const cut = Math.round((c.now * TRIM[c.category]) / 50) * 50;
      return { category: c.category, now: c.now, cut, target: c.now - cut };
    })
    .filter((c) => c.cut >= 100)
    .sort((a, b) => b.cut - a.cut)
    .slice(0, 4);
  const trimTotal = trims.reduce((s, t) => s + t.cut, 0);

  const saving = avgIncome === null ? null : avgIncome - avgSpend;
  const planSaving = saving === null ? null : Math.max(saving, 0) + trimTotal;

  const goalLines = goals
    .map((g) => ({ name: g.name, remaining: Math.max(g.target - g.saved, 0) }))
    .filter((g) => g.remaining > 0)
    .map((g) => ({
      ...g,
      monthsToGo: planSaving && planSaving > 0 ? Math.ceil(g.remaining / planSaving) : null,
    }));

  let note: string | null = null;
  if (avgIncome === null) note = "No money coming in is recorded yet. Add a salary credit SMS or a statement to see your savings rate.";
  else if (saving !== null && saving < 0) note = "You spent more than you earned in these months, so the first step is closing that gap.";

  return {
    basis: n === 1 ? monthLabel(ms[0]) : `${monthLabel(ms[n - 1]).split(" ")[0]} to ${monthLabel(ms[0])}`,
    months: n,
    income: avgIncome,
    spend: avgSpend,
    invested: avgInvested,
    saving,
    savingRate: avgIncome && saving !== null ? saving / avgIncome : null,
    trims,
    trimTotal,
    planSaving,
    goals: goalLines,
    note,
  };
}

export function planSummary(p: Plan): string {
  const parts: string[] = [];
  if (p.income !== null && p.saving !== null) {
    parts.push(`You earn about ${inr(p.income)} a month and spend about ${inr(p.spend)}, saving ${inr(Math.max(p.saving, 0))}.`);
  } else {
    parts.push(`You spend about ${inr(p.spend)} a month.`);
  }
  if (p.trims.length) {
    parts.push(`Trim ${p.trims.map((t) => `${t.category} by ${inr(t.cut)}`).join(", ")} to save ${inr(p.trimTotal)} more.`);
  }
  return parts.join(" ");
}
