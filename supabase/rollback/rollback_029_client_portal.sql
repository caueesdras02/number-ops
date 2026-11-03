-- ROLLBACK de 029 (Portal do cliente). NÃO faz parte da sequência de migrations — só rode
-- se precisar desfazer o acesso de cliente.
--
-- Devolve as policies e a função de cadastro exatamente como eram (017 + 021), e remove as
-- funções do portal. Não apaga dados: as colunas client_id ficam (só deixam de ser usadas).
-- O valor 'CLIENT' do enum (028) não pode ser removido no Postgres — sem 029, um usuário
-- CLIENT não lê nada operacional (nenhuma policy o inclui e o portal deixa de existir).
begin;

drop function if exists public.client_portal(text);

alter policy locations_select on public.locations using (public.current_profile_is_active());

alter policy push_subscriptions_own_insert on public.push_subscriptions
  with check (profile_id = auth.uid());
alter policy push_subscriptions_own_update on public.push_subscriptions
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

alter table public.profiles drop constraint if exists profiles_client_access_check;
alter table public.signup_authorizations drop constraint if exists signup_authorizations_client_access_check;

-- handle_new_user idêntica à de 021.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_access_level public.access_level;
  v_squad_id text;
begin
  select access_level, squad_id into v_access_level, v_squad_id
  from public.signup_authorizations
  where lower(email) = lower(new.email) and status = 'PENDING'
  for update;

  if not found then
    raise exception 'E-mail não autorizado a se cadastrar no Number Ops.' using errcode = '28000';
  end if;

  if v_squad_id is not null and not exists(select 1 from public.squads where id = v_squad_id and is_active) then
    v_squad_id := null;
  end if;

  insert into public.profiles(id, name, email, job_title, squad_id, status, access_level)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
    new.email,
    case new.raw_user_meta_data ->> 'job_title'
      when 'ACCOUNT_MANAGER' then 'ACCOUNT_MANAGER'::public.profile_job_title
      when 'OTHER' then 'OTHER'::public.profile_job_title
      else 'ANALYST'::public.profile_job_title
    end,
    v_squad_id,
    'ACTIVE',
    v_access_level
  );

  update public.signup_authorizations
     set status = 'USED', used_by = new.id, used_at = now(), updated_at = now()
   where lower(email) = lower(new.email) and status = 'PENDING';

  return new;
end;
$$;

drop function if exists public.current_client_id();

commit;
