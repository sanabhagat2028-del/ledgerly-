/**
 * Indian bank SMS parser. Runs in the browser, so raw message text never leaves the device.
 * Only the structured result (date, merchant, category, amount, direction, fingerprint) is sent to the server.
 */

export type Direction = "debit" | "credit";

export type ParsedTxn = {
  occurred_on: string; // YYYY-MM-DD
  merchant: string;
  category: string;
  amount: number;
  direction: Direction;
  fingerprint: string;
};

export type ParseResult = {
  txns: ParsedTxn[];
  skipped: number; // messages that were not transactions (OTPs, reminders, balance alerts)
};

export const CATEGORIES = [
  "Food delivery",
  "Groceries",
  "Rent",
  "EMIs",
  "Subscriptions",
  "Travel",
  "Shopping",
  "Bills",
  "Investments",
  "Health",
  "Cash",
  "Card bill",
  "Money in",
  "Other",
] as const;

// First match wins. `name` (optional) overrides the merchant display name.
const KNOWN: { re: RegExp; category: string; name?: string }[] = [
  { re: /\b(?:credit\s*card|cc)\s*(?:bill|payment|pymt)\b|\bcard\s*bill\b/i, category: "Card bill", name: "Credit card bill" },
  { re: /\bswiggy\b/i, category: "Food delivery", name: "Swiggy" },
  { re: /\bzomato\b/i, category: "Food delivery", name: "Zomato" },
  { re: /\beatsure\b|\bdomino|\bpizza\s*hut\b|\bmcdonald|\bkfc\b|\bburger\s*king\b/i, category: "Food delivery" },
  { re: /\bblinkit\b|\bzepto\b|\bbigbasket\b|\binstamart\b|\bdmart\b|\bavenue\s*supermarts\b|\bjiomart\b|\bgrofers\b/i, category: "Groceries" },
  { re: /\bamazon\s*prime\b|\bprime\s*video\b/i, category: "Subscriptions", name: "Amazon Prime" },
  { re: /\bnetflix\b/i, category: "Subscriptions", name: "Netflix" },
  { re: /\bspotify\b/i, category: "Subscriptions", name: "Spotify" },
  { re: /\bhotstar\b|\bdisney\b/i, category: "Subscriptions", name: "Disney+ Hotstar" },
  { re: /\byoutube\b|\bgoogle\s*(?:play|one|youtube)\b/i, category: "Subscriptions", name: "YouTube / Google" },
  { re: /\bcult\.?\s*fit\b|\bcultfit\b|\bgym\b|\bfitness\b/i, category: "Subscriptions", name: "Cult.fit" },
  { re: /\bapple\.?com\/?bill\b|\bicloud\b|\bitunes\b/i, category: "Subscriptions", name: "Apple" },
  { re: /\blinkedin\b|\bopenai\b|\bchatgpt\b|\banthropic\b|\bnotion\b|\baudible\b|\bzee5\b|\bsonyliv\b|\bjiocinema\b|\bcanva\b/i, category: "Subscriptions" },
  { re: /\buber\b|\bola\b|\brapido\b|\birctc\b|\bmakemytrip\b|\bgoibibo\b|\bindigo\b|\bair\s*india\b|\bredbus\b|\bfastag\b|\bmetro\b|\bvistara\b|\bakasa\b/i, category: "Travel" },
  { re: /\bamazon\b|\bflipkart\b|\bmyntra\b|\bajio\b|\bnykaa\b|\bmeesho\b|\btata\s*cliq\b/i, category: "Shopping" },
  { re: /\bairtel\b|\bjio\b|\bvodafone\b|\bbsnl\b|\bbses\b|\bbescom\b|\btata\s*power\b|\belectricity\b|\bbroadband\b|\brecharge\b|\bwater\s*bill\b|\bpiped\s*gas\b|\bgas\s*bill\b|\bdth\b/i, category: "Bills" },
  { re: /\brent\b/i, category: "Rent", name: "Rent" },
  { re: /\bemi\b|\bloan\b|\bbajaj\s*fin|\bhdfc\s*ltd\b|\bhome\s*loan\b/i, category: "EMIs", name: "Loan EMI" },
  { re: /\bsip\b|\bmutual\s*fund\b|\bzerodha\b|\bgroww\b|\bnps\b|\bppf\b|\bindmoney\b|\bkuvera\b|\bcoin\b/i, category: "Investments" },
  { re: /\bpharmacy\b|\bapollo\b|\b1mg\b|\bpharmeasy\b|\bhospital\b|\bclinic\b|\bmedplus\b|\bdiagnostic/i, category: "Health" },
  { re: /\batm\b|\bcash\s*wdl\b|\bcash\s*withdrawal\b/i, category: "Cash", name: "ATM withdrawal" },
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const AMOUNT_RE = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;

const pad = (n: number) => String(n).padStart(2, "0");

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function validISO(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseDate(text: string): string | null {
  // 03-09-26, 03/09/2026, 03.09.26
  let m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const iso = validISO(y, Number(m[2]), Number(m[1]));
    if (iso) return iso;
  }
  // 03-Sep-26, 3 Sep 2026, 03SEP26
  m = text.match(/\b(\d{1,2})[-\s]?([A-Za-z]{3})[a-z]*[-\s,]*(\d{2}|\d{4})\b/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      const iso = validISO(y, mon, Number(m[1]));
      if (iso) return iso;
    }
  }
  return null;
}

function titleCase(s: string) {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\bUpi\b/g, "UPI");
}

