"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm({ linkError }: { linkError: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(
    linkError ? "That sign-in link expired or was already used. Request a new one." : null
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(v)) {
      setError("Enter an email address like name@example.com.");
      return;
    }
    setError(null);
    setState("sending");
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithOtp({
      email: v,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (err) {
      setState("idle");
      setError("We could not send the link. Check the address and try again.");
      return;
    }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div>
        <p className="login-note">
          Link sent to <span className="mono">{email.trim()}</span>. Open it on this device to sign in.
        </p>
        <button className="how" onClick={() => setState("idle")}>
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <label className="login-label" htmlFor="email">
        Email address
      </label>
      <input
        id="email"
        className="login-input mono"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      {error && (
        <p className="login-err" role="alert">
          {error}
        </p>
      )}
      <button className="stamp-btn" type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Sending" : "Send sign-in link"}
      </button>
    </form>
  );
}
