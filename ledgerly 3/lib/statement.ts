/**
 * Bank statement import: CSV files and text extracted from PDF statements.
 * Pure functions, no network. Everything runs in the browser; only the structured rows are saved.
 */
import { categorise, merchantKey, parseDate, type ParsedTxn } from "./parser";
import type { Txn } from "./analysis";

export type StatementResult = {
  txns: ParsedTxn[];
  guessed: number; // rows whose debit/credit direction had to be guessed
  skipped: number; // rows that could not be read
};

const AMT_TOKEN = /(?:₹|rs\.?|inr)?\s*\(?-?\d[\d,]*\.\d{1,2}\)?\s*(?:dr|cr)?\b/gi;

function num(raw: string): number {
  const s = raw.replace(/[₹,\s]|rs\.?|inr/gi, "").replace(/dr|cr/gi, "");
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  const v = Number(s.replace(/[()-]/g, ""));
  return neg ? -v : v;
}

function fingerprint(date: string, amount: number, dir: string, narration: string, seen: Map<string, number>) {
  const base = ["stmt", date, amount.toFixed(2), dir, merchantKey(narration).slice(0, 40)].join("|");
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return `${base}#${n}`;
}

function build(
  date: string,
  amount: number,
  direction: "debit" | "credit",
  narration: string,
  seen: Map<string, number>
): ParsedTxn {
  const { merchant, category } = categorise(narration, direction);
  return {
    occurred_on: date,
    merchant,
    category,
    amount,
    direction,
    fingerprint: fingerprint(date, amount, direction, narration, seen),
  };
}

/* ---------------------------------- CSV ---------------------------------- */

