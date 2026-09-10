-- 009 — Permissões do MASTER, proteção do último MASTER, colaborador->squad,
-- auditoria de exclusão definitiva, promoção do MASTER inicial e remoção do
-- usuário de teste. Incremental e não destrutivo (o único DELETE é o usuário de
-- teste explicitamente pedido). Aplique DEPOIS de 008_master_access_level.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.current_is_master()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(
  select 1 from public.profiles
  where id = auth.uid() and status = 'ACTIVE' and access_level = 'MASTER'
) $$;

create or replace function public.active_master_count()
returns integer language sql stable security definer set search_path = public
as $$ select count(*)::int from public.profiles
      where access_level = 'MASTER' and status = 'ACTIVE' $$;

revoke all on function public.current_is_master() from public, anon;
revoke all on function public.active_master_count() from public, anon;
grant execute on function public.current_is_master() to authenticated;
grant execute on function public.active_master_count() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Colaborador -> Squad (FK real; mantém a coluna `team` legada)
-- ---------------------------------------------------------------------------
alter table public.responsibles
  add column if not exists squad_id text references public.squads(id) on delete set null;
create index if not exists responsibles_squad_idx on public.responsibles (squad_id);

update public.responsibles r
set squad_id = s.id
from public.squads s
where r.squad_id is null
  and btrim(coalesce(r.team, '')) <> ''
  and lower(btrim(r.team)) = lower(btrim(s.name));

-- ---------------------------------------------------------------------------
-- 3. Promoção do MASTER inicial (antes de criar o trigger de proteção)
-- ---------------------------------------------------------------------------
do $$
declare v_count int;
begin
  update public.profiles
     set access_level = 'MASTER', updated_at = now()
   where lower(email) = lower('caueworkspace@gmail.com');
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise notice '009: nenhum profile com e-mail caueworkspace@gmail.com — promova o MASTER manualmente.';
  elsif v_count > 1 then
    raise exception '009: mais de um profile com o e-mail caueworkspace@gmail.com (%).', v_count;
  else
    raise notice '009: caueworkspace@gmail.com promovido a MASTER.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Remoção do usuário de teste (match EXATO por e-mail; antes do trigger)
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower('acaccacac@gmail.com');
  if v_id is null then
    raise notice '009: usuario de teste acaccacac@gmail.com nao encontrado em auth.users.';
  else
    -- FKs para este usuario sao "on delete set null" (history_events.actor_id,
    -- audit_logs.user_id, responsibles.profile_id). profiles cai por cascata.
    delete from auth.users where id = v_id;
    raise notice '009: usuario de teste acaccacac@gmail.com removido.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Políticas: MASTER pode tudo que ADMIN/USER podem escrever
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['numbers','clients','squads','campaigns','number_campaign_links',
                           'number_clients','number_squads','responsibles','locations',
                           'incidents','restrictions','history_events']
  loop
    execute format(
      'alter policy %I on public.%I with check (public.current_access_level() in (''MASTER'',''ADMIN'',''USER''))',
      t || '_insert', t);
    execute format(
      'alter policy %I on public.%I using (public.current_access_level() in (''MASTER'',''ADMIN'',''USER'')) with check (public.current_access_level() in (''MASTER'',''ADMIN'',''USER''))',
      t || '_update', t);
  end loop;
end $$;

-- Exclusão definitiva: SOMENTE MASTER (as joins number_clients/number_squads
-- continuam ADMIN/USER — é edição de relação, não exclusão de registro).
do $$
declare t text;
begin
  foreach t in array array['numbers','clients','squads','campaigns','number_campaign_links',
                           'responsibles','locations','incidents','restrictions','history_events']
  loop
    execute format('alter policy %I on public.%I using (public.current_is_master())', t || '_delete', t);
  end loop;
end $$;

drop policy if exists number_clients_delete on public.number_clients;
create policy number_clients_delete on public.number_clients
for delete to authenticated
using (public.current_access_level() in ('MASTER','ADMIN','USER'));

drop policy if exists number_squads_delete on public.number_squads;
create policy number_squads_delete on public.number_squads
for delete to authenticated
using (public.current_access_level() in ('MASTER','ADMIN','USER'));

-- profiles: MASTER enxerga todos; MASTER e ADMIN podem atualizar (regra fina no trigger);
-- só MASTER exclui.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (public.current_profile_is_active() and (id = auth.uid() or public.current_access_level() in ('ADMIN','MASTER')));

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
using (public.current_access_level() in ('ADMIN','MASTER'))
with check (public.current_access_level() in ('ADMIN','MASTER'));

