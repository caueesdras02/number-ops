-- 019 — Cadastro por convite: só e-mails pré-autorizados por um MASTER podem
-- concluir o signup no Number Ops. Incremental e não destrutiva.
--
-- Não afeta usuários já existentes: o gate só roda dentro do trigger
-- on_auth_user_created (INSERT em auth.users), disparado exclusivamente por
-- NOVOS cadastros. Login, sessão e RLS de quem já tem profile continuam
-- exatamente como estão.
--
-- Reaproveita public.current_is_master() (definida em 009) para as políticas
-- e o padrão já usado em registration_squads() (002) para a RPC pública de
-- verificação (security definer, devolve o mínimo possível, nunca a lista).
begin;

-- ---------------------------------------------------------------------------
-- 1. Tabela de autorizações
-- ---------------------------------------------------------------------------
create table if not exists public.signup_authorizations (
  id text primary key,
  email text not null check (btrim(email) <> ''),
  access_level public.access_level not null default 'USER',
  squad_id text references public.squads(id) on delete set null,
  status text not null default 'PENDING' check (status in ('PENDING','USED','REVOKED')),
  created_by uuid references public.profiles(id) on delete set null,
  used_by uuid references public.profiles(id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Só pode haver UMA autorização pendente por e-mail ao mesmo tempo (evita
-- ambiguidade sobre qual nível/squad vale). Depois de usada ou revogada, o
-- mesmo e-mail pode ser autorizado de novo (novo convite).
create unique index if not exists signup_authorizations_email_pending_uidx
  on public.signup_authorizations (lower(email)) where status = 'PENDING';
create index if not exists signup_authorizations_email_idx on public.signup_authorizations (lower(email));
create index if not exists signup_authorizations_status_idx on public.signup_authorizations (status);
create index if not exists signup_authorizations_squad_idx on public.signup_authorizations (squad_id);

-- ---------------------------------------------------------------------------
-- 2. RLS — só MASTER enxerga/gerencia a tabela. Nunca exposta a anon ou a
--    ADMIN/USER/VIEWER (mais restrita que o resto do app: lá ADMIN também
--    administra Usuários, aqui não).
-- ---------------------------------------------------------------------------
alter table public.signup_authorizations enable row level security;

drop policy if exists signup_authorizations_master_select on public.signup_authorizations;
create policy signup_authorizations_master_select on public.signup_authorizations
for select to authenticated using (public.current_is_master());

drop policy if exists signup_authorizations_master_insert on public.signup_authorizations;
create policy signup_authorizations_master_insert on public.signup_authorizations
for insert to authenticated with check (public.current_is_master());

drop policy if exists signup_authorizations_master_update on public.signup_authorizations;
create policy signup_authorizations_master_update on public.signup_authorizations
for update to authenticated using (public.current_is_master()) with check (public.current_is_master());

-- Sem policy de delete: revogar é status='REVOKED' via update, preservando
-- histórico/auditoria de quem autorizou o quê.
revoke all on public.signup_authorizations from anon, authenticated;
grant select, insert, update on public.signup_authorizations to authenticated;

-- ---------------------------------------------------------------------------
-- 3. RPC de verificação — usada pelo formulário de cadastro (anon, antes de
--    haver sessão). Devolve só um boolean para o e-mail informado: nunca a
--    lista de e-mails autorizados, nunca o nível de acesso ou squad.
-- ---------------------------------------------------------------------------
create or replace function public.check_signup_authorization(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.signup_authorizations
    where lower(email) = lower(btrim(coalesce(p_email, ''))) and status = 'PENDING'
  );
$$;

revoke all on function public.check_signup_authorization(text) from public;
grant execute on function public.check_signup_authorization(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Gate real: handle_new_user passa a exigir uma autorização PENDING
--    válida para o e-mail. Sem ela, a função levanta exceção — como o
--    trigger roda AFTER INSERT em auth.users, a exceção reverte a transação
--    inteira, incluindo o próprio INSERT em auth.users. Isso bloqueia tanto
--    o formulário quanto qualquer chamada direta ao Supabase Auth
--    (signUp da API pública, Admin API, etc.) — não é só uma checagem de
--    frontend.
--
--    squad_id do cadastro deixa de vir de raw_user_meta_data (o usuário não
--    escolhe mais) — vem exclusivamente da autorização, com o mesmo
--    fallback defensivo do original (squad precisa existir e estar ativo).
--    access_level nunca é derivado do metadata enviado pelo cliente — só da
--    autorização, então não há como o usuário se autopromover no cadastro.
--
--    SELECT ... FOR UPDATE trava a linha da autorização até o fim da
--    transação: duas tentativas de cadastro concorrentes para o mesmo
--    e-mail serializam — a segunda só enxerga o status='USED' já commitado
--    pela primeira e é bloqueada (reutilização impossível).
-- ---------------------------------------------------------------------------
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
    case when new.raw_user_meta_data ->> 'job_title' = 'ACCOUNT_MANAGER' then 'ACCOUNT_MANAGER'::public.profile_job_title else 'ANALYST'::public.profile_job_title end,
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
