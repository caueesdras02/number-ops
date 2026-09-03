begin;

-- Incremental: extends the existing audit trigger function (no data touched) to also
-- cover public.locations and public.responsibles, which had no audit coverage yet.
-- Everything else is copied verbatim from 004 (which already added campaign
-- reactivation/responsible tracking) — only the two new elsif branches are new.
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
    elsif tg_op='UPDATE' and row(old.name,old.is_active) is distinct from row(new.name,new.is_active) then
      perform public.append_audit_log('SQUAD_UPDATED','SQUAD',new.id,to_jsonb(old),to_jsonb(new),v_metadata||jsonb_build_object('squadId',new.id));
    end if;

  elsif tg_table_name='locations' then
    if tg_op='INSERT' then
      perform public.append_audit_log('LOCATION_CREATED','LOCATION',new.id,null,to_jsonb(new),v_metadata);
    elsif tg_op='UPDATE' and row(old.name,old.is_active) is distinct from row(new.name,new.is_active) then
      perform public.append_audit_log('LOCATION_UPDATED','LOCATION',new.id,to_jsonb(old),to_jsonb(new),v_metadata);
    end if;

  elsif tg_table_name='responsibles' then
    if tg_op='INSERT' then
      perform public.append_audit_log('RESPONSIBLE_CREATED','RESPONSIBLE',new.id,null,to_jsonb(new),v_metadata);
    elsif tg_op='UPDATE' then
      if old.team is distinct from new.team then
        perform public.append_audit_log('RESPONSIBLE_TEAM_CHANGED','RESPONSIBLE',new.id,jsonb_build_object('team',old.team),jsonb_build_object('team',new.team),v_metadata);
      end if;
      if row(old.name,old.is_active) is distinct from row(new.name,new.is_active) then
        perform public.append_audit_log('RESPONSIBLE_UPDATED','RESPONSIBLE',new.id,to_jsonb(old),to_jsonb(new),v_metadata);
      end if;
    end if;

  elsif tg_table_name='incidents' then
    if tg_op='INSERT' then
      perform public.append_audit_log('INCIDENT_CREATED','INCIDENT',new.id,null,to_jsonb(new),v_metadata);
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
  end if;

  if tg_op='DELETE' then return old;end if;
  return new;
end;
$$;

-- Attach the (already-existing) trigger function to the two tables that were missing it.
-- Every other table already has this trigger from migration 003; only these two are new.
drop trigger if exists audit_locations_changes on public.locations;
create trigger audit_locations_changes after insert or update or delete on public.locations
for each row execute function public.capture_number_ops_audit();

drop trigger if exists audit_responsibles_changes on public.responsibles;
create trigger audit_responsibles_changes after insert or update or delete on public.responsibles
for each row execute function public.capture_number_ops_audit();

commit;
