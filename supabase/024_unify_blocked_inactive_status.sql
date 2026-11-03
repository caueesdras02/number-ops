-- Unifica os status BLOCKED e INACTIVE em um só (BLOCKED), que passa a significar sempre
-- "arquivado, nunca mais será usado" — sai da listagem principal e só aparece na aba
-- Arquivados. Antes, BLOCKED e INACTIVE eram dois status distintos que já se comportavam
-- de forma idêntica em toda a lógica do app (ambos contam como indisponível/fora de
-- operação); e um número podia ficar BLOCKED sem estar arquivado, aparecendo misturado na
-- listagem principal com um "×" de atenção — isso não existe mais: BLOCKED agora sempre
-- implica archived_at preenchido.
begin;

-- 1) Numbers já INACTIVE viram BLOCKED.
update public.numbers set status = 'BLOCKED' where status = 'INACTIVE';

-- 2) Numbers que já eram BLOCKED mas não estavam arquivados (o estado antigo "flagueado,
--    mas ainda na listagem") passam a ser arquivados também, pra bater com a nova regra.
update public.numbers set archived_at = now(), updated_at = now() where status = 'BLOCKED' and archived_at is null;

-- 3) Atualiza a constraint de status, removendo INACTIVE (descoberta via catálogo, mesmo
--    padrão defensivo das migrations 022/023, pra não assumir um nome fixo).
do $$
declare
  check_name text;
begin
  select con.conname into check_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'numbers'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%status%in%';

  if check_name is null then
    raise exception 'Constraint de check em numbers.status não encontrada';
  end if;

  execute format('alter table public.numbers drop constraint %I', check_name);
  execute $sql$alter table public.numbers
    add constraint numbers_status_check
    check (status in ('ACTIVE','WARMING','UNDER_REVIEW','BLOCKED'))$sql$;
end $$;

commit;
