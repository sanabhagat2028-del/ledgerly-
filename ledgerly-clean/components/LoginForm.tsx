"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm({ linkError }: { linkError: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
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

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    const token = code.replace(/\D/g, "");
    if (token.length < 6) {
      setError("Enter the code from the email.");
      return;
    }
    setError(null);
    setVerifying(true);
    const supabase = createClient();
    const { error: err } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: "email" });
    if (err) {
      setVerifying(false);
      setError("That code did not work. Check it, or send a new one.");
      return;
    }
    window.location.assign("/khata");
  }

  if (state === "sent") {
    return (
      <div>
        <p className="login-note">
          We emailed <span className="mono">{email.trim()}</span>. Type the code from the email below, or open the link
          in the email on this device.
        </p>
        <form onSubmit={verify} noValidate>
          <label className="login-label" htmlFor="code">
            Code from the email
          </label>
          <input
            id="code"
            className="login-input mono"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={10}
          />
          {error && (
            <p className="login-err" role="alert">
              {error}
            </p>
          )}
          <button className="stamp-btn" type="submit" disabled={verifying}>
            {verifying ? "Checking" : "Sign in"}
          </button>
        </form>
        <button
          className="how"
          onClick={() => {
            setState("idle");
            setCode("");
            setError(null);
          }}
        >
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
