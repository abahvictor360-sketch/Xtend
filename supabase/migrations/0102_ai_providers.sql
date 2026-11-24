-- =====================================================================
-- XTEND migration 0102 — AI keys the admin adds (OpenAI, Gemini,
-- Anthropic, NVIDIA, OpenRouter)
--
-- The AI that answers staff (the support helper, which also explains why
-- something is not working) and the admins' Ask Xtend used one key set on
-- the server. Now an admin adds keys on Settings → AI, for any of five
-- providers, and picks which provider and model each of the two uses.
--
--   * ai_provider_keys: one key per provider, stored ENCRYPTED by the server
--     (AES-256-GCM, lib/ai/secret-box.ts) with only its last 4 characters
--     shown back (key_hint). The key itself never reaches a browser;
--   * ai_feature_settings: 'staff_helper' and 'admin_assistant' → provider
--     and model;
--   * both: row level security on with no policies and no grants, so only
--     the server (service role) reads or writes them. Admins change them
--     through the server, which checks the password and writes the audit log.
--
-- Rerunnable.
-- =====================================================================

create table if not exists public.ai_provider_keys (
  provider text primary key
    check (provider in ('anthropic', 'openai', 'gemini', 'nvidia', 'openrouter')),
  key_cipher text not null check (length(key_cipher) between 20 and 4000),
  key_hint text not null check (length(key_hint) <= 8),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.ai_feature_settings (
  feature text primary key check (feature in ('staff_helper', 'admin_assistant')),
  provider text not null
    check (provider in ('anthropic', 'openai', 'gemini', 'nvidia', 'openrouter')),
  model text not null check (length(btrim(model)) between 1 and 120),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.ai_provider_keys enable row level security;
alter table public.ai_feature_settings enable row level security;
revoke all on public.ai_provider_keys, public.ai_feature_settings from anon, authenticated;

select 'AI keys the admin adds (0102) installed' as result;
