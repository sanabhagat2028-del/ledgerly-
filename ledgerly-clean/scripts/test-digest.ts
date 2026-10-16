import assert from "node:assert/strict";
import { answerCommand, categoryBreakdown, dueReminders, findCategory, monthlyKhata, weeklyDigest } from "../lib/digest";
import { checkUnsubToken, unsubToken, verifyMetaSignature } from "../lib/notify";
import { createHmac } from "node:crypto";
import type { Txn } from "../lib/analysis";
import type { Bill } from "../lib/upcoming";

let passed = 0;
const t = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log("ok  ", name);
};
const ist = (iso: string, dow = 0) => ({ iso, year: +iso.slice(0, 4), month: +iso.slice(5, 7), day: +iso.slice(8, 10), dow });
const mk = (id: string, d: string, merchant: string, category: string, amount: number, direction: "debit" | "credit" = "debit"): Txn => ({
  id, occurred_on: d, merchant, category, amount, direction,
});

const txns: Txn[] = [
  mk("1", "2026-08-03", "Netflix", "Subscriptions", 649),
  mk("2", "2026-09-03", "Netflix", "Subscriptions", 649),
  mk("3", "2026-08-05", "Swiggy", "Food delivery", 3000),
  mk("4", "2026-09-05", "Swiggy", "Food delivery", 5200),
  mk("5", "2026-09-09", "Zomato", "Food delivery", 1650),
  mk("6", "2026-09-07", "Rent", "Rent", 18500),
  mk("7", "2026-09-01", "Acme", "Money in", 80000, "credit"),
  mk("8", "2026-10-08", "Swiggy", "Food delivery", 500),
  mk("9", "2026-10-12", "Uber", "Travel", 300),
  mk("10", "2026-10-02", "Swiggy", "Food delivery", 900),
];

t("monthly khata message", () => {
  const m = monthlyKhata(txns, "2026-09", [], false)!;
  assert.match(m, /^September 2026 khata: you spent ₹25,999 across 3 categories\./);
  assert.match(m, /Rent was ₹18,500 more than last month\./); // the biggest change
  assert.match(m, /1 subscription worth ₹649 a month deserves a second look: Netflix\./);
  assert.equal(monthlyKhata(txns, "2026-06", [], false), null);
});

t("weekly digest compares the last 7 days with the 7 before", () => {
  const w = weeklyDigest(txns, ist("2026-10-14", 3))!; // 7..13 Oct vs 30 Sep..6 Oct
  assert.match(w, /^Last 7 days you spent ₹800,/);
  assert.match(w, /₹100 less than the week before/);
  assert.match(w, /Biggest: Food delivery, ₹500\./);
});

t("reminders fire only on the remind day", () => {
  const bills: Bill[] = [{ id: "b1", name: "Home loan EMI", amount: 7240, due_day: 18, kind: "emi", remind_days_before: 3 }];
  assert.equal(dueReminders(bills, [], ist("2026-10-14")).length, 0);
  const r = dueReminders(bills, [], ist("2026-10-15"));
  assert.equal(r.length, 1);
  assert.equal(r[0].text, "Reminder: Home loan EMI, ₹7,240, is due in 3 days.");
  assert.equal(r[0].key, "rem:bill:b1:2026-10-18"); // same key next run, so it is not sent twice
});

t("WhatsApp commands", () => {
  const today = ist("2026-10-14", 3);
  assert.equal(findCategory("food"), "Food delivery");
  assert.equal(findCategory("sub"), "Subscriptions");
  assert.equal(findCategory("zz"), null);
  assert.match(categoryBreakdown(txns, "2026-10", "Food delivery"), /Food delivery, October 2026: 2 entries, ₹1,400\.\nSwiggy 2x, ₹1,400/);
  assert.match(answerCommand("help", txns, [], [], false, today), /^Ledgerly\. Send/);
  assert.match(answerCommand("Food", txns, [], [], false, today), /Food delivery, October 2026/);
  assert.match(answerCommand("month", txns, [], [], false, today), /October 2026 khata/);
  assert.match(answerCommand("what", txns, [], [], false, today), /I did not get that/);
  assert.match(answerCommand("month", [], [], [], false, today), /khata is empty/);
});

t("Meta signature check", () => {
  process.env.META_APP_SECRET = "appsecret";
  const body = '{"entry":[]}';
  const good = "sha256=" + createHmac("sha256", "appsecret").update(body).digest("hex");
  assert.equal(verifyMetaSignature(body, good), true);
  assert.equal(verifyMetaSignature(body, "sha256=" + "0".repeat(64)), false);
  assert.equal(verifyMetaSignature(body, null), false);
  assert.equal(verifyMetaSignature(body + " ", good), false);
});

t("Unsubscribe token", () => {
  process.env.CRON_SECRET = "cronsecret";
  const tok = unsubToken("11111111-1111-1111-1111-111111111111");
  assert.equal(checkUnsubToken("11111111-1111-1111-1111-111111111111", tok), true);
  assert.equal(checkUnsubToken("22222222-2222-2222-2222-222222222222", tok), false);
  assert.equal(checkUnsubToken("11111111-1111-1111-1111-111111111111", "bad"), false);
});

console.log(`\n${passed} digest tests passed`);
