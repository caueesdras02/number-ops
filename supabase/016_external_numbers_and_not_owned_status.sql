-- Incremental, não destrutiva. Introduz a memória auditável de "números
-- externos" (telefones que alertam via Telegram mas NÃO pertencem à nossa
-- operação) e um novo processing_status para representar isso em
-- integration_events. Não altera Edge Function/parser/migrations já
-- aplicadas — só adiciona.
--
-- Nenhum dado existente é apagado. PENDING_ASSOCIATION já existentes no
-- banco continuam intactos e passam a poder ser classificados normalmente
-- pela UI depois que esta migration for aplicada.
begin;

-- ---------------------------------------------------------------------------
-- 1. Memória de números externos
-- ---------------------------------------------------------------------------
-- Histórico completo é preservado: "reverter" nunca apaga a linha, só marca
-- reverted_at/reverted_by (mesmo padrão de restrictions/number_campaign_links
-- — "ended_at"/"endedAt" — já usado no projeto). Uma nova classificação depois
-- de revertida cria uma linha NOVA (o índice único abaixo só vale para a
-- linha ATIVA, não para o telefone em geral).
create table public.external_numbers (
  id text primary key default ('external_number_' || gen_random_uuid()::text),
  -- Sempre a forma canônica COM código do país (55 + DDD + 8/9 dígitos = 12/13
  -- caracteres), igual à convenção de public.numbers.phone. Gerada no cliente
  -- via a mesma normalização de brazilianPhoneCandidates (nunca LIKE/substring).
  phone_normalized text not null check (phone_normalized ~ '^55[0-9]{10,11}$'),
  reason text not null default 'NUMBER_NOT_OWNED' check (reason in ('NUMBER_NOT_OWNED')),
  classified_by uuid references public.profiles(id) on delete set null,
  classified_at timestamptz not null default now(),
  reverted_by uuid references public.profiles(id) on delete set null,
  reverted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index external_numbers_phone_idx on public.external_numbers (phone_normalized);
-- No máximo UMA classificação ATIVA (não revertida) por telefone.
create unique index external_numbers_active_per_phone_uidx
  on public.external_numbers (phone_normalized) where reverted_at is null;

alter table public.external_numbers enable row level security;
create policy external_numbers_select on public.external_numbers
  for select to authenticated using (public.current_profile_is_active());
-- Mesmo tier de escrita operacional já usado em numbers/campaigns/incidents
-- (MASTER/ADMIN/USER podem escrever; VIEWER nunca). Não inventa cargo novo.
create policy external_numbers_insert on public.external_numbers
  for insert to authenticated with check (public.current_access_level() in ('MASTER','ADMIN','USER'));
create policy external_numbers_update on public.external_numbers
  for update to authenticated
  using (public.current_access_level() in ('MASTER','ADMIN','USER'))
  with check (public.current_access_level() in ('MASTER','ADMIN','USER'));
grant select, insert, update on public.external_numbers to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Novo processing_status: evento reconhecido como telefone que não
--    pertence à operação (manual ou automático via memória de externos).
-- ---------------------------------------------------------------------------
alter table public.integration_events drop constraint if exists integration_events_processing_status_check;
alter table public.integration_events add constraint integration_events_processing_status_check
  check (processing_status in ('RECEIVED','MATCHED','PENDING_ASSOCIATION','IGNORED','ERROR','LINKED_TO_INCIDENT','IGNORED_NOT_OWNED'));

-- ---------------------------------------------------------------------------
-- 3. RLS: permitir que o FRONTEND (usuário autenticado, não a Edge Function)
--    resolva um PENDING_ASSOCIATION — either marcando como "não pertence" ou
--    associando um número já cadastrado e completando o pipeline existente
--    (campanha -> classificação -> ocorrência). Nenhuma outra transição é
--    permitida por esta policy: USING trava a linha de origem (só quem
--    ainda está PENDING_ASSOCIATION ou já virou MATCHED por esta mesma ação
--    pode ser tocado), WITH CHECK trava o destino possível.
--    incidents/history_events já são graváveis por MASTER/ADMIN/USER desde
--    as migrations 002/009 — nenhuma policy nova é necessária lá.
-- ---------------------------------------------------------------------------
create policy integration_events_manual_resolution_update on public.integration_events
  for update to authenticated
  using (
    public.current_access_level() in ('MASTER','ADMIN','USER')
    and processing_status in ('PENDING_ASSOCIATION','MATCHED')
  )
  with check (
    public.current_access_level() in ('MASTER','ADMIN','USER')
    and processing_status in ('IGNORED_NOT_OWNED','MATCHED','LINKED_TO_INCIDENT')
  );
grant update on public.integration_events to authenticated;

commit;
