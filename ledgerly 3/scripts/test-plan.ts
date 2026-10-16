import assert from "node:assert/strict";
import { addMonths, daysBetween, isoOf, nextDue, todayIST } from "../lib/dates";
import { upcoming, type Bill } from "../lib/upcoming";
import { buildPlan } from "../lib/plan";
import type { Recurring, Txn } from "../lib/analysis";

let passed = 0;
const t = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log("ok  ", name);
};

const ist = (iso: string) => ({ iso, year: +iso.slice(0, 4), month: +iso.slice(5, 7), day: +iso.slice(8, 10), dow: 0 });

t("todayIST uses India time (UTC evening is already tomorrow in IST)", () => {
  const d = todayIST(new Date("2026-10-14T20:00:00Z")); // 01:30 on the 15th in IST
  assert.equal(d.iso, "2026-10-15");
  assert.equal(d.dow, 4); // Thursday
});

t("nextDue clamps to short months and rolls over the year", () => {
  assert.equal(nextDue(31, ist("2026-02-10")), "2026-02-28");
  assert.equal(nextDue(5, ist("2026-12-20")), "2027-01-05");
  assert.equal(nextDue(15, ist("2026-10-15")), "2026-10-15"); // due today counts
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(isoOf(2026, 4, 31), "2026-04-30");
  assert.equal(daysBetween("2026-10-15", "2026-10-18"), 3);
});

t("upcoming: bills, detected projection, de-duplication, window", () => {
  const bills: Bill[] = [{ id: "b1", name: "Home loan EMI", amount: 7240, due_day: 18, kind: "emi", remind_days_before: 3 }];
  const rec: Recurring[] = [
    { key: "netflix", merchant: "Netflix", category: "Subscriptions", monthly: 649, count: 3, lastSeen: "2026-09-20", priceUp: null, cancellable: true, why: "" },
    { key: "homeloanemi", merchant: "Home Loan EMI", category: "EMIs", monthly: 7240, count: 3, lastSeen: "2026-09-18", priceUp: null, cancellable: false, why: "" },
    { key: "gym", merchant: "Gym", category: "Subscriptions", monthly: 999, count: 2, lastSeen: "2026-08-02", priceUp: null, cancellable: true, why: "" },
  ];
  const u = upcoming(bills, rec, ist("2026-10-15"));
  assert.deepEqual(u.map((x) => x.name), ["Home loan EMI", "Netflix"]);
  assert.equal(u[0].inDays, 3);
  assert.equal(u[1].due, "2026-10-20");
  assert.equal(u.find((x) => x.name === "Gym"), undefined); // 2026-11-02 is outside 14 days
});

const mk = (id: string, d: string, merchant: string, category: string, amount: number, direction: "debit" | "credit" = "debit"): Txn => ({
  id, occurred_on: d, merchant, category, amount, direction,
});

t("plan: income, spend, trims and goal timeline", () => {
  const txns: Txn[] = [];
  for (const m of ["2026-07", "2026-08", "2026-09"]) {
    txns.push(mk(m + "i", `${m}-01`, "Acme", "Money in", 80000, "credit"));
    txns.push(mk(m + "r", `${m}-05`, "Rent", "Rent", 25000));
    txns.push(mk(m + "f", `${m}-10`, "Swiggy", "Food delivery", 8000));
    txns.push(mk(m + "s", `${m}-12`, "Shopping", "Shopping", 6000));
    txns.push(mk(m + "g", `${m}-15`, "Bigbasket", "Groceries", 9000));
    txns.push(mk(m + "c", `${m}-20`, "Card", "Card bill", 15000)); // ignored
    txns.push(mk(m + "v", `${m}-28`, "Groww", "Investments", 5000)); // saved, not spent
  }
  const p = buildPlan(txns, [{ id: "g", name: "Goa trip", target: 60000, saved: 10000 }])!;
  assert.equal(p.months, 3);
  assert.equal(Math.round(p.income!), 80000);
  assert.equal(Math.round(p.spend), 48000); // 25000 + 8000 + 6000 + 9000
  assert.equal(Math.round(p.saving!), 32000);
  assert.ok(Math.abs(p.savingRate! - 0.4) < 1e-9);
  const food = p.trims.find((x) => x.category === "Food delivery")!;
  assert.equal(food.cut, 2000);
  assert.equal(p.trims.find((x) => x.category === "Rent"), undefined);
  assert.equal(p.trimTotal, 2000 + 1200);
  assert.equal(p.goals[0].remaining, 50000);
  assert.equal(p.goals[0].monthsToGo, Math.ceil(50000 / (32000 + 3200)));
});

t("plan: partial newest month is ignored, no income is handled", () => {
  const txns: Txn[] = [
    mk("a", "2026-08-03", "Swiggy", "Food delivery", 4000),
    mk("b", "2026-08-28", "Rent", "Rent", 20000),
    mk("c", "2026-09-03", "Swiggy", "Food delivery", 700),
    mk("d", "2026-09-04", "Zomato", "Food delivery", 700),
  ];
  const p = buildPlan(txns, [])!;
  assert.equal(p.months, 1);
  assert.equal(Math.round(p.spend), 24000);
  assert.equal(p.income, null);
  assert.ok(p.note);
  assert.equal(buildPlan([], []), null);
});

console.log(`\n${passed} plan tests passed`);
