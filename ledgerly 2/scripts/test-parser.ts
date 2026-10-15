import assert from "node:assert/strict";
import { parseSms, parseDate } from "../lib/parser";
import { findRecurring, headline, type Txn } from "../lib/analysis";

let passed = 0;
const t = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log("ok  ", name);
};

const one = (sms: string) => {
  const r = parseSms(sms);
  assert.equal(r.txns.length, 1, `expected 1 txn for: ${sms}`);
  return r.txns[0];
};

t("Netflix UPI debit", () => {
  const x = one("Rs.649.00 debited from a/c XX4821 to NETFLIX.COM on 03-09-26. UPI Ref 4839201.");
  assert.equal(x.amount, 649);
  assert.equal(x.merchant, "Netflix");
  assert.equal(x.category, "Subscriptions");
  assert.equal(x.occurred_on, "2026-09-03");
  assert.equal(x.direction, "debit");
});

t("Swiggy card spend", () => {
  const x = one("INR 412.00 spent on HDFC Card XX7710 at SWIGGY on 05-09-26.");
  assert.equal(x.merchant, "Swiggy");
  assert.equal(x.category, "Food delivery");
  assert.equal(x.amount, 412);
});

t("Rent via UPI path", () => {
  const x = one("Rs.18,500.00 debited a/c XX4821 UPI/RENT SEP/ANIL K on 07-09-26.");
  assert.equal(x.amount, 18500);
  assert.equal(x.category, "Rent");
  assert.equal(x.merchant, "Rent");
});

t("EMI", () => {
  const x = one("Rs.7,240.00 debited towards EMI, Loan A/c XX3305 on 10-09-26.");
  assert.equal(x.category, "EMIs");
  assert.equal(x.amount, 7240);
});

t("Cult.fit with dotted name", () => {
  const x = one("INR 1,499.00 debited to CULT.FIT MEMBERSHIP on 12-09-26 via UPI.");
  assert.equal(x.category, "Subscriptions");
  assert.equal(x.merchant, "Cult.fit");
});

t("Credit is Money in", () => {
  const x = one("Rs 52,000.00 credited to a/c XX4821 on 01-09-2026 by ACME PAYROLL. Salary for Aug.");
  assert.equal(x.direction, "credit");
  assert.equal(x.category, "Money in");
});

t("Credit card in text is not a credit", () => {
  const x = one("Spent Rs.299 on your HDFC Credit Card XX1111 at HOTSTAR on 14/08/2026.");
  assert.equal(x.direction, "debit");
  assert.equal(x.category, "Subscriptions");
});

t("OTP and due reminders are skipped", () => {
  const r = parseSms("123456 is your OTP for Rs.500 transaction. Do not share.\n\nYour credit card bill of Rs.4,200 is due on 20-09-26.");
  assert.equal(r.txns.length, 0);
  assert.equal(r.skipped, 2);
});

t("Multiple messages, blank-line and line separated", () => {
  const r = parseSms(
    "Rs.100 debited to ZEPTO on 01-09-26\nRs.200 debited to ZOMATO on 02-09-26\n\nINR 300 spent at UBER on 03-09-26"
  );
  assert.equal(r.txns.length, 3);
  assert.deepEqual(r.txns.map((x) => x.category), ["Groceries", "Food delivery", "Travel"]);
});

t("Identical repeats in one paste both count, re-paste reproduces fingerprints", () => {
  const sms = "Rs.120 spent at CAFE COFFEE DAY on 04-09-26\nRs.120 spent at CAFE COFFEE DAY on 04-09-26";
  const a = parseSms(sms);
  const b = parseSms(sms);
  assert.equal(a.txns.length, 2);
  assert.notEqual(a.txns[0].fingerprint, a.txns[1].fingerprint);
  assert.deepEqual(a.txns.map((x) => x.fingerprint), b.txns.map((x) => x.fingerprint));
});

t("Dates: formats and invalid", () => {
  assert.equal(parseDate("on 3/9/2026"), "2026-09-03");
  assert.equal(parseDate("on 03-Sep-26"), "2026-09-03");
  assert.equal(parseDate("on 31-02-26"), null);
});

t("Recurring detection and price hike", () => {
  const mk = (id: string, d: string, m: string, c: string, a: number): Txn => ({
    id, occurred_on: d, merchant: m, category: c, amount: a, direction: "debit",
  });
  const txns = [
    mk("1", "2026-07-12", "Cult.fit", "Subscriptions", 1299),
    mk("2", "2026-08-12", "Cult.fit", "Subscriptions", 1299),
    mk("3", "2026-09-12", "Cult.fit", "Subscriptions", 1499),
    mk("4", "2026-08-03", "Netflix", "Subscriptions", 649),
    mk("5", "2026-09-03", "Netflix", "Subscriptions", 649),
    mk("6", "2026-08-07", "Rent", "Rent", 18500),
    mk("7", "2026-09-07", "Rent", "Rent", 18500),
    mk("8", "2026-09-05", "Swiggy", "Food delivery", 412),
  ];
  const rec = findRecurring(txns);
  const cult = rec.find((r) => r.merchant === "Cult.fit")!;
  assert.equal(cult.priceUp, 200);
  assert.equal(cult.cancellable, true);
  assert.equal(rec.find((r) => r.merchant === "Rent")!.cancellable, false);
  assert.equal(rec.find((r) => r.merchant === "Swiggy"), undefined);
  assert.match(headline(txns, "2026-09")!, /Subscriptions was ₹200 more than last month\.|Food delivery/);
});

console.log(`\n${passed} tests passed`);
