-- 025 — Isolamento por Squad (parte 1/3): funções auxiliares de escopo + índices.
--
-- Incremental e não destrutiva: só cria funções e índices. Nenhuma policy,
-- tabela, coluna ou dado é alterado aqui — sozinha, esta migration não muda
-- o comportamento de ninguém. As policies que usam estas funções vêm em
-- 026 (leitura) e 027 (escrita).
--
-- Regra:
-- - MASTER e ADMIN: escopo GLOBAL (ADMIN preserva exatamente o acesso de leitura
--   que já tinha — hoje todo usuário ativo lê tudo).
-- - USER e VIEWER: só o Squad do próprio perfil (profiles.squad_id). Sem Squad no
--   perfil = nenhum dado operacional. VIEWER continua sem escrita (policies de
--   escrita já excluem VIEWER desde schema.sql/009).
-- - profiles.squad_id é o Squad ao qual o usuário PERTENCE — não tem relação com a
--   preferência de notificação (push_subscription_squads), que não é tocada aqui.
--
-- Todas as funções são security definer (leem profiles/number_squads/clients/
-- campaigns sem passar pelo RLS dessas tabelas — evita recursão entre policies)
-- e stable, com search_path fixo, no mesmo padrão de current_access_level().
begin;

-- Squad que restringe o usuário autenticado — só existe para USER/VIEWER (null se sem
-- Squad, inativo, não autenticado, ou de qualquer outro nível: MASTER/ADMIN são globais e
-- o acesso de cliente (029) nunca enxerga dado por Squad, mesmo com squad_id preenchido).
create or replace function public.current_squad_id()
returns text language sql stable security definer set search_path = public
as $$ select squad_id from public.profiles where id = auth.uid() and status = 'ACTIVE' and access_level::text in ('USER','VIEWER') $$;

-- MASTER/ADMIN ativos enxergam todos os Squads.
create or replace function public.current_has_global_scope()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_access_level() in ('MASTER','ADMIN'), false) $$;

-- Registro com squad_id direto (squads.id, clients.squad_id, campaigns.squad_id...).
-- squad_id nulo só é visível para escopo global.
create or replace function public.can_see_squad(p_squad_id text)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.current_has_global_scope()
      or (p_squad_id is not null and p_squad_id = public.current_squad_id())
$$;

create or replace function public.can_see_client(p_client_id text)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.current_has_global_scope()
      or (p_client_id is not null and exists (
            select 1 from public.clients c
            where c.id = p_client_id and c.squad_id = public.current_squad_id()))
$$;

create or replace function public.can_see_campaign(p_campaign_id text)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.current_has_global_scope()
      or (p_campaign_id is not null and exists (
            select 1 from public.campaigns c
            where c.id = p_campaign_id and c.squad_id = public.current_squad_id()))
$$;

-- Número: pertence a Squads pela relação N:N já existente (number_squads).
-- Um número SEM nenhum Squad é "estoque" comum: visível a USER/VIEWER de qualquer
-- Squad (desde que o perfil tenha Squad). Isso também permite que um USER cadastre
-- um número novo: o upsert do frontend (INSERT ... ON CONFLICT DO UPDATE) aplica a
-- policy de SELECT à linha nova antes de o vínculo em number_squads existir.
create or replace function public.can_see_number(p_number_id text)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.current_has_global_scope()
      or (
        p_number_id is not null
        and public.current_squad_id() is not null
        and (
          exists (select 1 from public.number_squads ns
                  where ns.number_id = p_number_id and ns.squad_id = public.current_squad_id())
          or not exists (select 1 from public.number_squads ns where ns.number_id = p_number_id)
        )
      )
$$;

-- Conjuntos visíveis (para as policies de LEITURA em 026). As policies usam
-- `coluna in (select public.visible_*_ids())`: o Postgres calcula o conjunto UMA vez por
-- consulta (subplano com hash) em vez de chamar uma função por linha — carregar o
-- histórico/eventos inteiros no login continua rápido. can_see_* acima ficam para as
-- policies de ESCRITA (027), que tocam poucas linhas.
create or replace function public.visible_number_ids()
returns setof text language sql stable security definer set search_path = public
as $$
  with me as (select public.current_squad_id() as squad_id)
  select ns.number_id from public.number_squads ns, me where ns.squad_id = me.squad_id
  union
  select n.id from public.numbers n, me
  where me.squad_id is not null
    and not exists (select 1 from public.number_squads ns where ns.number_id = n.id)
$$;

create or replace function public.visible_campaign_ids()
returns setof text language sql stable security definer set search_path = public
as $$
  with me as (select public.current_squad_id() as squad_id)
  select c.id from public.campaigns c, me where c.squad_id = me.squad_id
$$;

create or replace function public.visible_client_ids()
returns setof text language sql stable security definer set search_path = public
as $$
  with me as (select public.current_squad_id() as squad_id)
  select c.id from public.clients c, me where c.squad_id = me.squad_id
$$;

-- Número sem nenhum Squad ("estoque"). Checado por linha só na policy de leitura de
-- `numbers`, como ÚLTIMA alternativa do OR: cobre o número que o próprio USER acabou de
-- inserir (o upsert do frontend aplica a policy de SELECT à linha nova, que ainda não
-- existe no instantâneo usado por visible_number_ids()).
create or replace function public.is_unassigned_number(p_number_id text)
returns boolean language sql stable security definer set search_path = public
as $$ select not exists (select 1 from public.number_squads ns where ns.number_id = p_number_id) $$;

revoke all on function public.is_unassigned_number(text) from public, anon;
grant execute on function public.is_unassigned_number(text) to authenticated;

revoke all on function public.visible_number_ids() from public, anon;
revoke all on function public.visible_campaign_ids() from public, anon;
revoke all on function public.visible_client_ids() from public, anon;
grant execute on function public.visible_number_ids() to authenticated;
grant execute on function public.visible_campaign_ids() to authenticated;
grant execute on function public.visible_client_ids() to authenticated;

revoke all on function public.current_squad_id() from public, anon;
revoke all on function public.current_has_global_scope() from public, anon;
revoke all on function public.can_see_squad(text) from public, anon;
revoke all on function public.can_see_client(text) from public, anon;
revoke all on function public.can_see_campaign(text) from public, anon;
revoke all on function public.can_see_number(text) from public, anon;
grant execute on function public.current_squad_id() to authenticated;
grant execute on function public.current_has_global_scope() to authenticated;
grant execute on function public.can_see_squad(text) to authenticated;
grant execute on function public.can_see_client(text) to authenticated;
grant execute on function public.can_see_campaign(text) to authenticated;
grant execute on function public.can_see_number(text) to authenticated;

-- Índices usados pelas checagens acima/policies de 026 (number_squads só tinha a PK
-- (number_id, squad_id); integration_events não tinha índice por campanha/cliente).
create index if not exists number_squads_squad_idx on public.number_squads (squad_id);
create index if not exists integration_events_campaign_idx on public.integration_events (campaign_id);
create index if not exists integration_events_client_idx on public.integration_events (client_id);

commit;
