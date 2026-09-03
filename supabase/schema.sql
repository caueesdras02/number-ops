begin;

create extension if not exists pgcrypto;

create type public.profile_job_title as enum ('ANALYST', 'ACCOUNT_MANAGER');
create type public.profile_status as enum ('ACTIVE', 'INACTIVE');
create type public.access_level as enum ('ADMIN', 'USER', 'VIEWER');
create type public.campaign_status as enum ('ACTIVE', 'CLOSED');
create type public.campaign_role as enum ('PRIMARY', 'BACKUP', 'SUPPORT');

create table public.squads (
  id text primary key,
  name text not null check (btrim(name) <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  email text not null,
  job_title public.profile_job_title not null,
  squad_id text references public.squads(id) on delete set null,
  status public.profile_status not null default 'ACTIVE',
  access_level public.access_level not null default 'USER',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_lower_uidx on public.profiles (lower(email));
create index profiles_squad_idx on public.profiles (squad_id);

create table public.clients (
  id text primary key,
  name text not null check (btrim(name) <> ''),
  squad_id text references public.squads(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clients_squad_idx on public.clients (squad_id);

create table public.responsibles (
  id text primary key,
  name text not null check (btrim(name) <> ''),
  team text not null default '',
  profile_id uuid references public.profiles(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.locations (
  id text primary key,
  name text not null check (btrim(name) <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.numbers (
  id text primary key,
  phone text not null unique check (phone ~ '^55[0-9]{10,11}$'),
  identification text not null default '',
  status text not null check (status in ('ACTIVE','WARMING','UNDER_REVIEW','BLOCKED','INACTIVE')),
  location_id text references public.locations(id) on delete set null,
  responsible_id text references public.responsibles(id) on delete set null,
  group_count integer not null default 0 check (group_count >= 0),
  notes text not null default '',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index numbers_status_idx on public.numbers (status);
create index numbers_location_idx on public.numbers (location_id);
create index numbers_responsible_idx on public.numbers (responsible_id);

create table public.number_clients (
  number_id text not null references public.numbers(id) on delete cascade,
  client_id text not null references public.clients(id) on delete cascade,
  primary key (number_id, client_id)
);

create table public.number_squads (
  number_id text not null references public.numbers(id) on delete cascade,
  squad_id text not null references public.squads(id) on delete cascade,
  primary key (number_id, squad_id)
);

create table public.campaigns (
  id text primary key,
  name text not null check (btrim(name) <> ''),
  client_id text not null references public.clients(id) on delete restrict,
  squad_id text not null references public.squads(id) on delete restrict,
  notes text not null default '',
  status public.campaign_status not null default 'ACTIVE',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'ACTIVE' and ended_at is null) or (status = 'CLOSED' and ended_at is not null))
);
create index campaigns_client_idx on public.campaigns (client_id);
create index campaigns_squad_idx on public.campaigns (squad_id);
create index campaigns_status_idx on public.campaigns (status);

create table public.number_campaign_links (
  id text primary key,
  number_id text not null references public.numbers(id) on delete restrict,
  campaign_id text not null references public.campaigns(id) on delete restrict,
  role public.campaign_role not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index number_campaign_links_number_idx on public.number_campaign_links (number_id);
create index number_campaign_links_campaign_idx on public.number_campaign_links (campaign_id);
create unique index number_campaign_links_one_active_per_number_uidx on public.number_campaign_links (number_id) where ended_at is null;

create table public.incidents (
  id text primary key,
  number_id text not null references public.numbers(id) on delete restrict,
  type text not null,
  title text not null check (btrim(title) <> ''),
  description text not null default '',
  status text not null check (status in ('OPEN','RESOLVED')),
  responsible_id text references public.responsibles(id) on delete set null,
  resolution_notes text not null default '',
  resolved_by_id text references public.responsibles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index incidents_number_idx on public.incidents (number_id);
create index incidents_status_idx on public.incidents (status);

create table public.restrictions (
  id text primary key default ('restriction_' || gen_random_uuid()::text),
  number_id text not null references public.numbers(id) on delete cascade,
  kind text not null,
  description text not null default '',
  recorded_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index restrictions_number_idx on public.restrictions (number_id);
create unique index restrictions_one_active_per_number_uidx on public.restrictions (number_id) where ended_at is null;

create table public.history_events (
  id text primary key,
  number_id text not null references public.numbers(id) on delete restrict,
  type text not null,
  description text not null,
  previous_value jsonb,
  new_value jsonb,
  metadata jsonb,
  actor_id uuid references public.profiles(id) on delete set null default auth.uid(),
  occurred_at timestamptz not null default now()
);
create index history_events_number_occurred_idx on public.history_events (number_id, occurred_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  previous_data jsonb,
  new_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index audit_logs_user_idx on public.audit_logs (user_id);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_occurred_idx on public.audit_logs (occurred_at desc);

create or replace function public.current_profile_is_active()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and status = 'ACTIVE') $$;

create or replace function public.current_access_level()
returns public.access_level language sql stable security definer set search_path = public
as $$ select access_level from public.profiles where id = auth.uid() and status = 'ACTIVE' $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare requested_squad text;
begin
  requested_squad := nullif(new.raw_user_meta_data ->> 'squad_id', '');
  if requested_squad is not null and not exists(select 1 from public.squads where id = requested_squad and is_active) then
    requested_squad := null;
  end if;
  insert into public.profiles(id, name, email, job_title, squad_id, status, access_level)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
    new.email,
    case when new.raw_user_meta_data ->> 'job_title' = 'ACCOUNT_MANAGER' then 'ACCOUNT_MANAGER'::public.profile_job_title else 'ANALYST'::public.profile_job_title end,
    requested_squad,
    'ACTIVE',
    'USER'
  );
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.numbers enable row level security;
alter table public.clients enable row level security;
alter table public.squads enable row level security;
alter table public.campaigns enable row level security;
alter table public.number_campaign_links enable row level security;
alter table public.number_clients enable row level security;
alter table public.number_squads enable row level security;
alter table public.responsibles enable row level security;
alter table public.locations enable row level security;
alter table public.incidents enable row level security;
alter table public.restrictions enable row level security;
alter table public.history_events enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_select on public.profiles for select to authenticated using (public.current_profile_is_active() and (id = auth.uid() or public.current_access_level() = 'ADMIN'));
create policy profiles_admin_update on public.profiles for update to authenticated using (public.current_access_level() = 'ADMIN') with check (public.current_access_level() = 'ADMIN');

do $$
declare table_name text;
begin
  foreach table_name in array array['numbers','clients','squads','campaigns','number_campaign_links','number_clients','number_squads','responsibles','locations','incidents','restrictions','history_events']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.current_profile_is_active())', table_name || '_select', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.current_access_level() in (''ADMIN'',''USER''))', table_name || '_insert', table_name);
    execute format('create policy %I on public.%I for update to authenticated using (public.current_access_level() in (''ADMIN'',''USER'')) with check (public.current_access_level() in (''ADMIN'',''USER''))', table_name || '_update', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using (public.current_access_level() = ''ADMIN'')', table_name || '_delete', table_name);
  end loop;
end $$;

create policy audit_logs_admin_select on public.audit_logs for select to authenticated using (public.current_access_level() = 'ADMIN');

revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;
grant select, insert, update, delete on public.numbers, public.clients, public.squads, public.campaigns, public.number_campaign_links, public.number_clients, public.number_squads, public.responsibles, public.locations, public.incidents, public.restrictions, public.history_events to authenticated;
grant select, update on public.profiles to authenticated;

commit;
