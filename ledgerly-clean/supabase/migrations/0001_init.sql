-- Ledgerly schema. Run in Supabase: SQL Editor > New query > paste > Run.

-- Profiles: one row per user. Only the server (service role) can change `plan`.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  plan text not null default 'free' check (plan in ('free', 'premium')),
  dodo_customer_id text,
  dodo_subscription_id text,
  plan_updated_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);
-- No insert/update/delete policies on purpose: users cannot grant themselves Premium.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Transactions: parsed in the browser. Raw SMS text is never stored.
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  occurred_on date not null,
  merchant text not null,
  category text not null,
  amount numeric(12, 2) not null check (amount > 0),
  direction text not null check (direction in ('debit', 'credit')),
  fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (user_id, fingerprint)
);

create index if not exists transactions_user_date_idx
  on public.transactions (user_id, occurred_on desc);

alter table public.transactions enable row level security;

drop policy if exists "transactions: select own" on public.transactions;
drop policy if exists "transactions: insert own" on public.transactions;
drop policy if exists "transactions: update own" on public.transactions;
drop policy if exists "transactions: delete own" on public.transactions;
create policy "transactions: select own" on public.transactions for select using (auth.uid() = user_id);
create policy "transactions: insert own" on public.transactions for insert with check (auth.uid() = user_id);
create policy "transactions: update own" on public.transactions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "transactions: delete own" on public.transactions for delete using (auth.uid() = user_id);

-- Savings goals (Premium feature, enforced in the API route).
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  target_amount numeric(12, 2) not null check (target_amount > 0),
  saved_amount numeric(12, 2) not null default 0 check (saved_amount >= 0),
  created_at timestamptz not null default now()
);

alter table public.goals enable row level security;

drop policy if exists "goals: select own" on public.goals;
drop policy if exists "goals: insert own" on public.goals;
drop policy if exists "goals: update own" on public.goals;
drop policy if exists "goals: delete own" on public.goals;
create policy "goals: select own" on public.goals for select using (auth.uid() = user_id);
create policy "goals: insert own" on public.goals for insert with check (auth.uid() = user_id);
create policy "goals: update own" on public.goals for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "goals: delete own" on public.goals for delete using (auth.uid() = user_id);

-- Webhook idempotency: Dodo retries, so remember which webhook ids we already handled.
create table if not exists public.webhook_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
alter table public.webhook_events enable row level security;
-- No policies: only the service role touches this table.
