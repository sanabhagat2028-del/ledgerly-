"use client";

import { useMemo } from "react";
import { inr, monthLabel, type Recurring, type Txn } from "@/lib/analysis";
import { todayIST } from "@/lib/dates";
import { buildRunway, buildWrapped, runwayLine, whatIf, type Wrapped } from "@/lib/insights";
import type { Bill } from "@/lib/upcoming";

/* ---------- Money Runway ---------- */

export function RunwaySection({ txns, bills, recurring }: { txns: Txn[]; bills: Bill[]; recurring: Recurring[] }) {
  const r = useMemo(() => buildRunway(txns, bills, recurring, todayIST()), [txns, bills, recurring]);

  return (
    <section className="sec dash">
      <h2>Safe to spend today.</h2>
      {!r ? (
        <p className="lede">
          Add this month&rsquo;s bank messages, including your salary credit, and Ledgerly works out how much you can spend
          each day without running short.
        </p>
      ) : (
        <div className="runway">
          <div className={"tally runway-main" + (r.left <= 0 ? " tight" : "")} aria-live="polite">
            <span className="cap">You can spend today</span>
            <span className="big mono">{inr(r.safeToday)}</span>
            <p className="yr">{runwayLine(r)}</p>
          </div>
          <dl className="runway-sum mono">
            <div><dt>{r.incomeIsEstimate ? "Usual income" : "Money in this month"}</dt><dd>{inr(r.income)}</dd></div>
            <div><dt>Spent so far</dt><dd>&minus;{inr(r.spent)}</dd></div>
            <div><dt>Bills still due</dt><dd>&minus;{inr(r.committed)}</dd></div>
            <div className="total"><dt>Left for {r.daysLeft} {r.daysLeft === 1 ? "day" : "days"}</dt><dd>{inr(Math.max(r.left, 0))}</dd></div>
          </dl>
          {r.dueAhead.length > 0 && (
            <p className="cap runway-due">
              Still to come this month: {r.dueAhead.map((d) => `${d.name} ${inr(d.amount)}`).join(", ")}.
            </p>
          )}
          {r.incomeIsEstimate && (
            <p className="cap">No salary is recorded this month yet, so this uses your usual monthly income.</p>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------- Khata Wrapped ---------- */

function lines(w: Wrapped) {
  const out: { k: string; v: string }[] = [];
  if (w.topCategory) out.push({ k: "Biggest category", v: `${w.topCategory.name}, ${inr(w.topCategory.total)}` });
  if (w.topMerchant) out.push({ k: "Most spent on", v: `${w.topMerchant.name}, ${inr(w.topMerchant.total)}${w.topMerchant.count > 1 ? ` over ${w.topMerchant.count} orders` : ""}` });
  if (w.bigDay) out.push({ k: "Biggest day", v: `${w.bigDay.label}, ${inr(w.bigDay.total)}` });
  if (w.change) {
    const up = w.change.pct >= 0;
    out.push({ k: "Versus last month", v: `${up ? "Up" : "Down"} ${Math.abs(Math.round(w.change.pct))}%` });
  }
  return out;
}

async function downloadCard(w: Wrapped, saved: number) {
  const W = 1080;
  const H = 1350;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) return;
  g.fillStyle = "#1A1A1A";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#C8402B";
  g.fillRect(70, 90, 120, 8);

  const serif = 'Georgia, "Times New Roman", serif';
  const mono = 'ui-monospace, "IBM Plex Mono", Menlo, monospace';
  g.fillStyle = "#EDE6D6";
  g.font = `28px ${mono}`;
  g.fillText(`${monthLabel(w.month).toUpperCase()}  ·  KHATA WRAPPED`, 70, 160);

  g.font = `italic 40px ${serif}`;
  g.fillStyle = "#E2705A";
  g.fillText("You were", 70, 290);
  g.fillStyle = "#EDE6D6";
  g.font = `bold 96px ${serif}`;
  // wrap the persona title over at most two lines
  const words = w.persona.title.split(" ");
  const rows: string[] = [];
  let cur = "";
  for (const word of words) {
    const t = cur ? `${cur} ${word}` : word;
    if (g.measureText(t).width > W - 140 && cur) {
      rows.push(cur);
      cur = word;
    } else cur = t;
  }
  rows.push(cur);
  rows.forEach((r, i) => g.fillText(r, 70, 400 + i * 108));
  let y = 400 + rows.length * 108 + 20;

  g.font = `italic 34px ${serif}`;
  g.fillStyle = "rgba(237,230,214,.8)";
  const para = w.persona.line.split(" ");
  let row = "";
  for (const word of para) {
    const t = row ? `${row} ${word}` : word;
    if (g.measureText(t).width > W - 140 && row) {
      g.fillText(row, 70, y);
      y += 46;
      row = word;
    } else row = t;
  }
  g.fillText(row, 70, y);
  y += 90;

  g.fillStyle = "#EDE6D6";
  g.font = `28px ${mono}`;
  g.fillText("TOTAL SPENT", 70, y);
  g.font = `bold 110px ${mono}`;
  g.fillText(inr(w.spend), 70, y + 110);
  y += 190;

  for (const l of lines(w)) {
    g.strokeStyle = "rgba(237,230,214,.25)";
    g.beginPath();
    g.moveTo(70, y);
    g.lineTo(W - 70, y);
    g.stroke();
    g.fillStyle = "rgba(237,230,214,.65)";
    g.font = `24px ${mono}`;
    g.fillText(l.k.toUpperCase(), 70, y + 48);
    g.fillStyle = "#EDE6D6";
    g.font = `34px ${serif}`;
    g.fillText(l.v, 70, y + 96);
    y += 120;
  }
  if (saved > 0) {
    g.fillStyle = "#E2705A";
    g.font = `34px ${serif}`;
    g.fillText(`Cancelling would save ${inr(saved)} a month.`, 70, y + 50);
  }
  g.fillStyle = "rgba(237,230,214,.6)";
  g.font = `26px ${mono}`;
  g.fillText("Ledgerly. Balanced by hand.", 70, H - 70);

  const url = c.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = `ledgerly-${w.month}-wrapped.png`;
  a.click();
}

export function WrappedSection({ txns, ym, saved }: { txns: Txn[]; ym: string; saved: number }) {
  const w = useMemo(() => (ym ? buildWrapped(txns, ym) : null), [txns, ym]);
  if (!w) return null;
  return (
    <section className="sec dash">
      <h2>Khata Wrapped.</h2>
      <p className="lede">{monthLabel(w.month)} in one card. Screenshot it, or download it as a picture.</p>
      <article className="wrapped" aria-label={`Khata Wrapped for ${monthLabel(w.month)}`}>
        <span className="cap w-eyebrow">{monthLabel(w.month)} &middot; Khata Wrapped</span>
        <p className="w-you hand">You were</p>
        <h3 className="w-persona">{w.persona.title}</h3>
        <p className="w-line ital">{w.persona.line}</p>
        <div className="w-total">
          <span className="cap">Total spent</span>
          <span className="mono w-amt">{inr(w.spend)}</span>
        </div>
        <ul className="w-list">
          {lines(w).map((l) => (
            <li key={l.k}>
              <span className="cap">{l.k}</span>
              <span>{l.v}</span>
            </li>
          ))}
        </ul>
        {saved > 0 && <p className="w-save hand">Cancelling would save {inr(saved)} a month.</p>}
        <span className="cap w-foot">Ledgerly. Balanced by hand.</span>
      </article>
      <div className="row-actions">
        <button className="stamp-sm" onClick={() => downloadCard(w, saved)}>Download as picture</button>
      </div>
    </section>
  );
}

/* ---------- Cancel what-if ---------- */

export function WhatIfPanel({ monthly }: { monthly: number }) {
  if (monthly <= 0) return null;
  const w = whatIf(monthly);
  return (
    <div className="whatif">
      <p className="cap">What if you invested it instead</p>
      <table className="mono">
        <thead>
          <tr><th></th><th>Kept as cash</th><th>In a SIP</th></tr>
        </thead>
        <tbody>
          {w.years.map((y) => (
            <tr key={y.years}>
              <th scope="row">{y.years} {y.years === 1 ? "year" : "years"}</th>
              <td>{inr(y.saved)}</td>
              <td><b>{inr(y.sip)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cap">Illustration only. It assumes 12% a year, which is not guaranteed, and real returns can be lower or negative.</p>
    </div>
  );
}
