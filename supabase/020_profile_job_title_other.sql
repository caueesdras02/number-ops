-- 020 — Adiciona o valor de enum 'OTHER' ("Outro") a public.profile_job_title.
-- Incremental e não destrutiva. NÃO deve ter begin/commit: um novo valor de
-- enum não pode ser usado na mesma transação em que é criado (mesma regra de
-- 008_master_access_level.sql). Rode este arquivo sozinho e só depois aplique
-- 021_profile_job_title_other_trigger.sql.

alter type public.profile_job_title add value if not exists 'OTHER';
