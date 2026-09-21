-- Incremental, não destrutiva. Introduz notificação push ("número caiu") para
-- quem instalar o Number Ops como atalho na tela de início. Não altera
-- nenhuma tabela/coluna/policy já existente de números/campanhas/ocorrências
-- — só adiciona.
--
-- ATENÇÃO — passo manual obrigatório ANTES de aplicar esta migration:
-- rode no SQL editor do Supabase (é um segredo, não fica no git):
--   select vault.create_secret('<valor aleatório longo>', 'push_trigger_secret');
-- O mesmo valor precisa ser cadastrado como secret da Edge Function
-- send-push-notifications (PUSH_TRIGGER_SECRET) — ver instruções de deploy.
begin;

create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- 1. Inscrições de push por usuário/dispositivo
-- ---------------------------------------------------------------------------
-- Dado pessoal do usuário (igual profiles) — RLS não passa pelos tiers
-- MASTER/ADMIN/USER/VIEWER, cada um só vê/gerencia a própria inscrição.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Reassinar no mesmo aparelho não duplica: o endpoint do navegador é a
-- identidade real da inscrição.
create unique index push_subscriptions_endpoint_uidx on public.push_subscriptions (endpoint);
create index push_subscriptions_profile_idx on public.push_subscriptions (profile_id);

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_own_select on public.push_subscriptions
  for select to authenticated using (profile_id = auth.uid());
create policy push_subscriptions_own_insert on public.push_subscriptions
  for insert to authenticated with check (profile_id = auth.uid());
create policy push_subscriptions_own_update on public.push_subscriptions
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
create policy push_subscriptions_own_delete on public.push_subscriptions
  for delete to authenticated using (profile_id = auth.uid());
-- update é necessário: reassinar no mesmo aparelho atualiza a linha existente
-- (endpoint único) em vez de inserir de novo — ver PushService.subscribe().
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Gatilho: Ocorrência de conectividade abre (ou reabre) -> chama a Edge
--    Function que envia o push. Vive 100% no banco de propósito — nem o
--    Telegram bot (classification.js/handler.js) nem a criação manual
--    (IncidentsService) nem a associação manual (bot-service.js) precisam
--    saber que notificação existe.
-- ---------------------------------------------------------------------------
create or replace function public.notify_number_down()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
  v_url text;
begin
  if not (new.classification = 'CONNECTIVITY' and new.status = 'OPEN') then
    return new;
  end if;
  -- Só notifica quando ABRE de fato: um insert novo, ou uma reabertura
  -- (RESOLVED -> OPEN). Editar outro campo de uma ocorrência já aberta não
  -- deve gerar push de novo.
  if tg_op = 'UPDATE' and old.status = 'OPEN' then
    return new;
  end if;

  -- Blindagem: isto é um efeito colateral (notificar), nunca pode impedir a
  -- escrita real da Ocorrência (o Bot/CONNECTIVITY continuam funcionando
  -- mesmo que o vault, o pg_net ou a Edge Function estejam mal configurados
  -- ou fora do ar). Qualquer erro aqui vira só um aviso no log, nunca
  -- propaga pro INSERT/UPDATE que disparou o gatilho.
  begin
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'push_trigger_secret'
    limit 1;

    v_url := current_setting('app.settings.push_function_url', true);
    if v_url is null or v_url = '' then
      -- Projeto: puidjdezfyxjornmdzvp (ver src/js/config/supabase-runtime.js). Se
      -- trocar de projeto Supabase, ajuste esta URL (ou defina
      -- app.settings.push_function_url na sessão do banco).
      v_url := 'https://puidjdezfyxjornmdzvp.supabase.co/functions/v1/send-push-notifications';
    end if;

    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-trigger-secret', coalesce(v_secret, '')),
      body := jsonb_build_object('incidentId', new.id)
    );
  exception when others then
    raise warning 'notify_number_down: falha ao acionar a notificação de push (% - %). A Ocorrência foi salva normalmente.', sqlstate, sqlerrm;
  end;

  return new;
end;
$$;

create trigger incidents_notify_number_down
  after insert or update on public.incidents
  for each row execute function public.notify_number_down();

commit;
