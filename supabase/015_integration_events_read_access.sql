-- Incremental, não destrutiva. Dá ao frontend (usuários autenticados) acesso
-- de LEITURA à Central Number Ops Bot — a única mudança necessária de
-- backend para o bloco de frontend da Central. Não altera Edge Function,
-- parser, classificação, incidents, restrictions ou qualquer regra
-- operacional. Não concede INSERT/UPDATE/DELETE: a única escrita continua
-- sendo feita pela Edge Function via service_role (que ignora RLS).
begin;

create policy integration_events_select on public.integration_events
  for select to authenticated
  using (public.current_profile_is_active());

grant select on public.integration_events to authenticated;

commit;