drop policy if exists profiles_master_delete on public.profiles;
create policy profiles_master_delete on public.profiles for delete to authenticated
using (public.current_is_master());

drop policy if exists audit_logs_admin_select on public.audit_logs;
create policy audit_logs_admin_select on public.audit_logs for select to authenticated
using (public.current_access_level() in ('ADMIN','MASTER'));

grant delete on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Trigger de proteção de profiles (só MASTER mexe em access_level / em MASTER;
--    último MASTER ativo protegido). Bypass quando não há usuário autenticado
--    (migrations / service_role).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_profile_rules()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_is_master boolean := coalesce(public.current_access_level() = 'MASTER', false);
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if not v_is_master then
      raise exception 'Apenas MASTER pode excluir usuarios definitivamente.';
    end if;
    if old.access_level = 'MASTER' and old.status = 'ACTIVE'
       and (select count(*) from public.profiles
            where access_level = 'MASTER' and status = 'ACTIVE' and id <> old.id) = 0 then
      raise exception 'Nao e possivel excluir o ultimo MASTER ativo.';
    end if;
    return old;
  end if;

  if old.access_level is distinct from new.access_level and not v_is_master then
    raise exception 'Apenas MASTER pode alterar o nivel de acesso.';
  end if;

  if old.access_level = 'MASTER' and not v_is_master
     and row(new.name, new.email, new.job_title, new.squad_id, new.status, new.access_level)
         is distinct from row(old.name, old.email, old.job_title, old.squad_id, old.status, old.access_level) then
    raise exception 'Apenas MASTER pode alterar um usuario MASTER.';
  end if;

  if old.access_level = 'MASTER' and old.status = 'ACTIVE'
     and (new.access_level <> 'MASTER' or new.status <> 'ACTIVE')
     and (select count(*) from public.profiles
          where access_level = 'MASTER' and status = 'ACTIVE' and id <> old.id) = 0 then
    raise exception 'O sistema precisa de pelo menos um MASTER ativo.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_profile_rules() from public, anon, authenticated;

drop trigger if exists enforce_profile_rules on public.profiles;
create trigger enforce_profile_rules before update or delete on public.profiles
for each row execute function public.enforce_profile_rules();

-- ---------------------------------------------------------------------------
-- 7. Auditoria: registrar exclusão definitiva (branches DELETE).
--    Cópia da função de 007 + os novos ramos DELETE. Triggers já existem
--    (after insert or update or delete) desde 003/007 — só a função muda.
-- ---------------------------------------------------------------------------
create or replace function public.capture_number_ops_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_metadata jsonb;
  v_previous_link public.number_campaign_links%rowtype;
  v_has_previous_link boolean := false;
