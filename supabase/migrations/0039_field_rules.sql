-- =====================================================================
-- XTEND migration 039 — what each field accepts
--
-- The app checks every form (lib/fields.ts). Staff can also write a few
-- tables directly with their own login (their profile, their report, a
-- clock-in or visit), so the essentials are repeated here, where they
-- cannot be skipped:
--
--   * a name is a name: letters, spaces, apostrophes, hyphens, full stops
--   * a phone is a Nigerian mobile number, stored as 0803…
--   * a report says what the day, sales and stock were like
--   * nothing staff write carries a link or hidden control characters
--
-- NOT VALID: rows already there are left as they are; every new or
-- changed row is checked.
-- =====================================================================

-- Text without hidden control characters or links.
create or replace function public.text_is_clean(p_text text)
returns boolean language sql immutable as $$
  select p_text is null or (
    p_text !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
    and p_text !~* '(https?://|www\.|\m[a-z0-9-]{2,}\.(com|net|org|ng|io|co|xyz|info|biz|me|link|click|top|site|online|shop|app|ru|cn)\M)'
  );
$$;

-- Says something: at least a few letters and not one key held down.
create or replace function public.text_has_words(p_text text, p_min_length integer)
returns boolean language sql immutable as $$
  select length(btrim(coalesce(p_text, ''))) >= p_min_length
     and length(regexp_replace(coalesce(p_text, ''), '[^[:alpha:]]', '', 'g')) >= least(p_min_length, 2)
     and regexp_replace(coalesce(p_text, ''), '\s', '', 'g') !~ '(.)\1{5,}';
$$;

-- People.
alter table public.profiles drop constraint if exists profiles_full_name_is_a_name;
alter table public.profiles add constraint profiles_full_name_is_a_name check (
  length(btrim(full_name)) between 2 and 120
  and full_name ~ '^[[:alpha:]][[:alpha:][:space:].''-]*$'
  and length(regexp_replace(full_name, '[^[:alpha:]]', '', 'g')) >= 2
) not valid;

alter table public.profiles drop constraint if exists profiles_phone_is_a_mobile;
alter table public.profiles add constraint profiles_phone_is_a_mobile check (
  phone is null or phone ~ '^0[789][01][0-9]{8}$'
) not valid;

-- Daily reports: the day, sales and stock said in words; nothing linked.
alter table public.reports drop constraint if exists reports_say_something;
alter table public.reports add constraint reports_say_something check (
  public.text_has_words(body, 10)
  and public.text_has_words(sales_summary, 10)
  and public.text_has_words(stock_status, 10)
) not valid;

alter table public.reports drop constraint if exists reports_text_is_clean;
alter table public.reports add constraint reports_text_is_clean check (
  public.text_is_clean(body) and public.text_is_clean(sales_summary)
  and public.text_is_clean(stock_status) and public.text_is_clean(competitor_activity)
  and public.text_is_clean(issues)
) not valid;

-- What a phone says about where it is.
alter table public.attendance drop constraint if exists attendance_text_is_clean;
alter table public.attendance add constraint attendance_text_is_clean check (
  public.text_is_clean(address) and public.text_is_clean(place_name)
  and coalesce(length(address), 0) <= 500 and coalesce(length(place_name), 0) <= 200
) not valid;

alter table public.store_visits drop constraint if exists store_visits_text_is_clean;
alter table public.store_visits add constraint store_visits_text_is_clean check (
  public.text_is_clean(arrived_address) and public.text_is_clean(arrived_place_name)
  and public.text_is_clean(departed_address) and public.text_is_clean(departed_place_name)
) not valid;

select 'Field rules (039) installed' as result;
