import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStatementCsv, parseStatementLines, dropAlreadyHave } from "../lib/statement";
import { pdfToLines } from "../lib/pdf-text";

let passed = 0;
const t = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  passed++;
  console.log("ok  ", name);
};

(async () => {
  await t("CSV with debit and credit columns", () => {
    const csv = [
      "Account Statement",
      "Date,Narration,Chq/Ref No,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
      '03/09/26,"UPI-NETFLIX.COM-4839201",0000123,03/09/26,649.00,,101351.00',
      "05/09/26,UPI-SWIGGY-5521,0000124,05/09/26,412.00,,100939.00",
      "01/09/26,NEFT CR-ACME PAYROLL-SALARY,0000100,01/09/26,,52000.00,102000.00",
      "not a row,,,,,,",
    ].join("\n");
    const r = parseStatementCsv(csv);
    assert.equal(r.txns.length, 3);
    assert.equal(r.txns[0].amount, 649);
    assert.equal(r.txns[0].category, "Subscriptions");
    assert.equal(r.txns[0].direction, "debit");
    assert.equal(r.txns[2].direction, "credit");
    assert.equal(r.txns[2].category, "Money in");
    assert.equal(r.skipped, 1);
  });

  await t("CSV with single amount column and Dr/Cr", () => {
    const csv = ["Txn Date;Description;Amount;Dr/Cr", "2026-09-07;UPI/RENT SEP/ANIL K;18,500.00;DR", "2026-09-01;SALARY ACME;52,000.00;CR"].join("\n");
    const r = parseStatementCsv(csv);
    assert.equal(r.txns.length, 2);
    assert.equal(r.txns[0].category, "Rent");
    assert.equal(r.txns[0].occurred_on, "2026-09-07");
    assert.equal(r.txns[1].direction, "credit");
  });

  await t("CSV without a recognisable header yields nothing", () => {
    assert.equal(parseStatementCsv("a,b,c\n1,2,3").txns.length, 0);
  });

  await t("Text lines: direction from running balance", () => {
    const r = parseStatementLines([
      "Statement of Account",
      "01/09/2026 01/09/2026 NEFT CR-ACME PAYROLL-SALARY 52,000.00 1,02,000.00",
      "03/09/2026 03/09/2026 UPI/P2M/524839201/NETFLIX 649.00 1,01,351.00",
      "07/09/2026 07/09/2026 UPI/RENT SEP/ANIL K 18,500.00 82,851.00",
    ]);
    assert.equal(r.txns.length, 3);
    assert.equal(r.txns[1].direction, "debit");
    assert.equal(r.txns[1].merchant, "Netflix");
    assert.equal(r.txns[2].category, "Rent");
    assert.equal(r.guessed, 1); // the first row has no previous balance to compare with
    assert.equal(r.txns[0].direction, "credit"); // keyword fallback: salary
  });

  await t("Wrapped narration is joined to the row above", () => {
    const r = parseStatementLines([
      "12/09/2026 12/09/2026 UPI/P2M/524840112/CULT.FIT 1,499.00 73,700.00",
      "MEMBERSHIP RENEWAL",
    ]);
    assert.equal(r.txns.length, 1);
    assert.equal(r.txns[0].category, "Subscriptions");
  });

  await t("Explicit Dr/Cr markers win", () => {
    const r = parseStatementLines(["05-Sep-2026 SWIGGY ORDER 412.00 Dr 99,000.00 Cr"]);
    assert.equal(r.txns[0].direction, "debit");
    assert.equal(r.guessed, 0);
  });

  await t("Real PDF end to end (generated with reportlab, read with pdf.js)", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const buf = readFileSync(process.argv[2] ?? new URL("./fixtures/statement.pdf", import.meta.url));
    const lines = await pdfToLines(new Uint8Array(buf), pdfjs as never);
    const r = parseStatementLines(lines);
    assert.equal(r.txns.length, 6, `lines were:\n${lines.join("\n")}`);
    const by = Object.fromEntries(r.txns.map((x) => [x.merchant, x]));
    assert.equal(by["Netflix"].amount, 649);
    assert.equal(by["Swiggy"].direction, "debit");
    assert.equal(by["Rent"].amount, 18500);
    assert.equal(by["Loan EMI"].category, "EMIs");
    assert.equal(r.txns.filter((x) => x.direction === "credit").length, 1);
    assert.equal(r.txns.filter((x) => x.direction === "debit").length, 5);
  });

  await t("Already-have matching is one for one", () => {
    const rows = parseStatementCsv(
      ["Date,Narration,Debit,Credit", "03/09/26,NETFLIX,649.00,", "03/09/26,COFFEE,120.00,", "03/09/26,COFFEE,120.00,"].join("\n")
    ).txns;
    const existing = [
      { id: "1", occurred_on: "2026-09-03", merchant: "Netflix", category: "Subscriptions", amount: 649, direction: "debit" as const },
      { id: "2", occurred_on: "2026-09-03", merchant: "Cafe", category: "Other", amount: 120, direction: "debit" as const },
    ];
    const { fresh, matched } = dropAlreadyHave(existing, rows);
    assert.equal(matched, 2);
    assert.equal(fresh.length, 1);
  });

  console.log(`\n${passed} statement tests passed`);
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