function cleanMerchant(raw: string): string {
  let s = raw
    .replace(/@[a-z0-9.\-]+$/i, "") // UPI handle: name@okhdfc
    .replace(/[_*]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.:,-]+|[\s.:,-]+$/g, "")
    .trim();
  s = s.replace(/\b(pvt|private|ltd|limited|india|technologies|services)\b\.?/gi, "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s === s.toUpperCase() || s === s.toLowerCase()) s = titleCase(s);
  return s.slice(0, 40);
}

const UPI_NOISE = new Set(["P2M", "P2A", "P2P", "DR", "CR", "DEBIT", "CREDIT", "UPI", "PAY", "PAYMENT", "MOB", "IMPS", "NEFT"]);

function extractMerchant(text: string): string {
  // UPI/P2M/123456/SWIGGY, UPI-1234-NAME, UPI/RENT SEP/ANIL K
  const upi = text.match(/\bUPI[/-]([^\n]*?)(?=\s+on\s|\s+ref\b|\s+via\b|\s*$)/i);
  if (upi) {
    const parts = upi[1].split(/[/-]/).map((p) => p.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (/[A-Za-z]/.test(p) && !UPI_NOISE.has(p.toUpperCase()) && !/^\d+$/.test(p)) {
        const c = cleanMerchant(p);
        if (c) return c;
      }
    }
  }
  // "to NETFLIX.COM on", "at SWIGGY on", "towards EMI,"
  const toAt = text.match(
    /\b(?:to|at|towards|for)\s+(?:vpa\s+)?([A-Za-z0-9@._&'* -]{2,40}?)(?=\s+(?:on|ref|via|using|from|a\/c|acct|avl|bal|info|upi|txn|dated)\b|[.,;(]|\s*$)/i
  );
  if (toAt) {
    const c = cleanMerchant(toAt[1]);
    if (c && !/^(?:a\/c|acct|account|your)$/i.test(c)) return c;
  }
  // "Info: AMAZON PAY" / "Info- SWIGGY"
  const info = text.match(/\binfo[:\-\s]+([A-Za-z0-9 &'.*-]{2,40}?)(?=\s+(?:avl|bal|on)\b|[.,;]|\s*$)/i);
  if (info) {
    const c = cleanMerchant(info[1]);
    if (c) return c;
  }
  return "Unknown";
}

function detectDirection(text: string): Direction | null {
  const debit = text.search(/\b(?:debited|spent|paid|sent|purchase|withdrawn|withdrawal|payment\s+of|dr\b)/i);
  const credit = text.search(/\b(?:credited|received|deposited|refund(?:ed)?|salary)\b/i);
  if (debit === -1 && credit === -1) return null;
  if (debit === -1) return "credit";
  if (credit === -1) return "debit";
  return debit < credit ? "debit" : "credit";
}

const NOT_A_TXN = /\botp\b|one[\s-]*time\s*password|\bwill\s+be\s+debited\b|\bmandate\b.*\b(?:set|created|registered)\b|\bis\s+due\b|\bdue\s+(?:on|by|date)\b|\bminimum\s+amount\s+due\b|\bpromo|\boffer\b|\bpre-?approved\b|\bclick\s+here\b|\bavailable\s+limit\b.*\bonly\b/i;

/** Split pasted text into individual messages. */
export function splitMessages(input: string): string[] {
  const chunks = input.replace(/\r/g, "").split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);
  const out: string[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    const withAmount = lines.filter((l) => AMOUNT_RE.test(l));
    // One message per line when every line carries its own amount; otherwise the chunk is one wrapped message.
    if (lines.length > 1 && withAmount.length === lines.length) out.push(...lines);
    else out.push(lines.join(" "));
  }
  return out;
}

export function merchantKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function parseMessage(text: string): Omit<ParsedTxn, "fingerprint"> & { ref: string | null } | null {
  const msg = text.replace(/\s+/g, " ").trim();
  if (!msg || NOT_A_TXN.test(msg)) return null;
  const amt = msg.match(AMOUNT_RE);
  if (!amt) return null;
  const amount = Number(amt[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const direction = detectDirection(msg);
  if (!direction) return null;

  const occurred_on = parseDate(msg) ?? todayISO();
  let merchant = extractMerchant(msg);
  let category = "Other";

  // Category from the merchant string first, then the whole message (rent, EMI, ATM keywords live there).
  const hit = KNOWN.find((k) => k.re.test(merchant)) ?? KNOWN.find((k) => k.re.test(msg));
  if (hit) {
    category = hit.category;
    if (hit.name) merchant = hit.name;
  }
  if (direction === "credit") {
    category = "Money in";
    if (merchant === "Unknown") merchant = "Credit";
  }

  const refMatch = msg.match(/\b(?:ref(?:erence)?(?:\s*(?:no|number|id))?|utr|txn(?:\s*(?:id|no))?|rrn)\b[\s:.#-]*([A-Z0-9]{6,})/i);
  return { occurred_on, merchant, category, amount, direction, ref: refMatch ? refMatch[1].toUpperCase() : null };
}

export function parseSms(input: string): ParseResult {
  const messages = splitMessages(input);
  const seen = new Map<string, number>();
  const txns: ParsedTxn[] = [];
  let skipped = 0;
  for (const m of messages) {
    const p = parseMessage(m);
    if (!p) {
      skipped++;
      continue;
    }
    const base = [p.occurred_on, p.amount.toFixed(2), p.direction, merchantKey(p.merchant), p.ref ?? ""].join("|");
    // Identical rows inside one paste are real repeats (two coffees). Re-pasting the same batch reproduces the same numbering.
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    txns.push({
      occurred_on: p.occurred_on,
      merchant: p.merchant,
      category: p.category,
      amount: p.amount,
      direction: p.direction,
      fingerprint: `${base}#${n}`,
    });
  }
  return { txns, skipped };
}
