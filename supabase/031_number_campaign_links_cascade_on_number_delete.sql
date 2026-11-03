-- A exclusão definitiva de um número (MASTER) só deve ser bloqueada por vínculo de
-- campanha ATIVO (regra aplicada no client, models/hard-delete.js). Até aqui, o FK abaixo
-- era "on delete restrict" para QUALQUER vínculo — inclusive já encerrado — o que impedia
-- a exclusão definitiva para sempre de qualquer número que já tivesse passado por uma
-- campanha, mesmo com o vínculo terminado há tempos. Troca para "on delete cascade": os
-- vínculos encerrados (já validados como não-bloqueantes no client) são removidos junto
-- quando o número é apagado de vez.
--
-- Descobre o nome real da constraint via catálogo em vez de assumir o nome padrão do
-- Postgres, pra não falhar silenciosamente se ela tiver sido criada com outro nome.
begin;

do $$
declare
  fk_name text;
begin
  select tc.constraint_name into fk_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = 'number_campaign_links'
    and tc.constraint_type = 'FOREIGN KEY'
    and kcu.column_name = 'number_id';

  if fk_name is null then
    raise exception 'FK de number_campaign_links.number_id não encontrada';
  end if;

  execute format('alter table public.number_campaign_links drop constraint %I', fk_name);
  execute 'alter table public.number_campaign_links
    add constraint number_campaign_links_number_id_fkey
    foreign key (number_id) references public.numbers(id) on delete cascade';
end $$;

commit;
