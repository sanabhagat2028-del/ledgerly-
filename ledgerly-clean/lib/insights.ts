import { daysInMonth, type IST } from "./dates";
import { categoryTotals, inr, previousMonth, shortDate, type Recurring, type Txn } from "./analysis";
import { upcoming, type Bill } from "./upcoming";

/**
 * Three small, rule-based features that read only the user's own entries:
 * Khata Wrapped (a monthly story card), Money Runway (safe to spend today) and
 * the Cancel what-if (what a cancelled subscription is worth over the years).
 * No model is involved, so the same entries always give the same answer.
 */

const NOT_SPEND = new Set(["Card bill", "Investments"]);
const FIXED = new Set(["Rent", "EMIs", "Bills"]);

const isSpend = (t: Txn) => t.direction === "debit" && !NOT_SPEND.has(t.category);

/* ---------- Khata Wrapped ---------- */

export type Wrapped = {
  month: string;
  spend: number;
  entries: number;
  persona: { title: string; line: string };
  topCategory: { name: string; total: number; share: number } | null;
  topMerchant: { name: string; total: number; count: number } | null;
  bigDay: { iso: string; label: string; total: number } | null;
  change: { pct: number; prev: number } | null; // spend vs the previous month
  invested: number;
};

function persona(
  txns: Txn[],
  ym: string,
  spend: number,
  invested: number,
  income: number,
  share: (cat: string) => number
): { title: string; line: string } {
  const fixed = (share("Rent") + share("EMIs") + share("Bills"));
  const weekend =
    spend > 0
      ? txns
          .filter((t) => isSpend(t) && t.occurred_on.startsWith(ym) && !FIXED.has(t.category))
          .reduce((s, t) => {
            const d = new Date(`${t.occurred_on}T00:00:00Z`).getUTCDay();
            return s + (d === 0 || d === 6 ? t.amount : 0);
          }, 0)
      : 0;
  const flexible = spend * (1 - fixed);
  const weekendShare = flexible > 0 ? weekend / flexible : 0;

  if (income > 0 && invested / income >= 0.1)
    return { title: "The Quiet Compounder", line: "You paid yourself first. Your future self noticed." };
  if (share("Food delivery") >= 0.2)
    return { title: "The Delivery Loyalist", line: "Your kitchen is mostly a decoration, and the riders know your gate." };
  if (share("Shopping") >= 0.25)
    return { title: "The Cart Collector", line: "Add to cart is a lifestyle, and it shows in the numbers." };
  if (share("Subscriptions") >= 0.1)
    return { title: "The Subscription Collector", line: "A lot of small monthly charges. Worth a second look." };
  if (share("Travel") >= 0.15)
    return { title: "The Commuter", line: "Rides and fares shaped your month." };
  if (fixed >= 0.6)
    return { title: "The Responsible One", line: "Rent, EMIs and bills came first. Not much left to be wild with." };
  if (weekendShare >= 0.45 && flexible > 0)
    return { title: "The Weekend Splurger", line: "Monday to Friday you behave. Saturday and Sunday you spend." };
  return { title: "The Steady Spender", line: "No big swings. A calm, predictable month." };
}

