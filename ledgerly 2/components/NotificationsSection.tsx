"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type NotifySettings = {
  emailDigest: boolean;
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
  const [waOpt, setWaOpt] = useState(settings.whatsappOptIn);
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

  async function toggleWa(v: boolean) {
    setErr(null);
    setWaOpt(v);
    const r = await post({ action: "whatsapp_opt", value: v });
    if (!r.ok) {
      setWaOpt(!v);
      setErr(r.json.error ?? "Could not save.");
    }
  }

  async function startLink() {
    setErr(null);
    setBusy(true);
    const r = await post({ action: "whatsapp_link" });
    setBusy(false);
    if (!r.ok) {
      setErr(r.json.error ?? "Could not start linking.");
      return;
    }
    setLink({ code: r.json.code, link: r.json.link });
  }

  async function unlink() {
    setErr(null);
    const r = await post({ action: "whatsapp_unlink" });
    if (!r.ok) {
      setErr(r.json.error ?? "Could not unlink.");
      return;
    }
    setLink(null);
    setWaOpt(false);
    router.refresh();
  }

  return (
    <section className="sec dash">
      <h2>Messages from Ledgerly.</h2>

      <label className="check">
        <input type="checkbox" checked={email} onChange={(e) => toggleEmail(e.target.checked)} />
        <span>
          <b>Email</b>
          <span className="cap"> A monthly khata on the 1st and a one-line digest every Sunday.</span>
        </span>
      </label>

      <div className="wa-box">
        <p>
          <b>WhatsApp</b> <span className="cap">The same messages, plus bill reminders. Ask it for a category any time.</span>
        </p>

        {!premium ? (
          <>
            <p className="cap">WhatsApp delivery is part of Premium.</p>
            <button className="stamp-sm" onClick={onUpgrade} disabled={upgrading}>
              {upgrading ? "Opening checkout" : "Upgrade to Premium"}
            </button>
          </>
        ) : !settings.waAvailable ? (
          <p className="cap">WhatsApp is not switched on for this app yet.</p>
        ) : settings.waVerified ? (
          <>
            <p className="mono" style={{ fontSize: ".9rem" }}>Linked to {settings.waPhoneMasked}</p>
            <label className="check">
              <input type="checkbox" checked={waOpt} onChange={(e) => toggleWa(e.target.checked)} />
              <span>Send me messages on WhatsApp</span>
            </label>
            <button className="how" onClick={unlink}>Unlink this number</button>
          </>
        ) : link ? (
          <>
            <p>
              Open WhatsApp and send this message from the number you want to link. The code works for 30 minutes.
            </p>
            <p className="mono code">LEDGERLY {link.code}</p>
            <div className="row-actions">
              <a className="stamp-sm" href={link.link} target="_blank" rel="noopener noreferrer">Open WhatsApp</a>
              <button className="how" onClick={() => router.refresh()}>I sent it</button>
            </div>
          </>
        ) : (
          <>
            <p className="cap">
              You link your number by sending us a message, so nobody can sign up with a number that is not theirs.
            </p>
            <button className="stamp-sm" onClick={startLink} disabled={busy}>
              {busy ? "Working" : "Link WhatsApp"}
            </button>
          </>
        )}
      </div>

      {err && <p className="login-err" role="alert">{err}</p>}
    </section>
  );
}
