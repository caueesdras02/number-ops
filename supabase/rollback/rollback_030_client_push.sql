-- ROLLBACK de 030 (push para o acesso de cliente). NÃO faz parte da sequência de migrations.
-- Volta a bloquear a inscrição de CLIENT (forma de 029) e remove o aviso de chip externo.
-- As inscrições de cliente já existentes ficam, mas a Edge Function nova só manda a elas o que
-- é delas; para cortar de vez, apague-as em push_subscriptions.
begin;

drop trigger if exists integration_events_notify_external_alert on public.integration_events;
drop function if exists public.notify_external_number_alert();

alter policy push_subscriptions_own_insert on public.push_subscriptions
  with check (profile_id = auth.uid() and coalesce(public.current_access_level()::text, '') <> 'CLIENT');
alter policy push_subscriptions_own_update on public.push_subscriptions
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and coalesce(public.current_access_level()::text, '') <> 'CLIENT');

commit;