export function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function detectDelimiter(lines: string[]): string {
  const sample = lines.slice(0, 15).join("\n");
  const counts = [",", ";", "\t", "|"].map((d) => [d, sample.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

type Cols = { date: number; desc: number; debit: number; credit: number; amount: number; type: number; balance: number };

function mapHeader(cells: string[]): Cols | null {
  const lower = cells.map((c) => c.toLowerCase().replace(/[^a-z/ ]/g, " ").replace(/\s+/g, " ").trim());
  const find = (...res: RegExp[]) => {
    for (const re of res) {
      const i = lower.findIndex((c) => re.test(c));
      if (i !== -1) return i;
    }
    return -1;
  };
  const cols: Cols = {
    date: find(/^(txn|transaction|tran) date/, /^date$/, /date/),
    desc: find(/narration|description|particulars|details|remarks/),
    debit: find(/withdrawal|debit|paid out|^dr$/),
    credit: find(/deposit|credit|paid in|^cr$/),
    amount: find(/^amount/, /^txn amount|^transaction amount/),
    type: find(/dr ?\/ ?cr|^type$|^cr ?\/ ?dr/),
    balance: find(/balance/),
  };
  if (cols.date === -1 || cols.desc === -1) return null;
  if (cols.debit === -1 && cols.credit === -1 && cols.amount === -1) return null;
  return cols;
}

export function parseStatementCsv(text: string): StatementResult {
  const lines = text.replace(/^﻿/, "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
  const delim = detectDelimiter(lines);
  let headerAt = -1;
  let cols: Cols | null = null;
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const m = mapHeader(splitCsvLine(lines[i], delim));
    if (m) {
      headerAt = i;
      cols = m;
      break;
    }
  }
  if (!cols) return { txns: [], guessed: 0, skipped: lines.length };

  const seen = new Map<string, number>();
  const txns: ParsedTxn[] = [];
  let skipped = 0;
  for (const line of lines.slice(headerAt + 1)) {
    const c = splitCsvLine(line, delim);
    const date = parseDate(c[cols.date] ?? "");
    if (!date) {
      skipped++;
      continue;
    }
    const narration = (c[cols.desc] ?? "").trim();
    let amount = 0;
    let dir: "debit" | "credit" | null = null;

    const d = cols.debit !== -1 ? Math.abs(num(c[cols.debit] || "0")) : 0;
    const cr = cols.credit !== -1 ? Math.abs(num(c[cols.credit] || "0")) : 0;
    if (d > 0 && cr === 0) {
      amount = d;
      dir = "debit";
    } else if (cr > 0 && d === 0) {
      amount = cr;
      dir = "credit";
    } else if (cols.amount !== -1) {
      const raw = c[cols.amount] ?? "";
      const v = num(raw || "0");
      amount = Math.abs(v);
      const t = (cols.type !== -1 ? c[cols.type] : raw).toLowerCase();
      if (/\bcr\b|credit/.test(t)) dir = "credit";
      else if (/\bdr\b|debit/.test(t)) dir = "debit";
      else dir = v < 0 ? "debit" : "credit";
    }
    if (!dir || !(amount > 0) || !Number.isFinite(amount)) {
      skipped++;
      continue;
    }
    txns.push(build(date, amount, dir, narration, seen));
  }
  return { txns, guessed: 0, skipped };
}

/* ---------------------------------- PDF ---------------------------------- */

const DATE_START = /^\s*(\d{1,2}[-/. ](?:\d{1,2}|[A-Za-z]{3})[a-z]*[-/. ,]*\d{2,4}|\d{4}-\d{2}-\d{2})/;
const NOISE = /^(page\s+\d|statement of|account (no|number)|opening balance|closing balance|total\b|date\s+(narration|particulars|description)|customer|branch|ifsc|generated)/i;

const CREDIT_WORDS = /\b(salary|credit|credited|refund|reversal|interest paid|received|by transfer|neft cr|imps cr|cashback)\b/i;

/**
 * Parse text lines pulled from a PDF statement. Each transaction starts with a date; wrapped narration
 * lines are joined to the row above. Direction comes from an explicit Dr/Cr marker, else from the
 * running balance, else from keywords (counted as "guessed").
 */
export function parseStatementLines(lines: string[]): StatementResult {
  type Row = { date: string; text: string; amounts: { v: number; dir?: "debit" | "credit" }[] };
  const rows: Row[] = [];
  let skipped = 0;

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const dm = line.match(DATE_START);
    if (dm) {
      const date = parseDate(dm[1]);
      if (!date) {
        skipped++;
        continue;
      }
      let rest = line.slice(dm[0].length);
      // A second date (value date) right after the first is not part of the narration.
      const second = rest.match(DATE_START);
      if (second && parseDate(second[1])) rest = rest.slice(second[0].length);
      const amounts: Row["amounts"] = [];
      const narr = rest.replace(AMT_TOKEN, (m) => {
        const marker = m.match(/(dr|cr)\s*$/i)?.[1].toLowerCase();
        amounts.push({ v: Math.abs(num(m)), dir: marker === "dr" ? "debit" : marker === "cr" ? "credit" : undefined });
        return " ";
      });
      rows.push({ date, text: narr.replace(/\s+/g, " ").trim(), amounts });
    } else if (rows.length && !NOISE.test(line) && !AMT_TOKEN.test(line)) {
      AMT_TOKEN.lastIndex = 0;
      // Continuation of the previous narration.
      rows[rows.length - 1].text = `${rows[rows.length - 1].text} ${line}`.trim();
    }
    AMT_TOKEN.lastIndex = 0;
  }

  const seen = new Map<string, number>();
  const txns: ParsedTxn[] = [];
  let guessed = 0;
  let prevBalance: number | null = null;

  for (const r of rows) {
    const nums = r.amounts;
    if (nums.length === 0) {
      skipped++;
      continue;
    }
    let amount: number;
    let balance: number | null = null;
    if (nums.length >= 2) {
      balance = nums[nums.length - 1].v;
      amount = nums[nums.length - 2].v;
    } else {
      amount = nums[0].v;
    }
    if (!(amount > 0)) {
      skipped++;
      if (balance !== null) prevBalance = balance;
      continue;
    }

    let dir: "debit" | "credit" | undefined = nums.length >= 2 ? nums[nums.length - 2].dir : nums[0].dir;
    if (!dir && balance !== null && prevBalance !== null) {
      const delta = Math.round((balance - prevBalance) * 100) / 100;
      if (Math.abs(Math.abs(delta) - amount) < 0.02) dir = delta > 0 ? "credit" : "debit";
    }
    if (!dir) {
      dir = CREDIT_WORDS.test(r.text) ? "credit" : "debit";
      guessed++;
    }
    if (balance !== null) prevBalance = balance;
    txns.push(build(r.date, amount, dir, r.text, seen));
  }
  return { txns, guessed, skipped };
}

/* --------------------------- avoid double counting -------------------------- */

/**
 * Drop statement rows that match an entry the user already has (same date, amount and direction),
 * for example a purchase they already added from its SMS. Matches are consumed one for one, so two
 * genuine purchases of the same amount on the same day still both count.
 */
export function dropAlreadyHave(existing: Txn[], rows: ParsedTxn[]): { fresh: ParsedTxn[]; matched: number } {
  const pool = new Map<string, number>();
  for (const t of existing) {
    const k = `${t.occurred_on}|${t.amount.toFixed(2)}|${t.direction}`;
    pool.set(k, (pool.get(k) ?? 0) + 1);
  }
  const fresh: ParsedTxn[] = [];
  let matched = 0;
  for (const r of rows) {
    const k = `${r.occurred_on}|${r.amount.toFixed(2)}|${r.direction}`;
    const left = pool.get(k) ?? 0;
    if (left > 0) {
      pool.set(k, left - 1);
      matched++;
    } else fresh.push(r);
  }
  return { fresh, matched };
}
