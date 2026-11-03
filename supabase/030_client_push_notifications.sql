-- 030 — Notificação push para o acesso de cliente.
--
-- ⚠️ ORDEM OBRIGATÓRIA: publique ANTES a nova versão da Edge Function
-- send-push-notifications (que só envia a cada inscrição o que o dono dela pode ver). Com a
-- versão antiga no ar, um cliente inscrito receberia as quedas de TODOS os clientes.
--
-- Aplique DEPOIS de 029_client_portal.sql. Incremental e não destrutiva: ajusta duas policies
-- e adiciona um gatilho. Nenhum dado é alterado ou apagado.
begin;

-- 1. CLIENT volta a poder se inscrever (as policies voltam à forma de 017): o escopo agora é
--    garantido na Edge Function, que só manda ao cliente a queda dos chips das campanhas dele.
alter policy push_subscriptions_own_insert on public.push_subscriptions
  with check (profile_id = auth.uid());
alter policy push_subscriptions_own_update on public.push_subscriptions
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- 2. Alerta de queda de chip EXTERNO (de cliente, "não pertence à operação") vinculado a uma
--    campanha: hoje vira só um integration_event IGNORED_NOT_OWNED, sem Ocorrência — então o
--    gatilho de 017 nunca dispara. Este gatilho avisa a Edge Function com {externalAlertPhone};
--    ela só envia para o CLIENT dono da campanha (a equipe interna continua sem receber, como
--    antes). Mesmo anti-spam de 022: no máximo um aviso a cada 30 min por telefone.
create or replace function public.notify_external_number_alert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
  v_url text;
begin
  if not (new.event_type = 'CONNECTIVITY_ALERT' and new.processing_status = 'IGNORED_NOT_OWNED' and new.phone_normalized is not null) then
    return new;
  end if;
  if not exists (
    select 1 from public.external_number_campaign_links l
    where l.phone_normalized = new.phone_normalized and l.ended_at is null
  ) then
    return new;
  end if;
  if exists (
    select 1 from public.integration_events
    where phone_normalized = new.phone_normalized
      and processing_status = 'IGNORED_NOT_OWNED'
      and id <> new.id
      and created_at > now() - interval '30 minutes'
  ) then
    return new;
  end if;

  -- Mesma blindagem de 017/022: efeito colateral nunca impede a gravação real do evento.
  begin
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'push_trigger_secret'
    limit 1;

    v_url := current_setting('app.settings.push_function_url', true);
    if v_url is null or v_url = '' then
      v_url := 'https://puidjdezfyxjornmdzvp.supabase.co/functions/v1/send-push-notifications';
    end if;

    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-trigger-secret', coalesce(v_secret, '')),
      body := jsonb_build_object('externalAlertPhone', new.phone_normalized)
    );
  exception when others then
    raise warning 'notify_external_number_alert: falha ao acionar a notificação de push (% - %). O evento foi salvo normalmente.', sqlstate, sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.notify_external_number_alert() from public, anon, authenticated;

drop trigger if exists integration_events_notify_external_alert on public.integration_events;
create trigger integration_events_notify_external_alert
  after insert on public.integration_events
  for each row execute function public.notify_external_number_alert();

commit;
