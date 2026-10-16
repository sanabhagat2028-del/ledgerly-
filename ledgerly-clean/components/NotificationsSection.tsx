"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type NotifySettings = {
  emailDigest: boolean;
  telegramOptIn: boolean;
  tgVerified: boolean;
  tgAvailable: boolean;
  whatsappOptIn: boolean;
  waVerified: boolean;
  waPhoneMasked: string | null;
  waAvailable: boolean;
};

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

export default function NotificationsSection({
  premium,
  settings,
  onUpgrade,
  upgrading,
}: {
  premium: boolean;
  settings: NotifySettings;
  onUpgrade: () => void;
  upgrading: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(settings.emailDigest);
  const [tgOpt, setTgOpt] = useState(settings.telegramOptIn);
  const [link, setLink] = useState<{ code: string; link: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggleEmail(v: boolean) {
    setErr(null);
    setEmail(v);
    const r = await post({ action: "email", value: v });
    if (!r.ok) {
      setEmail(!v);
      setErr(r.json.error ?? "Could not save.");
    }
  }

  async function toggleTg(v: boolean) {
    setErr(null);
    setTgOpt(v);
    const r = await post({ action: "telegram_opt", value: v });
    if (!r.ok) {
      setTgOpt(!v);
      setErr(r.json.error ?? "Could not save.");
    }
  }

  async function startLink() {
    setErr(null);
    setBusy(true);
    const r = await post({ action: "telegram_link" });
    setBusy(false);
    if (!r.ok) {
      setErr(r.json.error ?? "Could not start linking.");
      return;
    }
    setLink({ code: r.json.code, link: r.json.link });
  }

  async function unlink() {
    setErr(null);
    const r = await post({ action: "telegram_unlink" });
    if (!r.ok) {
      setErr(r.json.error ?? "Could not unlink.");
      return;
    }
    setLink(null);
    setTgOpt(false);
    router.refresh();
  }

  return (
    <section className="sec dash">
      <h2>Messages from Ledgerly.</h2>

      <label className="check">
        <input type="checkbox" checked={email} onChange={(e) => toggleEmail(e.target.checked)} />
        <span>
          <b>Email</b>
          <span className="cap"> A monthly khata on the 1st, a one-line digest every Sunday, and bill reminders for Premium.</span>
        </span>
      </label>

      {settings.tgAvailable && (
      <div className="wa-box">
        <p>
          <b>Telegram</b> <span className="cap">The same messages, plus bill reminders. Ask it for a category any time.</span>
        </p>

        {!premium ? (
          <>
            <p className="cap">Telegram delivery is part of Premium.</p>
            <button className="stamp-sm" onClick={onUpgrade} disabled={upgrading}>
              {upgrading ? "Opening checkout" : "Upgrade to Premium"}
            </button>
          </>
        ) : !settings.tgAvailable ? (
          <p className="cap">Telegram is not switched on for this app yet.</p>
        ) : settings.tgVerified ? (
          <>
            <p className="mono" style={{ fontSize: ".9rem" }}>Linked to your Telegram chat</p>
            <label className="check">
              <input type="checkbox" checked={tgOpt} onChange={(e) => toggleTg(e.target.checked)} />
              <span>Send me messages on Telegram</span>
            </label>
            <button className="how" onClick={unlink}>Unlink this chat</button>
          </>
        ) : link ? (
          <>
            <p>Tap the button, then press Start in Telegram. The code works for 30 minutes.</p>
            <p className="mono code">{link.code}</p>
            <div className="row-actions">
              <a className="stamp-sm" href={link.link} target="_blank" rel="noopener noreferrer">Open Telegram</a>
              <button className="how" onClick={() => router.refresh()}>I pressed Start</button>
            </div>
            <p className="cap">If the button does not open Telegram, find the Ledgerly bot and send it the six digits above.</p>
          </>
        ) : (
          <>
            <p className="cap">
              You link your chat by starting our bot with a one-time code, so nobody can link a chat that is not theirs.
            </p>
            <button className="stamp-sm" onClick={startLink} disabled={busy}>
              {busy ? "Working" : "Link Telegram"}
            </button>
          </>
        )}
      </div>
      )}

      {err && <p className="login-err" role="alert">{err}</p>}
    </section>
  );
}
