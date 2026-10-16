import assert from "node:assert/strict";
import { buildRunway, buildWrapped, runwayLine, whatIf } from "../lib/insights";
import { findRecurring, type Txn } from "../lib/analysis";

let passed = 0;
const t = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log("ok  ", name);
};

let n = 0;
const mk = (d: string, merchant: string, category: string, amount: number, direction: "debit" | "credit" = "debit"): Txn => ({
  id: String(++n), occurred_on: d, merchant, category, amount, direction,
});
const ist = (iso: string) => ({ iso, year: +iso.slice(0, 4), month: +iso.slice(5, 7), day: +iso.slice(8, 10), dow: 0 });

const base: Txn[] = [
  mk("2026-09-01", "Credit", "Money in", 50000, "credit"),
  mk("2026-09-07", "Rent", "Rent", 18000),
  mk("2026-09-10", "Swiggy", "Food delivery", 2000),
  mk("2026-10-01", "Credit", "Money in", 50000, "credit"),
  mk("2026-10-07", "Rent", "Rent", 18000),
  mk("2026-10-05", "Swiggy", "Food delivery", 4000),
  mk("2026-10-09", "Zomato", "Food delivery", 3000),
  mk("2026-10-09", "Blinkit", "Groceries", 1000),
  mk("2026-10-12", "Card payment", "Card bill", 9000),
  mk("2026-10-03", "Zerodha", "Investments", 2000),
];

t("wrapped: persona, top merchant, big day, change vs last month", () => {
  const w = buildWrapped(base, "2026-10")!;
  assert.equal(w.spend, 26000); // card bill and investments are not spend
  assert.equal(w.persona.title, "The Delivery Loyalist"); // 7000 of 26000 is 27%
  assert.equal(w.topMerchant!.name, "Swiggy");
  assert.equal(w.bigDay!.iso, "2026-10-09"); // 4000 on the 5th ties the 9th; the later day wins; rent is left out
  assert.equal(Math.round(w.change!.pct), 30); // 26000 vs 20000
  assert.equal(w.invested, 2000);
});

t("wrapped: no spending gives null; first month has no change", () => {
  assert.equal(buildWrapped(base, "2026-08"), null);
  assert.equal(buildWrapped(base, "2026-09")!.change, null);
});

t("wrapped: investing 10% of income wins the persona", () => {
  const w = buildWrapped([...base, mk("2026-10-20", "Zerodha", "Investments", 4000)], "2026-10")!;
  assert.equal(w.persona.title, "The Quiet Compounder");
});

t("runway: safe to spend, committed bills, lasts the month", () => {
  const rec = findRecurring([
    mk("2026-08-18", "Home Loan EMI", "EMIs", 7000),
    mk("2026-09-18", "Home Loan EMI", "EMIs", 7000),
  ]);
  const r = buildRunway(base, [], rec, ist("2026-10-16"))!;
  assert.equal(r.income, 50000);
  assert.equal(r.spent, 28000); // rent, food, groceries, investment; card bill excluded
  assert.equal(r.committed, 7000); // EMI projected to 18 Oct
  assert.equal(r.left, 15000);
  assert.equal(r.daysLeft, 16);
  assert.equal(Math.round(r.safeToday), 938);
  assert.equal(r.pace, 500); // 8000 flexible over 16 days
  assert.equal(r.lastsMonth, true);
  assert.match(runwayLine(r), /whole month/);
});

t("runway: fast spending runs out early; no data gives null; estimate income", () => {
  const heavy = [...base, mk("2026-10-15", "Amazon", "Shopping", 12000)];
  const r = buildRunway(heavy, [], [], ist("2026-10-16"))!;
  assert.equal(r.left, 50000 - 40000); // 10000 left
  assert.equal(r.lastsMonth, false);
  assert.equal(r.lastsUntil, "2026-10-24"); // pace 20000/16=1250, 10000/1250 = 8 days from the 16th
  assert.match(runwayLine(r), /runs out around 24 Oct/);
  assert.equal(buildRunway(base, [], [], ist("2026-11-05")), null); // nothing yet in November
  const noSalary = [...base.filter((x) => x.direction === "debit" || x.occurred_on < "2026-10")];
  const e = buildRunway(noSalary, [], [], ist("2026-10-16"))!;
  assert.equal(e.incomeIsEstimate, true);
  assert.equal(e.income, 50000); // September's salary
});

t("what-if: yearly total and SIP at 12 percent", () => {
  const w = whatIf(1000);
  assert.equal(w.yearly, 12000);
  assert.equal(w.years[0].saved, 12000);
  assert.equal(Math.round(w.years[0].sip), 12683); // 1000/month for a year at 1% a month
  assert.equal(Math.round(w.years[2].sip), 81670);
  assert.equal(whatIf(0).years[1].sip, 0);
});

console.log(`\n${passed} passed`);
