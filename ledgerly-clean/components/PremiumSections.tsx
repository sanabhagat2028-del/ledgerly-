"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { findRecurring, inr, shortDate, type Txn } from "@/lib/analysis";
import { todayIST } from "@/lib/dates";
import { upcoming, dueLabel, type Bill } from "@/lib/upcoming";
import { buildPlan, planSummary } from "@/lib/plan";

export type GoalLite = { id: string; name: string; target_amount: number; saved_amount: number };

async function call(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

function Locked({ what, onUpgrade, busy, note }: { what: string; onUpgrade: () => void; busy: boolean; note: string | null }) {
  return (
    <div className="plan-box">
      <p>{what}</p>
      <p>
        <b>Premium</b> <span className="mono">₹149 a month</span>
      </p>
      <button className="stamp-btn" onClick={onUpgrade} disabled={busy}>
        {busy ? "Opening checkout" : "Upgrade to Premium"}
      </button>
      {note && (
        <p className="login-err" role="alert">
          {note}
        </p>
      )}
    </div>
  );
}

type Props = {
  premium: boolean;
  txns: Txn[];
  bills: Bill[];
  goals: GoalLite[];
  onUpgrade: () => void;
  upgrading: boolean;
  payNote: string | null;
};

export function RemindersSection({ premium, txns, bills, onUpgrade, upgrading, payNote }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("");
  const [kind, setKind] = useState<"bill" | "emi" | "card">("bill");
  const [remind, setRemind] = useState("3");
  const [err, setErr] = useState<string | null>(null);

  const soon = useMemo(() => upcoming(bills, findRecurring(txns), todayIST()), [bills, txns]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const r = await call("/api/bills", {
      method: "POST",
      body: JSON.stringify({
        name,
        amount: Number(amount.replace(/,/g, "")),
        due_day: Number(day),
        kind,
        remind_days_before: Number(remind),
      }),
    });
    if (!r.ok) {
      setErr(r.json.error ?? "Could not save the bill.");
      return;
    }
    setName("");
    setAmount("");
    setDay("");
    router.refresh();
  }

  async function remove(id: string) {
    const r = await call(`/api/bills?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.ok) router.refresh();
  }

  return (
    <section className="sec dash">
      <h2>Bills and EMIs.</h2>
      {!premium ? (
        <>
          <p className="lede">
            Add the bills and EMIs you pay each month. Ledgerly tells you a few days before each one is due, by email
            by email, and in the app.
          </p>
          <Locked what="Bill and EMI reminders are part of Premium." onUpgrade={onUpgrade} busy={upgrading} note={payNote} />
        </>
      ) : (
        <>
          <p className="lede">
            Coming up in the next two weeks, from the bills you add and the regular charges we spot in your entries.
          </p>
          {soon.length === 0 ? (
            <p className="lede">Nothing due in the next 14 days.</p>
          ) : (
            <ul className="fixed soon">
              {soon.map((u) => (
                <li key={u.key}>
                  <span>
                    <b>{u.name}</b> <span className="cap">{shortDate(u.due)}, {dueLabel(u.inDays)}</span>
                  </span>
                  <span className="mono">{inr(u.amount)}</span>
                </li>
              ))}
            </ul>
          )}

          {bills.length > 0 && (
            <ul className="goals">
              {bills.map((b) => (
                <li key={b.id} className="goal">
                  <div className="goal-top">
                    <b>{b.name}</b>
                    <span className="mono">
                      {inr(b.amount)} on the {b.due_day}
                      {suffix(b.due_day)}
                    </span>
                  </div>
                  <div className="goal-add">
                    <span className="cap">Reminder {b.remind_days_before} {b.remind_days_before === 1 ? "day" : "days"} before</span>
                    <button className="how" onClick={() => remove(b.id)}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form className="goal-form" onSubmit={add}>
            <input className="login-input" placeholder="Name, for example Home loan EMI" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Bill name" required />
            <input className="login-input mono" placeholder="Amount in ₹" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount in rupees" required />
            <input className="login-input mono" placeholder="Due day (1 to 31)" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Due day of the month" required />
            <label className="month-pick">
              <span className="cap">Type</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="bill">Bill</option>
                <option value="emi">EMI</option>
                <option value="card">Card payment</option>
              </select>
            </label>
            <label className="month-pick">
              <span className="cap">Remind me</span>
              <select value={remind} onChange={(e) => setRemind(e.target.value)}>
                {[0, 1, 2, 3, 5, 7].map((d) => (
                  <option key={d} value={d}>{d === 0 ? "On the day" : `${d} ${d === 1 ? "day" : "days"} before`}</option>
                ))}
              </select>
            </label>
            <button className="stamp-sm" type="submit">Add bill</button>
          </form>
          {err && <p className="login-err" role="alert">{err}</p>}
        </>
      )}
    </section>
  );
}

function suffix(d: number) {
  if (d % 100 >= 11 && d % 100 <= 13) return "th";
  return ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[d % 10] ?? "th";
}

export function PlanSection({ premium, txns, goals, onUpgrade, upgrading, payNote }: Props) {
  const plan = useMemo(
    () => buildPlan(txns, goals.map((g) => ({ id: g.id, name: g.name, target: Number(g.target_amount), saved: Number(g.saved_amount) }))),
    [txns, goals]
  );

  return (
    <section className="sec dash">
      <h2>Your savings plan.</h2>
      {!premium ? (
        <>
          <p className="lede">A plan built from your own last few months: what you could trim, and how soon your goals get funded.</p>
          <Locked what="The personalised savings plan is part of Premium." onUpgrade={onUpgrade} busy={upgrading} note={payNote} />
        </>
      ) : !plan ? (
        <p className="lede">Add a few messages or a statement and your plan appears here.</p>
      ) : (
        <>
          <p className="lede">
            Based on {plan.basis}. {planSummary(plan)}
          </p>
          {plan.note && <p className="login-note">{plan.note}</p>}

          <div className="plan-grid">
            {plan.income !== null && (
              <div className="plan-stat">
                <span className="cap">Money in, a month</span>
                <span className="mono big-s">{inr(plan.income)}</span>
              </div>
            )}
            <div className="plan-stat">
              <span className="cap">Spent, a month</span>
              <span className="mono big-s">{inr(plan.spend)}</span>
            </div>
            {plan.saving !== null && (
              <div className="plan-stat">
                <span className="cap">Saved, a month</span>
                <span className="mono big-s">{inr(Math.max(plan.saving, 0))}</span>
                {plan.savingRate !== null && (
                  <span className="cap">{Math.round(Math.max(plan.savingRate, 0) * 100)}% of what comes in</span>
                )}
              </div>
            )}
            {plan.invested > 0 && (
              <div className="plan-stat">
                <span className="cap">Invested, a month</span>
                <span className="mono big-s">{inr(plan.invested)}</span>
              </div>
            )}
          </div>

          <p className="cap" style={{ marginTop: ".8rem" }}>
            Spending leaves out credit card bill payments, because the card purchases behind them are already counted.
          </p>

          {plan.trims.length > 0 && (
            <>
              <h3 className="stmt-h" style={{ marginTop: "2rem" }}>Where to trim</h3>
              <ul className="fixed">
                {plan.trims.map((t) => (
                  <li key={t.category}>
                    <span>
                      <b>{t.category}</b> <span className="cap">from {inr(t.now)} to {inr(t.target)}</span>
                    </span>
                    <span className="mono">save {inr(t.cut)}</span>
                  </li>
                ))}
              </ul>
              <p className="cap" style={{ marginTop: ".6rem" }}>Trimming all of these adds {inr(plan.trimTotal)} a month.</p>
            </>
          )}

          {plan.goals.length > 0 && (
            <>
              <h3 className="stmt-h" style={{ marginTop: "2rem" }}>Your goals</h3>
              <ul className="fixed">
                {plan.goals.map((g) => (
                  <li key={g.name}>
                    <span>
                      <b>{g.name}</b> <span className="cap">{inr(g.remaining)} to go</span>
                    </span>
                    <span className="mono">
                      {g.monthsToGo === null ? "no saving yet" : g.monthsToGo === 1 ? "about 1 month" : `about ${g.monthsToGo} months`}
                    </span>
                  </li>
                ))}
              </ul>
              {plan.planSaving !== null && (
                <p className="cap" style={{ marginTop: ".6rem" }}>
                  At {inr(plan.planSaving)} a month, which is your saving today plus the trims above.
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
