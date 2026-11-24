-- =====================================================================
-- XTEND migration 0104 — What the AI should know
--
-- The staff helper (the AI that answers Message support) now answers from
-- the staff guide, which the app carries with it. The office adds what the
-- guide does not say (who to call, pay days, store rules, the products) on
-- Settings → AI keys, under "What the AI should know". The staff helper
-- and Ask Xtend read it with every question.
--
--   * ai_knowledge: one row (id is always true), the text (up to 20,000
--     characters), when and by whom it was last changed;
--   * row level security on with no policies and no grants, as for the AI
--     keys (0102): only the server reads or writes it. Admins change it
--     through the server, which writes the audit log.
--
-- Rerunnable.
-- =====================================================================

create table if not exists public.ai_knowledge (
  id boolean primary key default true check (id),
  body text not null default '' check (length(body) <= 20000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.ai_knowledge enable row level security;
revoke all on public.ai_knowledge from anon, authenticated;

select 'What the AI should know (0104) installed' as result;
