-- Diagnóstico do isolamento por Squad — SOMENTE LEITURA (só SELECT).
-- Rode no SQL Editor do Supabase ANTES de aplicar 025/026/027 e guarde o resultado.
-- Mostra o impacto real da regra nos dados atuais; não altera nada.

-- 0) Snapshot das policies atuais (guarde para comparar / auditar).
select tablename, policyname, cmd, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, policyname;

-- 1) Usuários por nível e quantos USER/VIEWER estão SEM Squad (não verão nada).
select access_level, status, count(*) as total, count(*) filter (where squad_id is null) as sem_squad
from public.profiles group by access_level, status order by access_level, status;

select id, name, email, access_level from public.profiles
where access_level in ('USER','VIEWER') and status = 'ACTIVE' and squad_id is null;

-- 2) Números sem nenhum Squad ("estoque" — visíveis a USER/VIEWER de qualquer Squad).
select count(*) as numeros_sem_squad
from public.numbers n where not exists (select 1 from public.number_squads ns where ns.number_id = n.id);

-- 3) Números em mais de um Squad (todos esses Squads verão ocorrências/histórico dele).
select ns.number_id, n.phone, array_agg(s.name order by s.name) as squads
from public.number_squads ns join public.numbers n on n.id = ns.number_id join public.squads s on s.id = ns.squad_id
group by ns.number_id, n.phone having count(*) > 1;

-- 4) Clientes e colaboradores sem Squad (clientes sem Squad: só MASTER/ADMIN veem).
select count(*) filter (where squad_id is null) as clientes_sem_squad, count(*) as clientes from public.clients;
select count(*) filter (where squad_id is null) as colaboradores_sem_squad, count(*) as colaboradores from public.responsibles;

-- 5) Campanhas cujo Squad difere do Squad do Cliente (USER não conseguirá editá-las).
select c.id, c.name, c.squad_id as campanha_squad, cl.squad_id as cliente_squad
from public.campaigns c join public.clients cl on cl.id = c.client_id
where cl.squad_id is distinct from c.squad_id;

-- 6) Vínculos ativos cujo número NÃO tem o Squad da campanha (o USER verá o vínculo,
--    mas não o número). O app corrige isso sozinho ao abrir com MASTER/ADMIN
--    (reconcileClientSquadFromActiveLinks).
select l.id, l.number_id, l.campaign_id, c.squad_id
from public.number_campaign_links l join public.campaigns c on c.id = l.campaign_id
where l.ended_at is null
  and not exists (select 1 from public.number_squads ns where ns.number_id = l.number_id and ns.squad_id = c.squad_id);

-- 7) Eventos do Bot sem número/campanha/cliente (passam a ser só MASTER/ADMIN).
select processing_status, count(*) from public.integration_events
where number_id is null and campaign_id is null and client_id is null
group by processing_status order by processing_status;
