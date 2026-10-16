import { merchantKey } from "./parser";

export type Txn = {
  id: string;
  occurred_on: string;
  merchant: string;
  category: string;
  amount: number;
  direction: "debit" | "credit";
};

export type Recurring = {
  key: string;
  merchant: string;
  category: string;
  monthly: number; // latest amount
  count: number;
  lastSeen: string;
  priceUp: number | null; // rupees the charge rose by, if it did
  cancellable: boolean;
  why: string;
};

export const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

const dayNum = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (ym: string) => `${MONTH_NAMES[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
export const shortDate = (iso: string) => `${iso.slice(8, 10)} ${MONTH_NAMES[+iso.slice(5, 7) - 1].slice(0, 3)}`;

export function months(txns: Txn[]): string[] {
  return Array.from(new Set(txns.map((t) => t.occurred_on.slice(0, 7)))).sort().reverse();
}

export function categoryTotals(txns: Txn[], ym: string) {
  const map = new Map<string, number>();
  for (const t of txns) {
    if (t.direction !== "debit" || !t.occurred_on.startsWith(ym)) continue;
    map.set(t.category, (map.get(t.category) ?? 0) + t.amount);
  }
  return Array.from(map, ([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
}

export function spentIn(txns: Txn[], ym: string) {
  return txns.filter((t) => t.direction === "debit" && t.occurred_on.startsWith(ym)).reduce((s, t) => s + t.amount, 0);
}

export function previousMonth(ym: string) {
  const y = +ym.slice(0, 4);
  const m = +ym.slice(5, 7);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** One plain sentence about the biggest category change versus the previous month. */
export function headline(txns: Txn[], ym: string): string | null {
  const now = categoryTotals(txns, ym);
  const prev = new Map(categoryTotals(txns, previousMonth(ym)).map((c) => [c.category, c.total]));
  if (prev.size === 0) {
    const top = now[0];
    return top ? `${top.category} was your biggest spend at ${inr(top.total)}.` : null;
  }
  let best: { category: string; diff: number } | null = null;
  for (const c of now) {
    const diff = c.total - (prev.get(c.category) ?? 0);
    if (!best || Math.abs(diff) > Math.abs(best.diff)) best = { category: c.category, diff };
  }
  if (!best || Math.round(best.diff) === 0) return null;
  return `${best.category} was ${inr(Math.abs(best.diff))} ${best.diff > 0 ? "more" : "less"} than last month.`;
}

/**
 * Recurring charges: the same merchant, billed about monthly, or any Subscriptions-category
 * merchant seen in two or more different months.
 */
export function findRecurring(txns: Txn[]): Recurring[] {
  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    if (t.direction !== "debit" || t.merchant === "Unknown") continue;
    const k = merchantKey(t.merchant);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }

  const out: Recurring[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));
    const distinctMonths = new Set(sorted.map((t) => t.occurred_on.slice(0, 7))).size;
    if (distinctMonths < 2) continue;

    const gaps = sorted.slice(1).map((t, i) => dayNum(t.occurred_on) - dayNum(sorted[i].occurred_on));
    const monthly = gaps.length > 0 && gaps.every((g) => g >= 24 && g <= 40);
    const category = sorted[sorted.length - 1].category;
    const isSub = category === "Subscriptions";
    if (!monthly && !isSub) continue;

    const first = sorted[0].amount;
    const last = sorted[sorted.length - 1].amount;
    const priceUp = last > first * 1.02 ? Math.round(last - first) : null;
    const cancellable = isSub;
    const why = priceUp
      ? `Went up ${inr(priceUp)} since ${monthLabel(sorted[0].occurred_on.slice(0, 7)).split(" ")[0]}`
      : `Charged in ${distinctMonths} different months`;
    out.push({
      key,
      merchant: sorted[sorted.length - 1].merchant,
      category,
      monthly: last,
      count: sorted.length,
      lastSeen: sorted[sorted.length - 1].occurred_on,
      priceUp,
      cancellable,
      why,
    });
  }
  return out.sort((a, b) => Number(b.cancellable) - Number(a.cancellable) || b.monthly - a.monthly);
}
