-- 026 — Isolamento por Squad (parte 2/3): policies de LEITURA.
--
-- Aplique DEPOIS de 025_squad_scope_helpers.sql.
--
-- Incremental e não destrutiva: só ALTER POLICY nas policies de SELECT que já
-- existem (nenhum dado é lido/alterado/apagado). É ALTER e não CREATE de propósito:
-- policies permissivas se somam com OR — criar uma policy nova "por Squad" ao lado
-- da atual (`current_profile_is_active()`) não restringiria nada.
--
-- MASTER/ADMIN: `(select public.current_has_global_scope())` é true — mesma leitura
-- global de antes. USER/VIEWER: só o próprio Squad (ver 025).
--
-- Desempenho: toda função aqui aparece como `(select f())` ou `coluna in (select f())`.
-- Assim o Postgres avalia cada uma UMA vez por consulta (initPlan / subplano com hash),
-- não uma vez por linha — o app carrega tabelas inteiras (histórico, eventos do Bot) no
-- login, e chamar função por linha deixava a leitura dezenas de vezes mais lenta.
--
-- NÃO alteradas (de propósito):
-- - locations: catálogo físico (aparelho/estoque), sem relação própria com Squad e
--   sem dado de cliente — continua legível por qualquer usuário ativo.
-- - audit_logs (já só ADMIN/MASTER), profiles (USER/VIEWER já só veem o próprio),
--   signup_authorizations (só MASTER), push_subscriptions/push_subscription_squads
--   (só o dono — e são preferência de notificação, fora deste escopo).
begin;

-- Squads: USER/VIEWER só enxergam o próprio Squad.
alter policy squads_select on public.squads
  using ((select public.current_profile_is_active()) and (
    (select public.current_has_global_scope()) or id = (select public.current_squad_id())));

-- Clientes: pelo squad_id direto. Cliente sem Squad = só escopo global.
alter policy clients_select on public.clients
  using ((select public.current_profile_is_active()) and (
    (select public.current_has_global_scope()) or squad_id = (select public.current_squad_id())));

-- Colaboradores: do próprio Squad + colaboradores ainda sem Squad (são referenciados
-- por campanhas/números/localizações e são obrigatórios no cadastro de campanha —
-- escondê-los travaria a operação de quem ainda não teve colaboradores classificados).
alter policy responsibles_select on public.responsibles
  using ((select public.current_profile_is_active()) and (
    (select public.current_has_global_scope())
    or ((select public.current_squad_id()) is not null and (squad_id is null or squad_id = (select public.current_squad_id())))));

-- Números e tudo que pendura no número.
-- A última alternativa (número sem Squad, checada por linha) só roda para números que não
-- estão no conjunto visível — cobre o número recém-inserido pelo próprio USER.
alter policy numbers_select on public.numbers
  using ((select public.current_profile_is_active()) and (
    (select public.current_has_global_scope())
    or id in (select public.visible_number_ids())
    or ((select public.current_squad_id()) is not null and public.is_unassigned_number(id))));

-- Associação número -> Squad: USER/VIEWER só enxergam a linha do PRÓPRIO Squad (um número
-- compartilhado com outro Squad não revela qual é o outro).
alter policy number_squads_select on public.number_squads
  using ((select public.current_profile_is_active()) and (
    (select public.current_has_global_scope()) or squad_id = (select public.current_squad_id())));

alter policy number_clients_select on public.number_clients
  using ((select public.current_profile_is_active()) and (
    (select public.current_has_global_scope())
    or (number_id in (select public.visible_number_ids()) and client_id in (select public.visible_client_ids()))));

alter policy incidents_select on public.incidents
  using ((select public.current_profile_is_active()) and (
    (select public.current_has_global_scope()) or number_id in (select public.visible_number_ids())));

alter policy restrictions_select on public.restrictions
  using ((select public.current_profile_is_active()) and (
    (select public.current_has_global_scope()) or number_id in (select public.visible_number_ids())));

alter policy history_events_select on public.history_events
  using ((select public.current_profile_is_active()) and (
    (select public.current_has_global_scope()) or number_id in (select public.visible_number_ids())));

-- Campanhas e vínculos.
alter policy campaigns_select on public.campaigns
  using ((select public.current_profile_is_active()) and (
    (select public.current_has_global_scope()) or squad_id = (select public.current_squad_id())));

alter policy number_campaign_links_select on public.number_campaign_links
  using ((select public.current_profile_is_active()) and (
    (select public.current_has_global_scope()) or campaign_id in (select public.visible_campaign_ids())));

alter policy external_number_campaign_links_select on public.external_number_campaign_links
  using ((select public.current_profile_is_active()) and (
    (select public.current_has_global_scope()) or campaign_id in (select public.visible_campaign_ids())));

-- Central Number Ops Bot: evento visível quando o número, a campanha OU o cliente
-- associados são visíveis. Eventos sem nenhuma dessas associações (PENDING_ASSOCIATION,
-- IGNORED, IGNORED_NOT_OWNED, ERROR) não pertencem a Squad nenhum — ficam só para
-- MASTER/ADMIN (fila de triagem). O raw_payload traz o texto completo do alerta.
alter policy integration_events_select on public.integration_events
  using ((select public.current_profile_is_active()) and (
    (select public.current_has_global_scope())
    or number_id in (select public.visible_number_ids())
    or campaign_id in (select public.visible_campaign_ids())
    or client_id in (select public.visible_client_ids())));

-- Memória de números externos (global por natureza): USER/VIEWER só enxergam os
-- telefones já vinculados a uma campanha do próprio Squad.
alter policy external_numbers_select on public.external_numbers
  using ((select public.current_profile_is_active()) and (
    (select public.current_has_global_scope())
    or id in (select l.external_number_id from public.external_number_campaign_links l
              where l.campaign_id in (select public.visible_campaign_ids()))));

commit;
