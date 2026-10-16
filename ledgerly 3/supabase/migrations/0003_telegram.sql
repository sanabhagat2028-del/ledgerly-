-- Ledgerly 0003: Telegram delivery. Run in the Supabase SQL Editor after 0002.
-- Like the WhatsApp columns, users cannot write these directly (no RLS update policy);
-- changes go through API routes that check the session and plan.

alter table public.profiles add column if not exists telegram_opt_in boolean not null default false;
alter table public.profiles add column if not exists tg_chat_id bigint;
alter table public.profiles add column if not exists tg_verified boolean not null default false;
alter table public.profiles add column if not exists tg_link_code text;
alter table public.profiles add column if not exists tg_link_expires timestamptz;

-- One Telegram chat can belong to one account.
create unique index if not exists profiles_tg_chat_id_key on public.profiles (tg_chat_id) where tg_chat_id is not null;
create index if not exists profiles_tg_link_code_idx on public.profiles (tg_link_code) where tg_link_code is not null;
