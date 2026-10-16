import {
  categoryTotals,
  findRecurring,
  headline,
  inr,
  monthLabel,
  months as monthsOf,
  previousMonth,
  type Txn,
} from "./analysis";
import { addMonths, dayNumber, type IST } from "./dates";
import { CATEGORIES, merchantKey } from "./parser";
import { buildPlan, planSummary } from "./plan";
import { dueLabel, upcoming, type Bill } from "./upcoming";

type GoalRow = { id: string; name: string; target_amount: number; saved_amount: number };

const spendIn = (txns: Txn[], fromIso: string, toIso: string) =>
  txns
    .filter((t) => t.direction === "debit" && t.occurred_on >= fromIso && t.occurred_on <= toIso)
    .reduce((s, t) => s + t.amount, 0);

const isoMinus = (iso: string, days: number) => new Date((dayNumber(iso) - days) * 86400000).toISOString().slice(0, 10);

/** One short paragraph: last 7 days against the 7 before. */
export function weeklyDigest(txns: Txn[], today: IST): string | null {
  const to = isoMinus(today.iso, 1);
  const from = isoMinus(today.iso, 7);
  const prevTo = isoMinus(today.iso, 8);
  const prevFrom = isoMinus(today.iso, 14);
  const now = spendIn(txns, from, to);
  if (now === 0 && txns.length === 0) return null;
  const before = spendIn(txns, prevFrom, prevTo);
  const diff = now - before;
  let line = `Last 7 days you spent ${inr(now)}`;
  if (before > 0 && Math.round(diff) !== 0) line += `, ${inr(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than the week before`;
  line += ".";
  const top = new Map<string, number>();
  for (const t of txns) {
    if (t.direction === "debit" && t.occurred_on >= from && t.occurred_on <= to) top.set(t.category, (top.get(t.category) ?? 0) + t.amount);
  }
  const best = Array.from(top).sort((a, b) => b[1] - a[1])[0];
  if (best) line += ` Biggest: ${best[0]}, ${inr(best[1])}.`;
  return line;
}

/** The monthly khata message for one month, with the plan line for Premium users. */
export function monthlyKhata(txns: Txn[], ym: string, goals: GoalRow[], premium: boolean): string | null {
  const totals = categoryTotals(txns, ym);
  if (totals.length === 0) return null;
  const spent = totals.reduce((s, c) => s + c.total, 0);
  const lines = [`${monthLabel(ym)} khata: you spent ${inr(spent)} across ${totals.length} ${totals.length === 1 ? "category" : "categories"}.`];
  const said = headline(txns, ym);
  if (said) lines.push(said);
  const subs = findRecurring(txns).filter((r) => r.cancellable);
  if (subs.length) {
    const sum = subs.reduce((s, r) => s + r.monthly, 0);
    lines.push(
      `${subs.length} ${subs.length === 1 ? "subscription" : "subscriptions"} worth ${inr(sum)} a month ${subs.length === 1 ? "deserves" : "deserve"} a second look: ${subs.slice(0, 4).map((s) => s.merchant).join(", ")}.`
    );
  }
  if (premium) {
    const plan = buildPlan(txns, goals.map((g) => ({ id: g.id, name: g.name, target: Number(g.target_amount), saved: Number(g.saved_amount) })));
    if (plan && plan.trims.length) lines.push(planSummary(plan));
  }
  return lines.join("\n");
}

export function reminderLine(name: string, amount: number, inDays: number): string {
  return `Reminder: ${name}, ${inr(amount)}, is due ${dueLabel(inDays)}.`;
}

/** Reminders that should go out today: bills whose "remind me" day is today. */
export function dueReminders(bills: Bill[], txns: Txn[], today: IST) {
  return upcoming(bills, findRecurring(txns), today, 14)
    .filter((u) => u.inDays === u.remindDays)
    .map((u) => ({ key: `rem:${u.key}`, text: reminderLine(u.name, u.amount, u.inDays) }));
}

/* ------------------------- WhatsApp reply commands ------------------------- */

const HELP = [
  "Ledgerly. Send:",
  "month: this month at a glance",
  "a category, like food or travel: what is inside it",
  "bills: what is due soon",
  "stop: no more messages",
].join("\n");

export function findCategory(query: string): string | null {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return null;
  return CATEGORIES.find((c) => c.toLowerCase() === q) ?? CATEGORIES.find((c) => c.toLowerCase().startsWith(q)) ?? CATEGORIES.find((c) => c.toLowerCase().includes(q)) ?? null;
}

export function categoryBreakdown(txns: Txn[], ym: string, category: string): string {
  const rows = txns.filter((t) => t.direction === "debit" && t.category === category && t.occurred_on.startsWith(ym));
  if (rows.length === 0) return `No ${category} spending in ${monthLabel(ym)}.`;
  const total = rows.reduce((s, t) => s + t.amount, 0);
  const by = new Map<string, { name: string; n: number; sum: number }>();
  for (const t of rows) {
    const k = merchantKey(t.merchant);
    const cur = by.get(k) ?? { name: t.merchant, n: 0, sum: 0 };
    cur.n++;
    cur.sum += t.amount;
    by.set(k, cur);
  }
  const top = Array.from(by.values()).sort((a, b) => b.sum - a.sum).slice(0, 5);
  return `${category}, ${monthLabel(ym)}: ${rows.length} ${rows.length === 1 ? "entry" : "entries"}, ${inr(total)}.\n${top.map((m) => `${m.name} ${m.n}x, ${inr(m.sum)}`).join("\n")}`;
}

export function answerCommand(text: string, txns: Txn[], bills: Bill[], goals: GoalRow[], premium: boolean, today: IST): string {
  const cmd = text.trim().toLowerCase();
  const ym = monthsOf(txns)[0];
  if (!cmd || cmd === "help" || cmd === "hi" || cmd === "hello" || cmd === "menu") return HELP;
  if (!ym) return "Your khata is empty. Add some messages or a statement in Ledgerly first.";
  if (cmd === "month" || cmd === "summary" || cmd === "khata") return monthlyKhata(txns, ym, goals, premium) ?? "Nothing recorded for this month yet.";
  if (cmd === "bills" || cmd === "due") {
    const soon = upcoming(bills, findRecurring(txns), today, 14);
    return soon.length ? soon.map((u) => `${u.name}, ${inr(u.amount)}, ${dueLabel(u.inDays)}`).join("\n") : "Nothing due in the next 14 days.";
  }
  const cat = findCategory(cmd);
  if (cat) return categoryBreakdown(txns, ym, cat);
  return `I did not get that.\n${HELP}`;
}

export { previousMonth, addMonths };
