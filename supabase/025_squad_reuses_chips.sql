-- Squad passa a poder declarar se reutiliza chips entre clientes (padrão, a maioria dos
-- squads) ou se opera no modelo "exclusivo" (chips dedicados, 3-4 por cliente). Usado para
-- decidir se o relatório de "número associado ao cliente mas sem campanha ativa"
-- (CampaignsService.findClientCampaignGaps) deve ser mostrado para os clientes daquele
-- squad — só faz sentido no modelo exclusivo; no reuso normal de chips isso é esperado,
-- não é uma lacuna.
begin;

alter table public.squads
  add column if not exists reuses_chips boolean not null default true;

-- Único squad hoje no modelo exclusivo (chips dedicados por cliente). No-op se não
-- existir nenhum squad com esse nome.
update public.squads set reuses_chips = false where name = 'Exclusiva';

commit;
