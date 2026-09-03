begin;

drop policy if exists number_clients_delete on public.number_clients;
create policy number_clients_delete on public.number_clients
for delete to authenticated
using (public.current_access_level() in ('ADMIN','USER'));

drop policy if exists number_squads_delete on public.number_squads;
create policy number_squads_delete on public.number_squads
for delete to authenticated
using (public.current_access_level() in ('ADMIN','USER'));

create or replace function public.registration_squads()
returns table(id text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select squads.id, squads.name
  from public.squads
  where squads.is_active
  order by squads.name;
$$;

revoke all on function public.registration_squads() from public;
grant execute on function public.registration_squads() to anon, authenticated;

commit;
