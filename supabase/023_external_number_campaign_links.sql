-- Incremental, não destrutiva. Permite vincular manualmente um número EXTERNO (que já foi
-- classificado como "não pertence à operação" em external_numbers) a uma Campanha JÁ EXISTENTE —
-- nunca cria Campanha, nunca cria um registro em public.numbers. Cliente e Squad são sempre
-- derivados da Campanha escolhida (campaigns.client_id/squad_id), nunca gravados aqui de novo.
--
-- Dados do alerta (telefone, empresa, conta do cliente) são desnormalizados na própria linha, no
-- momento do vínculo — mesmo espírito de incidents.title/description guardarem uma cópia fixa do
-- texto da criação: a tela da Campanha nunca precisa de um JOIN em external_numbers pra exibir.
begin;

create table public.external_number_campaign_links (
  id text primary key default ('external_campaign_link_' || gen_random_uuid()::text),
  external_number_id text not null references public.external_numbers(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  -- Mesma forma canônica de external_numbers.phone_normalized/public.numbers.phone.
  phone_normalized text not null check (phone_normalized ~ '^55[0-9]{10,11}$'),
  company_label text,        -- "Empresa" do alerta do Telegram, no momento do vínculo.
  client_account_label text, -- "Conta do Cliente" do alerta do Telegram, no momento do vínculo.
  linked_by uuid references public.profiles(id) on delete set null,
  linked_at timestamptz not null default now(),
  -- "Encerrar" preserva histórico (nunca apaga a linha) — mesmo padrão de ended_at já usado em
  -- number_campaign_links/restrictions/external_numbers (reverted_at).
  ended_by uuid references public.profiles(id) on delete set null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index external_number_campaign_links_campaign_idx on public.external_number_campaign_links (campaign_id);
create index external_number_campaign_links_external_idx on public.external_number_campaign_links (external_number_id);
-- No máximo UM vínculo ATIVO (não encerrado) por par número-externo/campanha — mesmo padrão do
-- índice parcial já usado em external_numbers_active_per_phone_uidx (016).
create unique index external_number_campaign_links_active_uidx
  on public.external_number_campaign_links (external_number_id, campaign_id) where ended_at is null;

alter table public.external_number_campaign_links enable row level security;
create policy external_number_campaign_links_select on public.external_number_campaign_links
  for select to authenticated using (public.current_profile_is_active());
-- Mesmo tier de escrita operacional já usado em numbers/campaigns/incidents/external_numbers
-- (MASTER/ADMIN/USER podem escrever; VIEWER nunca). Não inventa cargo novo.
create policy external_number_campaign_links_insert on public.external_number_campaign_links
  for insert to authenticated with check (public.current_access_level() in ('MASTER','ADMIN','USER'));
create policy external_number_campaign_links_update on public.external_number_campaign_links
  for update to authenticated
  using (public.current_access_level() in ('MASTER','ADMIN','USER'))
  with check (public.current_access_level() in ('MASTER','ADMIN','USER'));
grant select, insert, update on public.external_number_campaign_links to authenticated;

-- Sem trigger de auditoria: mesmo precedente de external_numbers/integration_events, explicitamente
-- fora de public.capture_number_ops_audit() (ver comentário em 018_campaign_stage.sql).

commit;
