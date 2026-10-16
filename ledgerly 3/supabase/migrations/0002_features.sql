-- Ledgerly 0002: reminders, notifications, WhatsApp linking. Run in the Supabase SQL Editor after 0001.

-- Notification settings and WhatsApp link state live on profiles. Users cannot write these directly;
-- the API routes check the session and write with the service role.
alter table public.profiles add column if not exists email_digest boolean not null default true;
alter table public.profiles add column if not exists whatsapp_opt_in boolean not null default false;
alter table public.profiles add column if not exists wa_phone text;
alter table public.profiles add column if not exists wa_verified boolean not null default false;
alter table public.profiles add column if not exists wa_link_code text;
alter table public.profiles add column if not exists wa_link_expires timestamptz;

-- One WhatsApp number can belong to one account.
create unique index if not exists profiles_wa_phone_key on public.profiles (wa_phone) where wa_phone is not null;

-- Bills and EMIs the user wants reminders for (Premium).
create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  amount numeric(12, 2) not null check (amount > 0),
  due_day int not null check (due_day between 1 and 31),
  kind text not null default 'bill' check (kind in ('bill', 'emi', 'card')),
  remind_days_before int not null default 3 check (remind_days_before between 0 and 14),
  created_at timestamptz not null default now()
);
create index if not exists bills_user_idx on public.bills (user_id);

alter table public.bills enable row level security;
drop policy if exists "bills: select own" on public.bills;
create policy "bills: select own" on public.bills for select using (auth.uid() = user_id);
-- No insert/update/delete policies: writes go through /api/bills, which checks Premium.

-- Goals: Premium is enforced in /api/goals, so remove direct client writes (a free user could
-- otherwise insert goals straight from the browser with the anon key).
drop policy if exists "goals: insert own" on public.goals;
drop policy if exists "goals: update own" on public.goals;
drop policy if exists "goals: delete own" on public.goals;

-- Sent-notification log: stops the daily job from sending the same message twice.
create table if not exists public.notification_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  channel text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key, channel)
);
alter table public.notification_log enable row level security;
-- No policies: service role only.
