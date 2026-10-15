# Ledgerly

Paste bank SMS or upload a statement, get a monthly khata of where your money went, the subscriptions worth cancelling, bill reminders and a savings plan.

Stack: Next.js 15 (App Router) on Vercel, Supabase (auth + Postgres), Dodo Payments (Premium), Resend (email), Meta WhatsApp Cloud API (WhatsApp).

## What is in it

| Feature | Free | Premium (₹149 a month) |
|---|---|---|
| Sign in with an email link | yes | yes |
| Paste bank SMS (parsed in the browser) | yes | yes |
| Upload a PDF or CSV statement (read in the browser, with preview) | yes | yes |
| Monthly category view, one-line summary, "Cancel these" list | yes | yes |
| Monthly khata (1st) and weekly digest (Sunday) by email | yes | yes |
| Delete my data | yes | yes |
| Savings goals | | yes |
| Bill and EMI reminders (by email and WhatsApp) | | yes |
| Personalised savings plan | | yes |
| WhatsApp delivery and reply commands | | yes |

Premium is enforced on the server. Goals, bills and notification settings are written only by API routes that check the plan, and users cannot write them directly from the browser.

## Setup, in order

### 1. Supabase

1. Create a project.
2. SQL Editor: run `supabase/migrations/0001_init.sql`, then `supabase/migrations/0002_features.sql`. **Run 0002 before deploying this version.**
3. Authentication, URL Configuration: set Site URL to your site, and add `https://YOUR-DOMAIN/auth/callback` under Redirect URLs.
4. Project Settings, API: copy the project URL, anon (publishable) key and service role (secret) key.
5. Authentication, SMTP Settings: add a custom SMTP provider before real users arrive. Supabase's built-in sender allows only a few emails an hour. Resend works (Resend dashboard, SMTP).

### 2. Vercel

Add these under Settings, Environment Variables, then redeploy:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | service role / secret key (never commit it) |
| `NEXT_PUBLIC_SITE_URL` | `https://your-domain`, no trailing slash |

Then the optional groups below. Each feature switches on when its keys exist and stays off without them.

### 3. Dodo Payments (Premium)

1. In test mode, create a subscription product, Premium, ₹149 a month. Confirm INR is available on your account.
2. Developer, API Keys: create a key. Developer, Webhooks: add `https://YOUR-DOMAIN/api/webhooks/dodo`, subscribe to `subscription.*`, and copy the signing secret.
3. Vercel variables: `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_WEBHOOK_KEY`, `DODO_PAYMENTS_ENVIRONMENT` (`test_mode` or `live_mode`), `DODO_PREMIUM_PRODUCT_ID`.
4. Test with Dodo's test card, then switch to live keys once Dodo has verified your business.

### 4. Email digest and reminders (Resend)

1. Create an account at resend.com, add and verify your domain, create an API key.
2. Vercel variables: `RESEND_API_KEY`, `EMAIL_FROM` (for example `Ledgerly <hello@yourdomain.com>`), and `CRON_SECRET` (any long random string).
3. `vercel.json` already schedules `/api/cron/daily` at 08:00 India time. It sends reminders on each bill's reminder day, the weekly digest on Sundays and the monthly khata on the 1st. A log table stops anything being sent twice. Every email has an unsubscribe link.
4. To test without waiting: `curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://YOUR-DOMAIN/api/cron/daily`. It only sends what is due today.

### 5. WhatsApp (Meta Cloud API)

This is the longest setup. The code is done, but it needs a Meta app, and Meta approves things on its own timeline.

1. developers.facebook.com: create a Business app and add the WhatsApp product. You get a free test number that can message up to 5 verified phone numbers. A real number and business verification are needed for the public.
2. From the WhatsApp setup page copy the **Phone number ID**, create a permanent access token (a System User token), and note the **App Secret** (App settings, Basic).
3. Webhooks: callback URL `https://YOUR-DOMAIN/api/webhooks/whatsapp`, verify token = the string you put in `WHATSAPP_VERIFY_TOKEN`, subscribe to the `messages` field.
4. Message templates: create a Utility template with exactly one body variable and fixed text before and after it (Meta rejects a body that starts or ends with a variable), for example `Your Ledgerly update: {{1}} Reply help for options.` Name it `ledgerly_update` (or set `WHATSAPP_TEMPLATE_NAME`). Messages Ledgerly starts must use an approved template. Replies to a user's own message are free text.
5. Vercel variables: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_NUMBER` (digits, with country code), `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG`.

How linking works: in Ledgerly settings a Premium user taps Link WhatsApp, gets a 6-digit code, and sends `LEDGERLY 123456` to your business number from their phone. The sender's number is then saved. Nobody can attach a number they do not hold. Users can reply `help`, `month`, `bills`, a category such as `food`, or `stop`.

### 6. Run locally

```bash
cp .env.example .env.local   # fill in the values
npm install
npm run dev                  # http://localhost:3000
npm test                     # parser, statement, plan and digest tests (31 tests)
```

## How it fits together

- `lib/parser.ts`: SMS parsing and categories. Add merchants to the `KNOWN` table.
- `lib/statement.ts`, `lib/pdf-text.ts`: CSV and PDF statement import. Direction comes from Dr/Cr markers or the running balance, else keywords (flagged as guessed in the preview). Rows already in the khata are skipped.
- `lib/analysis.ts`: month totals, one-line summary, recurring charges.
- `lib/upcoming.ts`, `lib/plan.ts`: due dates and the rule-based savings plan. No model involved; it uses the user's last three complete months.
- `lib/digest.ts`, `lib/notify.ts`: message text, Resend, WhatsApp.
- `app/api/*`: all server routes. `public/pdf.worker.min.mjs` is the pdf.js worker (pinned version).

## Known limits

- Bank statement layouts vary. The PDF reader is tested on a generated statement and the CSV reader on common column layouts, not on every Indian bank. Scanned (image) PDFs and password-protected PDFs are not supported; the app says so and points to the CSV download.
- The daily job handles users one after another within Vercel's 60 second limit, which is fine for a few hundred users. Past that it needs batching.
- Vercel's free plan runs a cron job once a day, at some point within the scheduled hour.
- A web app cannot read SMS by itself; users paste them. Automatic reading needs a native mobile app.
- Premium customers cancel from the Dodo receipt email. There is no manage-subscription screen yet.
- The red stamps on "Cancel these" are not saved between visits.
