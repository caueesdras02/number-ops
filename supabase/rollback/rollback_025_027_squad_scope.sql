-- ROLLBACK de 026 + 027 (isolamento por Squad). NÃO faz parte da sequência de
-- migrations — só rode se precisar desfazer o isolamento.
--
-- Devolve cada policy alterada EXATAMENTE à definição anterior (schema.sql + 009 +
-- 012 + 015 + 016 + 023). Não toca em dados. As funções e índices de 025 ficam
-- (não são usados por nenhuma policy depois deste rollback e não têm efeito).
begin;

-- Leitura (026) — volta a "qualquer usuário ativo lê tudo".
do $$
declare t text;
begin
  foreach t in array array['squads','clients','responsibles','numbers','number_squads','number_clients',
                           'incidents','restrictions','history_events','campaigns','number_campaign_links']
  loop
    execute format('alter policy %I on public.%I using (public.current_profile_is_active())', t || '_select', t);
  end loop;
end $$;
alter policy external_number_campaign_links_select on public.external_number_campaign_links using (public.current_profile_is_active());
alter policy integration_events_select on public.integration_events using (public.current_profile_is_active());
alter policy external_numbers_select on public.external_numbers using (public.current_profile_is_active());

-- Escrita (027) — volta ao tier MASTER/ADMIN/USER sem Squad.
do $$
declare t text;
begin
  foreach t in array array['numbers','number_squads','number_clients','incidents','restrictions',
                           'history_events','campaigns','number_campaign_links']
  loop
    execute format(
      'alter policy %I on public.%I with check (public.current_access_level() in (''MASTER'',''ADMIN'',''USER''))',
      t || '_insert', t);
    execute format(
      'alter policy %I on public.%I using (public.current_access_level() in (''MASTER'',''ADMIN'',''USER'')) with check (public.current_access_level() in (''MASTER'',''ADMIN'',''USER''))',
      t || '_update', t);
  end loop;
end $$;
alter policy number_squads_delete on public.number_squads using (public.current_access_level() in ('MASTER','ADMIN','USER'));
alter policy number_clients_delete on public.number_clients using (public.current_access_level() in ('MASTER','ADMIN','USER'));

alter policy external_number_campaign_links_insert on public.external_number_campaign_links
  with check (public.current_access_level() in ('MASTER','ADMIN','USER'));
alter policy external_number_campaign_links_update on public.external_number_campaign_links
  using (public.current_access_level() in ('MASTER','ADMIN','USER'))
  with check (public.current_access_level() in ('MASTER','ADMIN','USER'));

alter policy external_numbers_insert on public.external_numbers
  with check (public.current_access_level() in ('MASTER','ADMIN','USER'));
alter policy external_numbers_update on public.external_numbers
  using (public.current_access_level() in ('MASTER','ADMIN','USER'))
  with check (public.current_access_level() in ('MASTER','ADMIN','USER'));

alter policy integration_events_manual_resolution_update on public.integration_events
  using (
    public.current_access_level() in ('MASTER','ADMIN','USER')
    and processing_status in ('PENDING_ASSOCIATION','MATCHED')
  )
  with check (
    public.current_access_level() in ('MASTER','ADMIN','USER')
    and processing_status in ('IGNORED_NOT_OWNED','MATCHED','LINKED_TO_INCIDENT')
  );

commit;
