-- 028 — Acesso de cliente (parte 1/2): adiciona o nível de acesso CLIENT.
-- Incremental e não destrutivo. NÃO deve ter begin/commit: um novo valor de enum
-- não pode ser usado na mesma transação em que é criado (mesma regra de 008/020).
-- Rode este arquivo sozinho e só depois aplique 029_client_portal.sql.
--
-- CLIENT fica no fim da hierarquia: é um acesso EXTERNO, só leitura, restrito aos
-- dados de UM cliente (profiles.client_id, criado em 029) — nunca enxerga as tabelas
-- operacionais; lê apenas pela função public.client_portal().

alter type public.access_level add value if not exists 'CLIENT';
