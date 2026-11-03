-- Bug pré-existente (não introduzido pela 022): o FK de history_events.number_id estava
-- "on delete restrict", mas o client (models/hard-delete.js) sempre tratou histórico como
-- EFEITO da exclusão definitiva, não como bloqueio — describeReferences() nunca lista
-- historyEvents em `blockers`, e applyLocalHardDelete() já remove os eventos do número
-- localmente. Como praticamente todo número tem ao menos o evento "NUMBER_CREATED", esse
-- descompasso client/banco impedia a exclusão definitiva de praticamente qualquer número
-- (erro: "update or delete on table numbers violates foreign key constraint
-- history_events_number_id_fkey"). Troca para "on delete cascade" pra bater com o
-- comportamento que o client já assume.
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
    and tc.table_name = 'history_events'
    and tc.constraint_type = 'FOREIGN KEY'
    and kcu.column_name = 'number_id';

  if fk_name is null then
    raise exception 'FK de history_events.number_id não encontrada';
  end if;

  execute format('alter table public.history_events drop constraint %I', fk_name);
  execute 'alter table public.history_events
    add constraint history_events_number_id_fkey
    foreign key (number_id) references public.numbers(id) on delete cascade';
end $$;

commit;
