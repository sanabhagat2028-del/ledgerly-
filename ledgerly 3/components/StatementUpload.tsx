"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { dropAlreadyHave, parseStatementCsv, parseStatementLines, type StatementResult } from "@/lib/statement";
import { PdfPasswordError, pdfToLines } from "@/lib/pdf-text";
import { inr, shortDate, type Txn } from "@/lib/analysis";
import type { ParsedTxn } from "@/lib/parser";

const MAX_BYTES = 8 * 1024 * 1024;
const CHUNK = 400;

type Preview = {
  fileName: string;
  fresh: ParsedTxn[];
  matched: number;
  guessed: number;
  skipped: number;
};

export default function StatementUpload({ existing }: { existing: Txn[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function onFile(file: File | undefined) {
    setMsg(null);
    setPreview(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setMsg({ kind: "err", text: "That file is over 8 MB. Download a shorter date range and try again." });
      return;
    }
    setBusy(true);
    try {
      let result: StatementResult;
      const name = file.name.toLowerCase();
      if (name.endsWith(".pdf") || file.type === "application/pdf") {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const lines = await pdfToLines(new Uint8Array(await file.arrayBuffer()), pdfjs as never);
        result = parseStatementLines(lines);
      } else if (name.endsWith(".csv") || name.endsWith(".txt") || file.type.startsWith("text/")) {
        result = parseStatementCsv(await file.text());
      } else {
        setMsg({ kind: "err", text: "Upload a PDF or CSV statement. For Excel files, save as CSV first." });
        return;
      }
      if (result.txns.length === 0) {
        setMsg({
          kind: "err",
          text: "No transactions found. If this is a scanned image, or a PDF from a bank we do not read yet, download the CSV version from your bank instead.",
        });
        return;
      }
      const { fresh, matched } = dropAlreadyHave(existing, result.txns);
      setPreview({ fileName: file.name, fresh, matched, guessed: result.guessed, skipped: result.skipped });
    } catch (e) {
      if (e instanceof PdfPasswordError) {
        setMsg({
          kind: "err",
          text: "This PDF is password protected. Download the CSV version, or an unprotected PDF, from your bank.",
        });
      } else {
        setMsg({ kind: "err", text: "Could not read that file. Try the CSV version from your bank." });
      }
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    let added = 0;
    let dupes = 0;
    for (let i = 0; i < preview.fresh.length; i += CHUNK) {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactions: preview.fresh.slice(i, i + CHUNK) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBusy(false);
        setMsg({ kind: "err", text: json.error ?? "Could not save. Try again." });
        if (added > 0) router.refresh();
        return;
      }
      added += json.added ?? 0;
      dupes += json.duplicates ?? 0;
    }
    setBusy(false);
    setPreview(null);
    setMsg({
      kind: "ok",
      text: `Added ${added} ${added === 1 ? "entry" : "entries"} from your statement${dupes ? `, ${dupes} were already there` : ""}.`,
    });
    router.refresh();
  }

  const totals = preview
    ? preview.fresh.reduce(
        (a, t) => {
          if (t.direction === "debit") a.out += t.amount;
          else a.in += t.amount;
          return a;
        },
        { out: 0, in: 0 }
      )
    : null;

  return (
    <div className="stmt">
      <h3 className="stmt-h">Or upload a statement</h3>
      <p className="lede stmt-lede">
        Add a PDF or CSV statement from your bank. It is read in this browser and the file itself is never uploaded.
        Password-protected PDFs are not supported. Download the CSV instead.
      </p>
      <input
        ref={input}
        id="stmt-file"
        className="stmt-file"
        type="file"
        accept=".pdf,.csv,.txt,application/pdf,text/csv"
        onChange={(e) => onFile(e.target.files?.[0])}
        disabled={busy}
      />
      <label htmlFor="stmt-file" className="stamp-sm stmt-btn">
        {busy && !preview ? "Reading" : "Choose statement"}
      </label>

      {msg && (
        <p className={msg.kind === "err" ? "login-err" : "login-note"} role="status" style={{ marginTop: "1rem" }}>
          {msg.text}
        </p>
      )}

      {preview && totals && (
        <div className="stmt-preview" role="region" aria-label="Statement preview">
          <p>
            <b>{preview.fileName}</b>: {preview.fresh.length} new {preview.fresh.length === 1 ? "entry" : "entries"}
            {preview.matched > 0 && `, ${preview.matched} already in your khata`}.
          </p>
          <p className="mono stmt-sum">
            Out {inr(totals.out)} &nbsp; In {inr(totals.in)}
          </p>
          {preview.guessed > 0 && (
            <p className="login-err">
              {preview.guessed} {preview.guessed === 1 ? "row" : "rows"} had no balance or Dr/Cr marker, so we guessed
              whether money went in or out. Check the list below.
            </p>
          )}
          <ul className="entries">
            {preview.fresh.slice(0, 8).map((t) => (
              <li key={t.fingerprint} className="erow stmt-row">
                <span className="mono d">{shortDate(t.occurred_on)}</span>
                <span className="em">{t.merchant}</span>
                <span className="cap">{t.category}</span>
                <span className={"mono ea" + (t.direction === "credit" ? " in" : "")}>
                  {t.direction === "credit" ? "+" : ""}
                  {inr(t.amount)}
                </span>
              </li>
            ))}
          </ul>
          {preview.fresh.length > 8 && <p className="cap">and {preview.fresh.length - 8} more</p>}
          <div className="row-actions" style={{ marginTop: "1rem" }}>
            {preview.fresh.length > 0 ? (
              <button className="stamp-btn" onClick={confirm} disabled={busy}>
                {busy ? "Adding" : `Add ${preview.fresh.length} to khata`}
              </button>
            ) : (
              <p className="login-note">Everything in this statement is already in your khata.</p>
            )}
            <button className="how" onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