export function buildWrapped(txns: Txn[], ym: string): Wrapped | null {
  const month = txns.filter((t) => t.occurred_on.startsWith(ym));
  const debits = month.filter(isSpend);
  if (debits.length === 0) return null;

  const spend = debits.reduce((s, t) => s + t.amount, 0);
  const cats = categoryTotals(txns, ym).filter((c) => !NOT_SPEND.has(c.category));
  const catMap = new Map(cats.map((c) => [c.category, c.total]));
  const share = (cat: string) => (spend > 0 ? (catMap.get(cat) ?? 0) / spend : 0);
  const invested = month.filter((t) => t.direction === "debit" && t.category === "Investments").reduce((s, t) => s + t.amount, 0);
  const income = month.filter((t) => t.direction === "credit").reduce((s, t) => s + t.amount, 0);

  const merchants = new Map<string, { total: number; count: number }>();
  const days = new Map<string, number>();
  for (const t of debits) {
    if (!FIXED.has(t.category)) {
      const m = merchants.get(t.merchant) ?? { total: 0, count: 0 };
      merchants.set(t.merchant, { total: m.total + t.amount, count: m.count + 1 });
    }
    if (!FIXED.has(t.category)) days.set(t.occurred_on, (days.get(t.occurred_on) ?? 0) + t.amount);
  }
  const topM = Array.from(merchants, ([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total)[0];
  const topD = Array.from(days, ([iso, total]) => ({ iso, label: shortDate(iso), total })).sort((a, b) => b.total - a.total || b.iso.localeCompare(a.iso))[0];

  const prevSpend = txns
    .filter((t) => isSpend(t) && t.occurred_on.startsWith(previousMonth(ym)))
    .reduce((s, t) => s + t.amount, 0);

  return {
    month: ym,
    spend,
    entries: month.length,
    persona: persona(txns, ym, spend, invested, income, share),
    topCategory: cats[0] ? { name: cats[0].category, total: cats[0].total, share: cats[0].total / spend } : null,
    topMerchant: topM ?? null,
    bigDay: topD ?? null,
    change: prevSpend > 0 ? { pct: ((spend - prevSpend) / prevSpend) * 100, prev: prevSpend } : null,
    invested,
  };
}

/* ---------- Money Runway ---------- */

export type Runway = {
  income: number;
  spent: number; // this month so far, including investments
  committed: number; // bills and EMIs still due before month end
  left: number; // money left after both
  daysLeft: number; // including today
  safeToday: number; // left spread over the days that remain
  pace: number; // flexible spend per day so far
  lastsDays: number | null; // days the money lasts at that pace, null when there is no pace
  lastsMonth: boolean;
  lastsUntil: string | null; // iso date the money runs out, when it will not last
  dueAhead: { name: string; amount: number; inDays: number }[];
  incomeIsEstimate: boolean;
};

/**
 * "Safe to spend today". Needs entries from the current month. Income is this month's credits, or the
 * average of the earlier months when salary has not landed yet.
 */
export function buildRunway(txns: Txn[], bills: Bill[], recurring: Recurring[], today: IST): Runway | null {
  const ym = today.iso.slice(0, 7);
  const month = txns.filter((t) => t.occurred_on.startsWith(ym) && t.occurred_on <= today.iso);
  if (month.length === 0) return null;

  let income = month.filter((t) => t.direction === "credit").reduce((s, t) => s + t.amount, 0);
  let incomeIsEstimate = false;
  if (income <= 0) {
    const earlier = new Map<string, number>();
    for (const t of txns) {
      if (t.direction !== "credit" || t.occurred_on.startsWith(ym)) continue;
      const k = t.occurred_on.slice(0, 7);
      earlier.set(k, (earlier.get(k) ?? 0) + t.amount);
    }
    const vals = Array.from(earlier.values());
    if (vals.length === 0) return null;
    income = vals.reduce((a, b) => a + b, 0) / vals.length;
    incomeIsEstimate = true;
  }

  const debits = month.filter((t) => t.direction === "debit" && t.category !== "Card bill");
  const spent = debits.reduce((s, t) => s + t.amount, 0);
  const flexible = debits.filter((t) => !FIXED.has(t.category) && t.category !== "Investments").reduce((s, t) => s + t.amount, 0);

  const total = daysInMonth(today.year, today.month);
  const daysLeft = total - today.day + 1;
  const dueAhead = upcoming(bills, recurring, today, daysLeft - 1)
    .filter((u) => u.due.startsWith(ym) && u.due >= today.iso)
    .map((u) => ({ name: u.name, amount: u.amount, inDays: u.inDays }));
  const committed = dueAhead.reduce((s, u) => s + u.amount, 0);

  const left = income - spent - committed;
  const safeToday = Math.max(left, 0) / daysLeft;
  const pace = flexible / today.day;
  const lastsDays = pace > 0 ? Math.max(left, 0) / pace : null;
  const lastsMonth = lastsDays === null || lastsDays >= daysLeft;

  let lastsUntil: string | null = null;
  if (!lastsMonth && lastsDays !== null) {
    const d = new Date(`${today.iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + Math.floor(lastsDays));
    lastsUntil = d.toISOString().slice(0, 10);
  }

  return { income, spent, committed, left, daysLeft, safeToday, pace, lastsDays, lastsMonth, lastsUntil, dueAhead, incomeIsEstimate };
}

export function runwayLine(r: Runway): string {
  if (r.left <= 0) return `You have used up this month's money. ${inr(r.committed)} of bills are still due.`;
  if (r.lastsMonth) return `At your current pace the money lasts the whole month.`;
  return `At your current pace the money runs out around ${shortDate(r.lastsUntil!)}.`;
}

/* ---------- Cancel what-if ---------- */

const SIP_RATE = 0.12; // yearly, illustrative

export type WhatIf = { monthly: number; yearly: number; years: { years: number; saved: number; sip: number }[] };

/** Cancelled amount kept as cash, and the same amount invested every month at an assumed 12% a year. */
export function whatIf(monthly: number): WhatIf {
  const r = SIP_RATE / 12;
  const years = [1, 3, 5].map((y) => {
    const n = y * 12;
    return { years: y, saved: monthly * n, sip: monthly * ((Math.pow(1 + r, n) - 1) / r) };
  });
  return { monthly, yearly: monthly * 12, years };
}
