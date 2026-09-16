-- Incremental, não destrutiva. Cria o log imutável de eventos externos que
-- alimentará a primeira integração da V3 (Telegram / Number_Ops_Bot).
--
-- Este bloco é SOMENTE DE INGESTÃO: a tabela abaixo nunca é lida nem escrita
-- pelo frontend (anon/authenticated). Só a Edge Function grava aqui, usando a
-- service_role key (que ignora RLS por padrão no Supabase). RLS é habilitada
-- e nenhuma policy é criada para anon/authenticated — deny-by-default.
--
-- Nenhuma tabela/coluna operacional existente é alterada. Nenhum dado é
-- migrado/apagado.
begin;

create table public.integration_events (
  id text primary key default ('integration_event_' || gen_random_uuid()::text),
  source text not null,
  source_event_id text not null,
  event_type text not null,
  raw_payload jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  phone_normalized text,
  number_id text references public.numbers(id) on delete set null,
  campaign_id text references public.campaigns(id) on delete set null,
  client_id text references public.clients(id) on delete set null,
  matched_confidence numeric,
  processing_status text not null default 'RECEIVED'
    check (processing_status in ('RECEIVED','MATCHED','PENDING_ASSOCIATION','IGNORED','ERROR','LINKED_TO_INCIDENT')),
  -- reservado para o Bloco 2 (associação evento -> ocorrência). Não usado neste bloco.
  linked_incident_id text references public.incidents(id) on delete set null,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_event_id)
);

create index integration_events_status_idx on public.integration_events (processing_status);
create index integration_events_number_idx on public.integration_events (number_id);
create index integration_events_received_idx on public.integration_events (received_at desc);

alter table public.integration_events enable row level security;
revoke all on public.integration_events from anon, authenticated;
-- Nenhuma "create policy" para anon/authenticated de propósito: hoje ninguém
-- autenticado pelo frontend pode ler ou escrever nesta tabela. Uma policy de
-- leitura restrita (ex.: ADMIN/MASTER, para a fila de revisão) é assunto de
-- um bloco futuro, quando essa tela existir.

commit;
