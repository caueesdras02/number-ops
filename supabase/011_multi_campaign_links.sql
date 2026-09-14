-- Incremental, não destrutiva. Permite que um número tenha vínculos ativos com
-- VÁRIAS campanhas simultaneamente (antes: no máximo 1 vínculo ativo por número,
-- em qualquer campanha). Continua impedindo vínculo ativo duplicado para o
-- MESMO par número+campanha.
begin;

drop index if exists public.number_campaign_links_one_active_per_number_uidx;

create unique index if not exists number_campaign_links_one_active_per_pair_uidx
  on public.number_campaign_links (number_id, campaign_id)
  where ended_at is null;

commit;
