"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseSms, CATEGORIES } from "@/lib/parser";
import {
  categoryTotals,
  findRecurring,
  headline,
  inr,
  monthLabel,
  months as monthsOf,
  shortDate,
  spentIn,
  type Txn,
} from "@/lib/analysis";

export type Goal = { id: string; name: string; target_amount: number; saved_amount: number };

type Props = {
  email: string;
  plan: "free" | "premium";
  txns: Txn[];
  goals: Goal[];
  justUpgraded: boolean;
};

type Note = { kind: "ok" | "err"; text: string } | null;

const CHUNK = 400;

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export default function Dashboard({ email, plan, txns, goals, justUpgraded }: Props) {
  const router = useRouter();
  const premium = plan === "premium";

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [selected, setSelected] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [stamped, setStamped] = useState<Set<string>>(new Set());
  const [goalName, setGoalName] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalNote, setGoalNote] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [payNote, setPayNote] = useState<string | null>(null);

  const monthList = useMemo(() => monthsOf(txns), [txns]);
  const ym = monthList.includes(selected) ? selected : monthList[0];
  const totals = useMemo(() => (ym ? categoryTotals(txns, ym) : []), [txns, ym]);
  const maxTotal = totals[0]?.total ?? 0;
  const spent = ym ? spentIn(txns, ym) : 0;
  const said = ym ? headline(txns, ym) : null;
  const recurring = useMemo(() => findRecurring(txns), [txns]);
  const cancellable = recurring.filter((r) => r.cancellable);
  const fixed = recurring.filter((r) => !r.cancellable);
  const saving = cancellable.filter((r) => stamped.has(r.key)).reduce((s, r) => s + r.monthly, 0);
  const monthTxns = useMemo(
    () => (ym ? txns.filter((t) => t.occurred_on.startsWith(ym)) : []).sort((a, b) => b.occurred_on.localeCompare(a.occurred_on)),
    [txns, ym]
  );
  const visibleTxns = showAll ? monthTxns : monthTxns.slice(0, 25);

  async function addMessages() {
    const { txns: parsed, skipped } = parseSms(text);
    if (parsed.length === 0) {
      setNote({
        kind: "err",
        text: skipped
          ? "Those look like OTPs or reminders, not transactions. Paste the debit or credit alerts."
          : "Paste at least one bank SMS first.",
      });
      return;
    }
    setBusy(true);
    setNote(null);
    let added = 0;
    let dupes = 0;
    for (let i = 0; i < parsed.length; i += CHUNK) {
      const r = await api("/api/transactions", {
        method: "POST",
        body: JSON.stringify({ transactions: parsed.slice(i, i + CHUNK) }),
      });
      if (!r.ok) {
        setBusy(false);
        setNote({ kind: "err", text: r.json.error ?? "Could not save. Try again." });
        if (added > 0) router.refresh();
        return;
      }
      added += r.json.added ?? 0;
      dupes += r.json.duplicates ?? 0;
    }
    setBusy(false);
    setText("");
    const bits = [`Added ${added} ${added === 1 ? "entry" : "entries"}`];
    if (dupes) bits.push(`${dupes} already in your khata`);
    if (skipped) bits.push(`${skipped} skipped as not transactions`);
    setNote({ kind: "ok", text: bits.join(", ") + "." });
    router.refresh();
  }

  async function recategorise(id: string, category: string) {
    const r = await api("/api/transactions", { method: "PATCH", body: JSON.stringify({ id, category }) });
    if (r.ok) router.refresh();
    else setNote({ kind: "err", text: r.json.error ?? "Could not change the category." });
  }

  async function remove(id: string) {
    const r = await api(`/api/transactions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.ok) router.refresh();
    else setNote({ kind: "err", text: r.json.error ?? "Could not delete." });
  }

  async function upgrade() {
    setUpgrading(true);
    setPayNote(null);
    const r = await api("/api/checkout", { method: "POST" });
    if (r.ok && r.json.url) {
      window.location.href = r.json.url;
      return;
    }
    setUpgrading(false);
    setPayNote(r.json.error ?? "Could not open checkout. Try again.");
  }

  async function addGoal(e: React.FormEvent) {
    e.preventDefault();
    setGoalNote(null);
    const target = Number(goalTarget.replace(/,/g, ""));
    const r = await api("/api/goals", { method: "POST", body: JSON.stringify({ name: goalName, target_amount: target }) });
    if (!r.ok) {
      setGoalNote(r.json.error ?? "Could not save the goal.");
      return;
    }
    setGoalName("");
    setGoalTarget("");
    router.refresh();
  }

  async function contribute(id: string, raw: string) {
    const add = Number(raw.replace(/,/g, ""));
    const r = await api("/api/goals", { method: "PATCH", body: JSON.stringify({ id, add }) });
    if (!r.ok) setGoalNote(r.json.error ?? "Could not update the goal.");
    else router.refresh();
  }

  async function removeGoal(id: string) {
    const r = await api(`/api/goals?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.ok) router.refresh();
  }

  async function wipe() {
    const r = await api("/api/data", { method: "DELETE" });
    setConfirmWipe(false);
    if (r.ok) {
      setStamped(new Set());
      setNote({ kind: "ok", text: "Everything in your khata is deleted." });
      router.refresh();
    } else {
      setNote({ kind: "err", text: r.json.error ?? "Could not delete everything." });
    }
  }

  const toggle = (key: string) =>
    setStamped((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="page">
      <header className="top">
        <a className="mark" href="/khata" style={{ textDecoration: "none", color: "inherit" }}>
          Ledgerly<i>.</i>
        </a>
        <div className="who">
          <span className="cap">{email}</span>
          <form action="/auth/signout" method="post">
            <button className="how" type="submit">Sign out</button>
          </form>
        </div>
      </header>

      {justUpgraded && (
        <p className="banner" role="status">
          {premium
            ? "Premium is on. Thank you."
            : "Payment received. Premium switches on within a minute. Refresh this page if it does not."}
        </p>
      )}

      {/* ADD */}
      <section className="sec dash">
        <h2>Add messages.</h2>
        <p className="lede">
          Paste your bank SMS alerts. Put one per line, or separate them with a blank line. They are read in this browser,
          and only the date, merchant, category and amount are saved.
        </p>
        <label className="login-label" htmlFor="sms">Bank messages</label>
        <textarea
          id="sms"
          className="paste mono"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Rs.649.00 debited from a/c XX4821 to NETFLIX.COM on 03-09-26. UPI Ref 4839201.\nINR 412.00 spent on HDFC Card XX7710 at SWIGGY on 05-09-26."}
        />
        <div className="row-actions">
          <button className="stamp-btn" onClick={addMessages} disabled={busy}>
            {busy ? "Adding" : "Add to khata"}
          </button>
          {note && (
            <p className={note.kind === "err" ? "login-err" : "login-note"} role="status">
              {note.text}
            </p>
          )}
        </div>
      </section>

      {txns.length === 0 ? (
        <section className="sec dash">
          <h2>Your khata is empty.</h2>
          <p className="lede">
            Paste a few alerts above and the month appears here: spend by category, subscriptions worth a second look, and
            what you could save.
          </p>
        </section>
      ) : (
        <>
          {/* MONTH */}
          <section className="sec dash">
            <div className="month-head">
              <h2>Your month.</h2>
              <label className="month-pick">
                <span className="cap">Month</span>
                <select value={ym} onChange={(e) => { setSelected(e.target.value); setShowAll(false); }}>
                  {monthList.map((m) => (
                    <option key={m} value={m}>{monthLabel(m)}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="report-wrap">
              <article className="report">
                <div className="report-head">
                  <span className="ital">{ym ? monthLabel(ym) : ""} khata</span>
                  <span className="mono" style={{ fontSize: ".85rem" }}>{inr(spent)} spent</span>
                </div>
                {totals.length === 0 ? (
                  <p className="lede" style={{ marginTop: "1rem" }}>No spending recorded this month.</p>
                ) : (
                  <div className="bars">
                    {totals.map((c, i) => (
                      <div className="bar-row" key={c.category}>
                        <span className="l mono">{c.category}</span>
                        <div className={"bar" + (i === 0 ? " hot" : "")} style={{ width: `${Math.max(4, (c.total / maxTotal) * 100)}%` }} />
                        <span className="v mono">{inr(c.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {said && <p className="said hand">{said}</p>}
              </article>
            </div>
          </section>

          {/* CANCEL */}
          <section className="sec dash">
            <h2>Cancel these.</h2>
            {cancellable.length === 0 ? (
              <p className="lede">
                No subscriptions spotted yet. Add a few months of messages and anything that repeats shows up here.
              </p>
            ) : (
              <>
                <p className="lede">Tap a subscription to stamp it, then cancel it with the company.</p>
                <div className="cancel-wrap">
                  <ul className="subs">
                    {cancellable.map((r) => (
                      <li key={r.key} className={"sub" + (stamped.has(r.key) ? " cancelled" : "")}>
                        <button className="sub-hit" aria-pressed={stamped.has(r.key)} onClick={() => toggle(r.key)}>
                          <span className="sub-name">{r.merchant}</span>
                          <span className="sub-why">{r.why}. Last charged {shortDate(r.lastSeen)}.</span>
                          <span className="sub-amt mono">{inr(r.monthly)}<small>a month</small></span>
                          <span className="cstamp" aria-hidden="true">Cancelled</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="tally" aria-live="polite">
                    <span className="cap">You could save</span>
                    <span className="big mono">{inr(saving)}</span>
                    <p className="yr">a month. That is <span className="mono">{inr(saving * 12)}</span> a year.</p>
                  </div>
                </div>
              </>
            )}
            {fixed.length > 0 && (
              <div className="fixed">
                <p className="cap">Other regular charges</p>
                <ul>
                  {fixed.map((r) => (
                    <li key={r.key}>
                      <span>{r.merchant}</span>
                      <span className="mono">{inr(r.monthly)} a month</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* ENTRIES */}
          <section className="sec dash">
            <h2>Entries.</h2>
            <p className="lede">Wrong category? Change it here. Wrong entry? Delete it.</p>
            <ul className="entries">
              {visibleTxns.map((t) => (
                <li key={t.id} className="erow">
                  <span className="mono d">{shortDate(t.occurred_on)}</span>
                  <span className="em">{t.merchant}</span>
                  <select
                    aria-label={`Category for ${t.merchant}`}
                    value={t.category}
                    onChange={(e) => recategorise(t.id, e.target.value)}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <span className={"mono ea" + (t.direction === "credit" ? " in" : "")}>
                    {t.direction === "credit" ? "+" : ""}{inr(t.amount)}
                  </span>
                  <button className="x" aria-label={`Delete ${t.merchant} entry`} onClick={() => remove(t.id)}>Delete</button>
                </li>
              ))}
            </ul>
            {monthTxns.length > 25 && !showAll && (
              <button className="how" onClick={() => setShowAll(true)}>Show all {monthTxns.length} entries</button>
            )}
          </section>
        </>
      )}

      {/* GOALS */}
      <section className="sec dash">
        <h2>Savings goals.</h2>
        {premium ? (
          <>
            <p className="lede">Name a goal, set a target, and add to it as you save.</p>
            <ul className="goals">
              {goals.map((g) => {
                const pct = Math.min(100, (Number(g.saved_amount) / Number(g.target_amount)) * 100);
                return (
                  <li key={g.id} className="goal">
                    <div className="goal-top">
                      <b>{g.name}</b>
                      <span className="mono">{inr(Number(g.saved_amount))} of {inr(Number(g.target_amount))}</span>
                    </div>
                    <div className="meter" aria-hidden="true"><div className="meter-fill" style={{ width: `${pct}%` }} /></div>
                    <GoalAdd id={g.id} onAdd={contribute} onRemove={removeGoal} />
                  </li>
                );
              })}
            </ul>
            <form className="goal-form" onSubmit={addGoal}>
              <input className="login-input" placeholder="Goal, for example Goa trip" value={goalName} onChange={(e) => setGoalName(e.target.value)} maxLength={80} aria-label="Goal name" required />
              <input className="login-input mono" placeholder="Target in ₹" inputMode="numeric" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} aria-label="Target amount in rupees" required />
              <button className="stamp-sm" type="submit">Add goal</button>
            </form>
            {goalNote && <p className="login-err" role="alert">{goalNote}</p>}
          </>
        ) : (
          <>
            <p className="lede">Savings goals are part of Premium. Set a target, track it against what you actually save.</p>
            <div className="plan-box">
              <p><b>Premium</b> <span className="mono">₹149 a month</span></p>
              <p className="cap">Savings goals today. Bill and EMI reminders and a personalised savings plan are coming.</p>
              <button className="stamp-btn" onClick={upgrade} disabled={upgrading}>
                {upgrading ? "Opening checkout" : "Upgrade to Premium"}
              </button>
              {payNote && <p className="login-err" role="alert">{payNote}</p>}
            </div>
          </>
        )}
      </section>

      {/* PRIVACY */}
      <section className="sec dash">
        <h2>Your data.</h2>
        <p className="lede">Delete every entry and goal in your khata. This cannot be undone.</p>
        {confirmWipe ? (
          <div className="row-actions">
            <button className="stamp-btn" onClick={wipe}>Yes, delete everything</button>
            <button className="how" onClick={() => setConfirmWipe(false)}>Keep my data</button>
          </div>
        ) : (
          <button className="stamp-sm" onClick={() => setConfirmWipe(true)}>Delete my data</button>
        )}
      </section>

      <footer>
        <span className="sign hand">Balanced by hand.</span>
        <p>Ledgerly</p>
      </footer>
    </div>
  );
}

function GoalAdd({
  id,
  onAdd,
  onRemove,
}: {
  id: string;
  onAdd: (id: string, raw: string) => void;
  onRemove: (id: string) => void;
}) {
  const [v, setV] = useState("");
  return (
    <div className="goal-add">
      <input
        className="login-input mono"
        placeholder="Add ₹"
        inputMode="numeric"
        value={v}
        onChange={(e) => setV(e.target.value)}
        aria-label="Amount to add to this goal"
      />
      <button
        className="how"
        onClick={() => {
          if (v.trim()) {
            onAdd(id, v);
            setV("");
          }
        }}
      >
        Add
      </button>
      <button className="how" onClick={() => onRemove(id)}>Remove goal</button>
    </div>
  );
}
