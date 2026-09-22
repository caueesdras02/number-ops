-- 021 — handle_new_user passa a reconhecer 'OTHER' ("Outro") como cargo no
-- cadastro. Cópia de 019 + só o case do job_title muda (de 2 pra 3 ramos).
-- Incremental e não destrutiva. Aplique DEPOIS de
-- 020_profile_job_title_other.sql (o valor de enum precisa já existir).
begin;

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

commit;