begin
  if tg_op='INSERT' then v_old:=null;v_new:=to_jsonb(new);
  elsif tg_op='DELETE' then v_old:=to_jsonb(old);v_new:=null;
  else v_old:=to_jsonb(old);v_new:=to_jsonb(new);
  end if;

  v_metadata:=jsonb_strip_nulls(jsonb_build_object(
    'source','database_trigger',
    'numberId',coalesce(v_new->>'number_id',v_old->>'number_id',v_new->>'id',v_old->>'id'),
    'campaignId',coalesce(v_new->>'campaign_id',v_old->>'campaign_id'),
    'clientId',coalesce(v_new->>'client_id',v_old->>'client_id'),
    'squadId',coalesce(v_new->>'squad_id',v_old->>'squad_id')
  ));

  if tg_table_name='numbers' then
    if tg_op='INSERT' then
      perform public.append_audit_log('NUMBER_CREATED','NUMBER',new.id,null,to_jsonb(new),v_metadata);
    elsif tg_op='DELETE' then
      perform public.append_audit_log('NUMBER_DELETED','NUMBER',old.id,to_jsonb(old),null,v_metadata);
    elsif tg_op='UPDATE' then
      if old.archived_at is distinct from new.archived_at then
        perform public.append_audit_log(case when new.archived_at is null then 'NUMBER_RESTORED' else 'NUMBER_ARCHIVED' end,'NUMBER',new.id,jsonb_build_object('status',old.status,'archivedAt',old.archived_at),jsonb_build_object('status',new.status,'archivedAt',new.archived_at),v_metadata);
      elsif old.status is distinct from new.status then
        perform public.append_audit_log('NUMBER_STATUS_CHANGED','NUMBER',new.id,jsonb_build_object('status',old.status),jsonb_build_object('status',new.status),v_metadata);
      end if;
      if old.responsible_id is distinct from new.responsible_id then
        perform public.append_audit_log('NUMBER_RESPONSIBLE_CHANGED','NUMBER',new.id,jsonb_build_object('responsibleId',old.responsible_id),jsonb_build_object('responsibleId',new.responsible_id),v_metadata);
      end if;
      if old.location_id is distinct from new.location_id then
        perform public.append_audit_log('NUMBER_LOCATION_CHANGED','NUMBER',new.id,jsonb_build_object('locationId',old.location_id),jsonb_build_object('locationId',new.location_id),v_metadata);
      end if;
      if old.group_count is distinct from new.group_count then
        perform public.append_audit_log('NUMBER_GROUP_COUNT_CHANGED','NUMBER',new.id,jsonb_build_object('groupCount',old.group_count),jsonb_build_object('groupCount',new.group_count),v_metadata);
      end if;
      if row(old.phone,old.identification,old.notes) is distinct from row(new.phone,new.identification,new.notes) then
        perform public.append_audit_log('NUMBER_UPDATED','NUMBER',new.id,to_jsonb(old),to_jsonb(new),v_metadata);
      end if;
    end if;

  elsif tg_table_name='restrictions' then
    if tg_op='INSERT' then
      perform public.append_audit_log('NUMBER_RESTRICTION_ADDED','NUMBER',new.number_id,null,to_jsonb(new),v_metadata||jsonb_build_object('restrictionId',new.id));
    elsif tg_op='UPDATE' and old.ended_at is null and new.ended_at is not null then
      perform public.append_audit_log('NUMBER_RESTRICTION_REMOVED','NUMBER',new.number_id,to_jsonb(old),to_jsonb(new),v_metadata||jsonb_build_object('restrictionId',new.id));
    elsif tg_op='UPDATE' and old.ended_at is not null and new.ended_at is null then
      perform public.append_audit_log('NUMBER_RESTRICTION_ADDED','NUMBER',new.number_id,to_jsonb(old),to_jsonb(new),v_metadata||jsonb_build_object('restrictionId',new.id));
    elsif tg_op='UPDATE' and row(old.kind,old.description) is distinct from row(new.kind,new.description) then
      perform public.append_audit_log('NUMBER_RESTRICTION_UPDATED','NUMBER',new.number_id,to_jsonb(old),to_jsonb(new),v_metadata||jsonb_build_object('restrictionId',new.id));
    end if;

  elsif tg_table_name='number_clients' then
    perform public.append_audit_log(case when tg_op='INSERT' then 'NUMBER_CLIENT_ASSOCIATED' else 'NUMBER_CLIENT_REMOVED' end,'NUMBER',coalesce(new.number_id,old.number_id),v_old,v_new,v_metadata);

  elsif tg_table_name='number_squads' then
    perform public.append_audit_log(case when tg_op='INSERT' then 'NUMBER_SQUAD_ASSOCIATED' else 'NUMBER_SQUAD_REMOVED' end,'NUMBER',coalesce(new.number_id,old.number_id),v_old,v_new,v_metadata);

  elsif tg_table_name='campaigns' then
    if tg_op='INSERT' then
      perform public.append_audit_log('CAMPAIGN_CREATED','CAMPAIGN',new.id,null,to_jsonb(new),v_metadata);
    elsif tg_op='DELETE' then
      perform public.append_audit_log('CAMPAIGN_DELETED','CAMPAIGN',old.id,to_jsonb(old),null,v_metadata);
    elsif tg_op='UPDATE' and old.status is distinct from new.status and new.status='CLOSED' then
      perform public.append_audit_log('CAMPAIGN_CLOSED','CAMPAIGN',new.id,to_jsonb(old),to_jsonb(new),v_metadata);
    elsif tg_op='UPDATE' and old.status is distinct from new.status and new.status='ACTIVE' then
      perform public.append_audit_log('CAMPAIGN_REACTIVATED','CAMPAIGN',new.id,to_jsonb(old),to_jsonb(new),v_metadata);
    elsif tg_op='UPDATE' and old.responsible_id is distinct from new.responsible_id then
      perform public.append_audit_log('CAMPAIGN_RESPONSIBLE_CHANGED','CAMPAIGN',new.id,jsonb_build_object('responsibleId',old.responsible_id),jsonb_build_object('responsibleId',new.responsible_id),v_metadata);
    elsif tg_op='UPDATE' and row(old.name,old.client_id,old.squad_id,old.notes,old.started_at) is distinct from row(new.name,new.client_id,new.squad_id,new.notes,new.started_at) then
      perform public.append_audit_log('CAMPAIGN_UPDATED','CAMPAIGN',new.id,to_jsonb(old),to_jsonb(new),v_metadata);
    end if;

  elsif tg_table_name='number_campaign_links' then
    if tg_op='INSERT' then
      select * into v_previous_link from public.number_campaign_links
      where number_id=new.number_id and id<>new.id and ended_at is not null
      order by ended_at desc limit 1;
      v_has_previous_link:=found;
      if v_has_previous_link and v_previous_link.campaign_id<>new.campaign_id then
        perform public.append_audit_log('NUMBER_CAMPAIGN_CHANGED','NUMBER',new.number_id,to_jsonb(v_previous_link),to_jsonb(new),v_metadata||jsonb_build_object('role',new.role));
      elsif v_has_previous_link and v_previous_link.campaign_id=new.campaign_id and v_previous_link.role<>new.role then
        perform public.append_audit_log('NUMBER_CAMPAIGN_ROLE_CHANGED','NUMBER',new.number_id,to_jsonb(v_previous_link),to_jsonb(new),v_metadata||jsonb_build_object('role',new.role));
      else
        perform public.append_audit_log('NUMBER_CAMPAIGN_LINKED','NUMBER',new.number_id,null,to_jsonb(new),v_metadata||jsonb_build_object('role',new.role));
      end if;
    elsif tg_op='UPDATE' then
      if old.campaign_id is distinct from new.campaign_id then
        perform public.append_audit_log('NUMBER_CAMPAIGN_CHANGED','NUMBER',new.number_id,to_jsonb(old),to_jsonb(new),v_metadata);
      end if;
      if old.role is distinct from new.role then
        perform public.append_audit_log('NUMBER_CAMPAIGN_ROLE_CHANGED','NUMBER',new.number_id,jsonb_build_object('role',old.role),jsonb_build_object('role',new.role),v_metadata);
      end if;
      if old.ended_at is null and new.ended_at is not null then
        perform public.append_audit_log('NUMBER_CAMPAIGN_LINK_ENDED','NUMBER',new.number_id,to_jsonb(old),to_jsonb(new),v_metadata);
      end if;
    end if;

  elsif tg_table_name='clients' then
    if tg_op='INSERT' then
      perform public.append_audit_log('CLIENT_CREATED','CLIENT',new.id,null,to_jsonb(new),v_metadata);
    elsif tg_op='DELETE' then
      perform public.append_audit_log('CLIENT_DELETED','CLIENT',old.id,to_jsonb(old),null,v_metadata);
    elsif tg_op='UPDATE' then
      if old.squad_id is distinct from new.squad_id then
        perform public.append_audit_log('CLIENT_SQUAD_CHANGED','CLIENT',new.id,jsonb_build_object('squadId',old.squad_id),jsonb_build_object('squadId',new.squad_id),v_metadata);
      end if;
      if row(old.name,old.is_active) is distinct from row(new.name,new.is_active) then
        perform public.append_audit_log('CLIENT_UPDATED','CLIENT',new.id,to_jsonb(old),to_jsonb(new),v_metadata);
      end if;
    end if;

  elsif tg_table_name='squads' then
    if tg_op='INSERT' then
      perform public.append_audit_log('SQUAD_CREATED','SQUAD',new.id,null,to_jsonb(new),v_metadata||jsonb_build_object('squadId',new.id));
    elsif tg_op='DELETE' then
      perform public.append_audit_log('SQUAD_DELETED','SQUAD',old.id,to_jsonb(old),null,v_metadata||jsonb_build_object('squadId',old.id));
    elsif tg_op='UPDATE' and row(old.name,old.is_active) is distinct from row(new.name,new.is_active) then
      perform public.append_audit_log('SQUAD_UPDATED','SQUAD',new.id,to_jsonb(old),to_jsonb(new),v_metadata||jsonb_build_object('squadId',new.id));
    end if;

  elsif tg_table_name='locations' then
    if tg_op='INSERT' then
      perform public.append_audit_log('LOCATION_CREATED','LOCATION',new.id,null,to_jsonb(new),v_metadata);
    elsif tg_op='DELETE' then
      perform public.append_audit_log('LOCATION_DELETED','LOCATION',old.id,to_jsonb(old),null,v_metadata);
    elsif tg_op='UPDATE' and row(old.name,old.is_active) is distinct from row(new.name,new.is_active) then
      perform public.append_audit_log('LOCATION_UPDATED','LOCATION',new.id,to_jsonb(old),to_jsonb(new),v_metadata);
    end if;

  elsif tg_table_name='responsibles' then
    if tg_op='INSERT' then
      perform public.append_audit_log('RESPONSIBLE_CREATED','RESPONSIBLE',new.id,null,to_jsonb(new),v_metadata);
    elsif tg_op='DELETE' then
      perform public.append_audit_log('RESPONSIBLE_DELETED','RESPONSIBLE',old.id,to_jsonb(old),null,v_metadata);
    elsif tg_op='UPDATE' then
      if old.team is distinct from new.team or old.squad_id is distinct from new.squad_id then
        perform public.append_audit_log('RESPONSIBLE_TEAM_CHANGED','RESPONSIBLE',new.id,jsonb_build_object('team',old.team,'squadId',old.squad_id),jsonb_build_object('team',new.team,'squadId',new.squad_id),v_metadata);
      end if;
      if row(old.name,old.is_active) is distinct from row(new.name,new.is_active) then
        perform public.append_audit_log('RESPONSIBLE_UPDATED','RESPONSIBLE',new.id,to_jsonb(old),to_jsonb(new),v_metadata);
      end if;
    end if;

  elsif tg_table_name='incidents' then
    if tg_op='INSERT' then
      perform public.append_audit_log('INCIDENT_CREATED','INCIDENT',new.id,null,to_jsonb(new),v_metadata);
    elsif tg_op='DELETE' then
      perform public.append_audit_log('INCIDENT_DELETED','INCIDENT',old.id,to_jsonb(old),null,v_metadata);
    elsif tg_op='UPDATE' then
      if old.status is distinct from new.status then
        perform public.append_audit_log(case when new.status='RESOLVED' then 'INCIDENT_RESOLVED' else 'INCIDENT_REOPENED' end,'INCIDENT',new.id,jsonb_build_object('status',old.status),jsonb_build_object('status',new.status),v_metadata);
      end if;
      if row(old.title,old.description,old.responsible_id,old.resolution_notes,old.resolved_by_id) is distinct from row(new.title,new.description,new.responsible_id,new.resolution_notes,new.resolved_by_id) then
        perform public.append_audit_log('INCIDENT_UPDATED','INCIDENT',new.id,to_jsonb(old),to_jsonb(new),v_metadata);
      end if;
    end if;

  elsif tg_table_name='profiles' and tg_op='UPDATE' then
    if row(old.name,old.email) is distinct from row(new.name,new.email) then
      perform public.append_audit_log('PROFILE_UPDATED','USER',new.id::text,to_jsonb(old)-'email',to_jsonb(new)-'email',v_metadata);
    end if;
    if old.job_title is distinct from new.job_title then
      perform public.append_audit_log('PROFILE_JOB_TITLE_CHANGED','USER',new.id::text,jsonb_build_object('jobTitle',old.job_title),jsonb_build_object('jobTitle',new.job_title),v_metadata);
    end if;
    if old.squad_id is distinct from new.squad_id then
      perform public.append_audit_log('PROFILE_SQUAD_CHANGED','USER',new.id::text,jsonb_build_object('squadId',old.squad_id),jsonb_build_object('squadId',new.squad_id),v_metadata);
    end if;
    if old.status is distinct from new.status then
      perform public.append_audit_log('PROFILE_STATUS_CHANGED','USER',new.id::text,jsonb_build_object('status',old.status),jsonb_build_object('status',new.status),v_metadata);
    end if;
    if old.access_level is distinct from new.access_level then
      perform public.append_audit_log('PROFILE_ACCESS_LEVEL_CHANGED','USER',new.id::text,jsonb_build_object('accessLevel',old.access_level),jsonb_build_object('accessLevel',new.access_level),v_metadata);
    end if;
  elsif tg_table_name='profiles' and tg_op='DELETE' then
    perform public.append_audit_log('PROFILE_DELETED','USER',old.id::text,to_jsonb(old)-'email',null,v_metadata);
  end if;

  if tg_op='DELETE' then return old;end if;
  return new;
end;
$$;

revoke all on function public.capture_number_ops_audit() from public, anon, authenticated;

-- Garante o trigger de auditoria também em profiles (para PROFILE_DELETED).
drop trigger if exists audit_profiles_changes on public.profiles;
create trigger audit_profiles_changes after insert or update or delete on public.profiles
for each row execute function public.capture_number_ops_audit();

commit;
