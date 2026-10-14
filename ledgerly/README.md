# Ledgerly

Paste bank SMS, get a monthly khata of where your money went, the subscriptions worth cancelling, and what you could save.

Stack: Next.js 15 (App Router) on Vercel, Supabase (auth + Postgres), Dodo Payments (Premium subscription).

## How it works

- **Sign in:** passwordless email link (Supabase Auth). The same link creates the account.
- **Add messages:** the user pastes bank SMS into `/khata`. `lib/parser.ts` reads them **in the browser**, so the raw text never leaves the device. Only date, merchant, category, amount and direction are saved.
- **Analysis:** `lib/analysis.ts` builds the monthly category totals, the one-line summary, and recurring charges (billed about monthly, or a subscription seen in 2+ months). Subscriptions go on the "Cancel these" list with a savings total. Rent and EMIs show as regular charges, not cancellable.
- **Premium:** savings goals. Checked on the server in `app/api/goals/route.ts`, not only in the UI.
- **Payments:** `POST /api/checkout` creates a Dodo checkout session. `POST /api/webhooks/dodo` verifies the signature and flips `profiles.plan` using the service-role key. Users cannot write `plan` themselves (no RLS update policy).
- **Delete my data:** `DELETE /api/data` removes every entry and goal for the user.

## Setup

### 1. Supabase

1. Create a project at supabase.com.
2. SQL Editor, new query, paste `supabase/migrations/0001_init.sql`, run.
3. Authentication, URL Configuration:
   - Site URL: your production URL.
   - Redirect URLs: `http://localhost:3000/auth/callback` and `https://YOUR-DOMAIN/auth/callback`.
4. Project Settings, API: copy the project URL, the anon key and the service role key.
5. **Before launch:** Supabase's built-in email sender is limited to a few emails an hour. Add a custom SMTP provider (Authentication, SMTP Settings) or sign-in links will stop arriving once you have real users.

### 2. Dodo Payments

1. In the Dodo dashboard (start in **test mode**), create a **subscription** product named Premium at ₹149 a month. Confirm INR is available for your account. Copy its product id (`pdt_...`).
2. Developer, API Keys: create a key.
3. Developer, Webhooks, Add endpoint: `https://YOUR-DOMAIN/api/webhooks/dodo`, subscribe to the `subscription.*` events. Copy the signing secret (`whsec_...`).
4. Test the whole flow with Dodo's test cards before switching `DODO_PAYMENTS_ENVIRONMENT` to `live_mode` and swapping in live keys.

### 3. Run locally

```bash
cp .env.example .env.local   # fill in the values
npm install
npm run dev                  # http://localhost:3000
npm test                     # parser and analysis tests
```

To receive Dodo webhooks locally, use the Dodo CLI (`dodo wh listen`) or deploy to a Vercel preview URL.

### 4. Deploy to Vercel

1. Push this folder to a GitHub repo.
2. Vercel, Add New Project, import the repo (framework: Next.js, nothing to change).
3. Add every variable from `.env.example` under Settings, Environment Variables. Set `NEXT_PUBLIC_SITE_URL` to the final URL.
4. Deploy. Add the Vercel URL to Supabase redirect URLs and to the Dodo webhook endpoint.

Never commit `.env.local`. The service-role key and Dodo keys are server-only.

## What is not built yet

- WhatsApp delivery and the weekly digest (the landing page says "coming soon").
- Bill and EMI reminders, personalised savings plan (listed on Premium as "coming soon").
- Statement PDF upload. SMS paste only.
- A "manage or cancel subscription" screen. Premium customers cancel from the Dodo receipt email for now.
- Reading SMS automatically. A web app cannot; that needs a native mobile app.
- The stamped state on "Cancel these" is not saved between visits.

## Parser notes

`lib/parser.ts` is regex-based and tuned for common Indian bank formats (UPI, card, EMI, ATM, credits). Bank formats vary, so expect some merchants to land in "Other" or "Unknown". Users can fix a category from the Entries list. Add new merchants to the `KNOWN` table at the top of the file and a case to `scripts/test-parser.ts`.
