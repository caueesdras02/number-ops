-- 027 — Isolamento por Squad (parte 3/3): policies de ESCRITA.
--
-- Aplique DEPOIS de 026_squad_scope_select_policies.sql.
--
-- Incremental e não destrutiva: só ALTER POLICY (nenhum dado é alterado/apagado).
-- Mantém o tier de escrita de cada tabela exatamente como estava
-- (MASTER/ADMIN/USER nas operacionais; VIEWER nunca escreve) e acrescenta o escopo
-- de Squad. Para MASTER/ADMIN as funções can_see_* são sempre true, então o
-- comportamento deles não muda.
--
-- NÃO alteradas (de propósito):
-- - numbers_insert: um número novo ainda não tem Squad no momento do INSERT (o
--   vínculo em number_squads é gravado logo depois, pelo mesmo sync); o Squad do
--   USER é exigido na escrita de number_squads abaixo e garantido pelo frontend.
-- - clients/squads/responsibles/locations insert/update: já são só MASTER/ADMIN (012).
-- - todas as policies *_delete de registros: já são só MASTER (009).
begin;

-- ---------------------------------------------------------------------------
-- Números
-- ---------------------------------------------------------------------------
alter policy numbers_update on public.numbers
  using (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_number(id))
  with check (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_number(id));

-- Associação número -> Squad: USER só associa/remove o PRÓPRIO Squad.
alter policy number_squads_insert on public.number_squads
  with check (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_number(number_id) and public.can_see_squad(squad_id));
alter policy number_squads_update on public.number_squads
  using (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_number(number_id) and public.can_see_squad(squad_id))
  with check (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_number(number_id) and public.can_see_squad(squad_id));
alter policy number_squads_delete on public.number_squads
  using (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_number(number_id) and public.can_see_squad(squad_id));

-- Associação número -> Cliente: só clientes do próprio Squad.
alter policy number_clients_insert on public.number_clients
  with check (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_number(number_id) and public.can_see_client(client_id));
alter policy number_clients_update on public.number_clients
  using (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_number(number_id) and public.can_see_client(client_id))
  with check (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_number(number_id) and public.can_see_client(client_id));
alter policy number_clients_delete on public.number_clients
  using (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_number(number_id) and public.can_see_client(client_id));

-- Ocorrências / restrições / histórico: seguem a visibilidade do número.
alter policy incidents_insert on public.incidents
  with check (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_number(number_id));
alter policy incidents_update on public.incidents
  using (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_number(number_id))
  with check (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_number(number_id));

alter policy restrictions_insert on public.restrictions
  with check (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_number(number_id));
alter policy restrictions_update on public.restrictions
  using (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_number(number_id))
  with check (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_number(number_id));

alter policy history_events_insert on public.history_events
  with check (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_number(number_id));
alter policy history_events_update on public.history_events
  using (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_number(number_id))
  with check (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_number(number_id));

-- ---------------------------------------------------------------------------
-- Campanhas e vínculos
-- ---------------------------------------------------------------------------
-- Campanha do próprio Squad, com Cliente do próprio Squad (antes validado só no frontend).
alter policy campaigns_insert on public.campaigns
  with check (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_squad(squad_id) and public.can_see_client(client_id));
alter policy campaigns_update on public.campaigns
  using (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_squad(squad_id))
  with check (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_squad(squad_id) and public.can_see_client(client_id));

-- Vincular exige campanha E número visíveis; encerrar/alterar um vínculo existente
-- exige só a campanha (o vínculo pertence à campanha).
alter policy number_campaign_links_insert on public.number_campaign_links
  with check (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_campaign(campaign_id) and public.can_see_number(number_id));
alter policy number_campaign_links_update on public.number_campaign_links
  using (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_campaign(campaign_id))
  with check (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_campaign(campaign_id));

alter policy external_number_campaign_links_insert on public.external_number_campaign_links
  with check (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_campaign(campaign_id));
alter policy external_number_campaign_links_update on public.external_number_campaign_links
  using (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_campaign(campaign_id))
  with check (public.current_access_level() in ('MASTER','ADMIN','USER') and public.can_see_campaign(campaign_id));

-- ---------------------------------------------------------------------------
-- Central Number Ops Bot
-- ---------------------------------------------------------------------------
-- Resolução manual: mesmas transições de status de 016, agora só em eventos visíveis
-- e nunca associando um número fora do próprio Squad.
alter policy integration_events_manual_resolution_update on public.integration_events
  using (
    public.current_access_level() in ('MASTER','ADMIN','USER')
    and processing_status in ('PENDING_ASSOCIATION','MATCHED')
    and (public.can_see_number(number_id) or public.can_see_campaign(campaign_id) or public.can_see_client(client_id))
  )
  with check (
    public.current_access_level() in ('MASTER','ADMIN','USER')
    and processing_status in ('IGNORED_NOT_OWNED','MATCHED','LINKED_TO_INCIDENT')
    and (number_id is null or public.can_see_number(number_id))
  );

-- Memória GLOBAL de números externos: classificar/reverter afeta a ingestão de alertas
-- de TODOS os Squads — passa a ser só MASTER/ADMIN.
alter policy external_numbers_insert on public.external_numbers
  with check (public.current_has_global_scope());
alter policy external_numbers_update on public.external_numbers
  using (public.current_has_global_scope())
  with check (public.current_has_global_scope());

commit;
