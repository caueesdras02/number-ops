-- Incremental, não destrutiva. Prepara public.incidents para também servir
-- de "acompanhamento" para eventos automáticos da integração (Telegram),
-- reaproveitando a estrutura de Ocorrências já existente — NENHUMA tabela
-- nova é criada para isso, nenhum dado existente é alterado/apagado.
--
-- Bloco 2 da V3 (classificação/acompanhamento). Continua sem tocar em regras
-- operacionais: nenhuma trigger/coluna aqui altera numbers.status, restriction,
-- utilização ou number_campaign_links. `incidents` já é escrito hoje só pelo
-- fluxo manual (IngestionsService via frontend); esta migration só adiciona
-- colunas opcionais para também poder representar um registro criado pela
-- integração, sem mudar o comportamento de nenhum registro existente:
-- `origin` recebe DEFAULT 'MANUAL' e faz backfill de todas as linhas atuais
-- (todas foram, de fato, criadas manualmente até aqui).
begin;

alter table public.incidents
  add column if not exists campaign_id text references public.campaigns(id) on delete set null,
  add column if not exists origin text not null default 'MANUAL' check (origin in ('MANUAL','TELEGRAM_BOT')),
  -- CONNECTIVITY: alerta de desconexão/infraestrutura (evidência hoje disponível).
  -- CONFIRMED_RESTRICTION: reservado para quando houver critério objetivo de queda/bloqueio real — não usado ainda.
  -- INDETERMINATE: reservado para evento existente mas sem informação suficiente para classificar — não usado ainda.
  add column if not exists classification text check (classification in ('CONNECTIVITY','CONFIRMED_RESTRICTION','INDETERMINATE')),
  add column if not exists integration_event_id text references public.integration_events(id) on delete set null;

create index if not exists incidents_campaign_idx on public.incidents (campaign_id);
create index if not exists incidents_origin_idx on public.incidents (origin);

-- Idempotência ao nível de dado: o MESMO integration_event nunca pode ficar
-- ligado a mais de uma ocorrência (reforça, no banco, a regra que o código
-- da Edge Function já aplica). Isto identifica a ocorrência de ORIGEM de um
-- evento — não impede que OUTROS integration_events também se vinculem à
-- mesma ocorrência depois (ver índice seguinte); esses usam
-- integration_events.linked_incident_id, uma FK comum sem exigência de
-- unicidade, já que vários eventos podem legitimamente apontar para a
-- mesma ocorrência.
create unique index if not exists incidents_integration_event_uidx
  on public.incidents (integration_event_id) where integration_event_id is not null;

-- Consolidação por número: nunca mais de UMA ocorrência CONNECTIVITY/
-- TELEGRAM_BOT aberta ao mesmo tempo para o mesmo número. Garante no banco
-- (inclusive sob concorrência) a regra "alertas consecutivos do mesmo número,
-- enquanto a ocorrência anterior continuar OPEN, pertencem ao mesmo
-- acompanhamento" — sem depender só do check-then-act da Edge Function.
-- Deixa de valer automaticamente quando a ocorrência for RESOLVED (o filtro
-- `where status = 'OPEN'` exclui a linha do índice), permitindo uma nova
-- ocorrência para o mesmo número depois disso.
create unique index if not exists incidents_open_connectivity_per_number_uidx
  on public.incidents (number_id)
  where classification = 'CONNECTIVITY' and origin = 'TELEGRAM_BOT' and status = 'OPEN';

commit;
