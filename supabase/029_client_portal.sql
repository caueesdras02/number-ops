-- 029 — Acesso de cliente (parte 2/2): vínculo usuário -> cliente e Portal do cliente.
--
-- Aplique DEPOIS de 028_client_access_level.sql (e de 025-027, cujas funções de escopo
-- esta migration reaproveita).
--
-- Incremental e não destrutiva: adiciona colunas nulas, uma função de leitura e ajusta
-- três policies. Nenhum dado existente é alterado ou apagado.
--
-- Modelo de segurança do CLIENT (acesso externo, somente leitura, de UM cliente):
-- - NUNCA lê as tabelas operacionais. As policies de 026 já não dão nada a ele
--   (não é escopo global e current_squad_id() só vale para USER/VIEWER), as de escrita
--   (027 e anteriores) nunca incluem CLIENT, e aqui fechamos o que ainda era "qualquer
--   usuário ativo": o catálogo de localizações e a inscrição de push.
-- - Lê SOMENTE por public.client_portal(), que devolve apenas os campos combinados com
--   o cliente: chip (número, identificação, status, localização, quantidade de grupos,
--   tipo de restrição), campanhas DELE e em que campanha cada chip está, e as quedas.
--   Ficam de fora: observações internas, colaborador responsável, descrição de
--   ocorrência, histórico interno, outros clientes.
-- - Um chip aparece se está ou esteve em campanha do cliente; as quedas só contam dentro
--   do período em que o chip estava numa campanha dele (nunca o período de outro cliente).
begin;

-- ---------------------------------------------------------------------------
-- 1. Usuário -> Cliente (só faz sentido para CLIENT; obrigatório nesse nível)
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists client_id text references public.clients(id) on delete set null;
create index if not exists profiles_client_idx on public.profiles (client_id);
alter table public.profiles drop constraint if exists profiles_client_access_check;
alter table public.profiles add constraint profiles_client_access_check
  check (access_level::text <> 'CLIENT' or client_id is not null);

alter table public.signup_authorizations add column if not exists client_id text references public.clients(id) on delete set null;
alter table public.signup_authorizations drop constraint if exists signup_authorizations_client_access_check;
alter table public.signup_authorizations add constraint signup_authorizations_client_access_check
  check (access_level::text <> 'CLIENT' or client_id is not null);

-- Cliente do usuário autenticado (null para qualquer outro nível, inativo ou anônimo).
create or replace function public.current_client_id()
returns text language sql stable security definer set search_path = public
as $$ select client_id from public.profiles where id = auth.uid() and status = 'ACTIVE' and access_level::text = 'CLIENT' $$;
revoke all on function public.current_client_id() from public, anon;
grant execute on function public.current_client_id() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Cadastro por convite: o cliente vem da autorização (cópia de 021 + client_id).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_access_level public.access_level;
  v_squad_id text;
  v_client_id text;
begin
  select access_level, squad_id, client_id into v_access_level, v_squad_id, v_client_id
  from public.signup_authorizations
  where lower(email) = lower(new.email) and status = 'PENDING'
  for update;

  if not found then
    raise exception 'E-mail não autorizado a se cadastrar no Number Ops.' using errcode = '28000';
  end if;

  if v_squad_id is not null and not exists(select 1 from public.squads where id = v_squad_id and is_active) then
    v_squad_id := null;
  end if;

  if v_access_level::text = 'CLIENT' then
    v_squad_id := null; -- acesso de cliente nunca é por Squad
    if v_client_id is null or not exists(select 1 from public.clients where id = v_client_id) then
      raise exception 'Autorização de cliente sem cliente válido.' using errcode = '28000';
    end if;
  else
    v_client_id := null;
  end if;

  insert into public.profiles(id, name, email, job_title, squad_id, client_id, status, access_level)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
    new.email,
    case new.raw_user_meta_data ->> 'job_title'
      when 'ACCOUNT_MANAGER' then 'ACCOUNT_MANAGER'::public.profile_job_title
      when 'OTHER' then 'OTHER'::public.profile_job_title
      else 'ANALYST'::public.profile_job_title
    end,
    v_squad_id,
    v_client_id,
    'ACTIVE',
    v_access_level
  );

  update public.signup_authorizations
     set status = 'USED', used_by = new.id, used_at = now(), updated_at = now()
   where lower(email) = lower(new.email) and status = 'PENDING';

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Fecha o que ainda era "qualquer usuário ativo" para o CLIENT.
-- ---------------------------------------------------------------------------
-- Catálogo de localizações: continua de todos os níveis internos; o cliente vê a
-- localização dos chips dele só pelo portal.
alter policy locations_select on public.locations
  using (public.current_profile_is_active() and coalesce(public.current_access_level()::text, '') <> 'CLIENT');

