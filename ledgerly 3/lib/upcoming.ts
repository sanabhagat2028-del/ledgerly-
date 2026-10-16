import { addMonths, daysBetween, nextDue, type IST } from "./dates";
import { merchantKey } from "./parser";
import type { Recurring } from "./analysis";

export type Bill = {
  id: string;
  name: string;
  amount: number;
  due_day: number;
  kind: "bill" | "emi" | "card";
  remind_days_before: number;
};

export type Upcoming = {
  key: string; // stable id for de-duplicating notifications
  name: string;
  amount: number;
  due: string; // YYYY-MM-DD
  inDays: number;
  source: "bill" | "detected";
  remindDays: number;
};

/**
 * Charges due soon. Bills the user added are exact. Detected recurring charges (rent, EMIs, subscriptions
 * seen in the statements) are projected one month after the last time they were seen. A bill the user
 * has added hides the detected charge with the same name.
 */
export function upcoming(bills: Bill[], recurring: Recurring[], today: IST, withinDays = 14): Upcoming[] {
  const out: Upcoming[] = [];
  const billKeys = new Set<string>();

  for (const b of bills) {
    billKeys.add(merchantKey(b.name));
    const due = nextDue(b.due_day, today);
    out.push({
      key: `bill:${b.id}:${due}`,
      name: b.name,
      amount: b.amount,
      due,
      inDays: daysBetween(today.iso, due),
      source: "bill",
      remindDays: b.remind_days_before,
    });
  }

  for (const r of recurring) {
    if (billKeys.has(merchantKey(r.merchant))) continue;
    let due = addMonths(r.lastSeen, 1);
    // If the projected date already passed (a missed month of data), roll forward to the next one.
    let guard = 0;
    while (due < today.iso && guard++ < 24) due = addMonths(due, 1);
    out.push({
      key: `rec:${r.key}:${due}`,
      name: r.merchant,
      amount: r.monthly,
      due,
      inDays: daysBetween(today.iso, due),
      source: "detected",
      remindDays: 3,
    });
  }

  return out.filter((u) => u.inDays >= 0 && u.inDays <= withinDays).sort((a, b) => a.inDays - b.inDays || b.amount - a.amount);
}

export function dueLabel(inDays: number): string {
  if (inDays === 0) return "today";
  if (inDays === 1) return "tomorrow";
  return `in ${inDays} days`;
}
