-- Incremental, não destrutiva. Estende a notificação push ("número caiu") pro caso em que o
-- telefone do alerta do Telegram NÃO está cadastrado em public.numbers — hoje esse caso só grava
-- um integration_event (processing_status='PENDING_ASSOCIATION') e para por aí: nunca pode virar
-- uma Ocorrência (incidents.number_id é NOT NULL + FK pra numbers), então o gatilho da migration
-- 017 nunca tem o que notificar. Esta migration não altera nada de 013/014/016/017 — só adiciona
-- um segundo gatilho, em public.integration_events, cobrindo exatamente esse buraco.
--
-- Não precisa repetir o passo do vault (017 já criou 'push_trigger_secret' — reaproveitado aqui,
-- mesmo segredo, mesma Edge Function send-push-notifications, já redeployada pra aceitar o novo
-- formato de chamada {unregisteredPhone}).
begin;

create or replace function public.notify_unregistered_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
  v_url text;
begin
  if not (new.event_type = 'CONNECTIVITY_ALERT' and new.processing_status = 'PENDING_ASSOCIATION' and new.phone_normalized is not null) then
    return new;
  end if;

  -- Sem "OPEN/RESOLVED" pra este caso (não existe Ocorrência), então não dá pra usar o mesmo
  -- critério de dedupe da 017 ("já existe uma aberta?"). Em vez de notificar a CADA alerta
  -- repetido do mesmo telefone ainda não associado (o bot de infraestrutura tende a reenviar em
  -- loop enquanto o número seguir caído), só notifica de novo se o último aviso pra ESTE telefone
  -- foi há mais de 30 minutos — evita spam sem inventar um estado novo só pra isso.
  if exists (
    select 1 from public.integration_events
    where phone_normalized = new.phone_normalized
      and processing_status = 'PENDING_ASSOCIATION'
      and id <> new.id
      and created_at > now() - interval '30 minutes'
  ) then
    return new;
  end if;

  -- Mesma blindagem da 017: efeito colateral nunca pode impedir a gravação real do evento.
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
      body := jsonb_build_object('unregisteredPhone', new.phone_normalized)
    );
  exception when others then
    raise warning 'notify_unregistered_number: falha ao acionar a notificação de push (% - %). O evento foi salvo normalmente.', sqlstate, sqlerrm;
  end;

  return new;
end;
$$;

create trigger integration_events_notify_unregistered
  after insert on public.integration_events
  for each row execute function public.notify_unregistered_number();

commit;