-- Push: a Edge Function send-push-notifications envia para TODA inscrição (com ou sem
-- preferência de Squad) — um cliente inscrito receberia quedas de todos os clientes.
-- Até a notificação ter escopo próprio, CLIENT não se inscreve.
alter policy push_subscriptions_own_insert on public.push_subscriptions
  with check (profile_id = auth.uid() and coalesce(public.current_access_level()::text, '') <> 'CLIENT');
alter policy push_subscriptions_own_update on public.push_subscriptions
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and coalesce(public.current_access_level()::text, '') <> 'CLIENT');

-- ---------------------------------------------------------------------------
-- 4. Portal do cliente — ÚNICA leitura do CLIENT.
--    p_client_id só é aceito de MASTER/ADMIN ("ver como o cliente vê", para conferir
--    antes de liberar o acesso); para todo mundo é ignorado e vale o cliente do perfil.
-- ---------------------------------------------------------------------------
create or replace function public.client_portal(p_client_id text default null)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_client text;
begin
  if p_client_id is not null and public.current_has_global_scope() then
    v_client := p_client_id;
  else
    v_client := public.current_client_id();
  end if;
  if v_client is null then
    raise exception 'Acesso de cliente não configurado para este usuário.' using errcode = '42501';
  end if;

  return (
    with my_campaigns as (
      select c.id, c.name, c.status, c.stage, c.started_at, c.ended_at
      from public.campaigns c where c.client_id = v_client
    ),
    my_links as (
      select l.number_id, l.campaign_id, l.role, l.started_at, l.ended_at
      from public.number_campaign_links l join my_campaigns c on c.id = l.campaign_id
    ),
    -- Quedas (CONNECTIVITY) só dentro do período em que o chip estava numa campanha deste cliente.
    my_outages as (
      select distinct on (i.id) i.id, i.number_id, l.campaign_id, i.status, i.created_at, i.resolved_at
      from public.incidents i
      join my_links l on l.number_id = i.number_id
       and i.created_at >= l.started_at and (l.ended_at is null or i.created_at <= l.ended_at)
      where i.classification = 'CONNECTIVITY'
      order by i.id, l.started_at desc
    ),
    -- Chips do cliente que não são da operação (classificados na Central do Bot) e foram
    -- vinculados às campanhas dele: sem status/ocorrência, só o vínculo e os alertas.
    my_external as (
      select e.id, e.phone_normalized, e.campaign_id, e.linked_at, e.ended_at
      from public.external_number_campaign_links e join my_campaigns c on c.id = e.campaign_id
    )
    select jsonb_build_object(
      'client', (select jsonb_build_object('id', cl.id, 'name', cl.name) from public.clients cl where cl.id = v_client),
      'generatedAt', now(),
      'campaigns', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status, 'stage', c.stage,
                                            'startedAt', c.started_at, 'endedAt', c.ended_at) order by c.started_at desc)
        from my_campaigns c), '[]'::jsonb),
      'chips', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', n.id, 'phone', n.phone, 'identification', n.identification, 'status', n.status,
          'archived', n.archived_at is not null, 'location', loc.name, 'groupCount', n.group_count,
          'restriction', r.kind, 'updatedAt', n.updated_at,
          'links', (select jsonb_agg(jsonb_build_object('campaignId', l.campaign_id, 'role', l.role,
                                                        'startedAt', l.started_at, 'endedAt', l.ended_at) order by l.started_at desc)
                    from my_links l where l.number_id = n.id)
        ) order by n.phone)
        from public.numbers n
        left join public.locations loc on loc.id = n.location_id
        left join public.restrictions r on r.number_id = n.id and r.ended_at is null
        where n.id in (select number_id from my_links)), '[]'::jsonb),
      'outages', coalesce((
        select jsonb_agg(jsonb_build_object('id', o.id, 'numberId', o.number_id, 'campaignId', o.campaign_id,
                                            'status', o.status, 'createdAt', o.created_at, 'resolvedAt', o.resolved_at) order by o.created_at desc)
        from (select * from my_outages order by created_at desc limit 500) o), '[]'::jsonb),
      'externalChips', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id, 'phone', e.phone_normalized, 'campaignId', e.campaign_id, 'linkedAt', e.linked_at, 'endedAt', e.ended_at,
          'alerts', coalesce((select jsonb_agg(a.received_at order by a.received_at desc)
                              from (select ie.received_at from public.integration_events ie
                                    where ie.event_type = 'CONNECTIVITY_ALERT' and ie.phone_normalized = e.phone_normalized
                                      and ie.received_at >= e.linked_at and (e.ended_at is null or ie.received_at <= e.ended_at)
                                    order by ie.received_at desc limit 50) a), '[]'::jsonb)
        ) order by e.linked_at desc)
        from my_external e), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.client_portal(text) from public, anon;
grant execute on function public.client_portal(text) to authenticated;

commit;
