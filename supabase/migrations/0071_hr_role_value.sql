-- =====================================================================
-- XTEND migration 0071 — the HR role's name
--
-- A new value can only be used once the statement that adds it has
-- committed, so it is added here on its own and used from 0072 on. Run
-- this file, then 0072.
-- =====================================================================

alter type user_role add value if not exists 'hr';

select 'HR role value (0071) installed' as result;
