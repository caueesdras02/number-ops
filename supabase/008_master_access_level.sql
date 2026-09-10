-- 008 — Adiciona o nível de acesso MASTER (acima de ADMIN).
-- Incremental e não destrutivo. NÃO deve ter begin/commit: um novo valor de enum
-- não pode ser usado na mesma transação em que é criado. Rode este arquivo sozinho
-- e só depois aplique 009_master_permissions_and_cleanup.sql.

alter type public.access_level add value if not exists 'MASTER' before 'ADMIN';
