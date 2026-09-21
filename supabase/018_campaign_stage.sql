-- Incremental, não destrutiva. Introduz a ETAPA OPERACIONAL da campanha,
-- SEMPRE separada do status ESTRUTURAL existente (ACTIVE/CLOSED,
-- campaigns.status), que continua controlando abertura/encerramento e
-- vínculos de número.
--
-- O que esta migration realmente faz com campanhas já existentes: nenhuma
-- CAMPANHA, NÚMERO, VÍNCULO ou qualquer OUTRA coluna é tocada — mas a coluna
-- nova em si (stage) precisa nascer com ALGUM valor em toda linha já
-- existente, porque é NOT NULL. Esse valor é 'CAPTACAO' em todas elas (o
-- default técnico do ADD COLUMN, aplicado igual pra toda campanha, sem
-- olhar status/histórico de nenhuma) — não é um UPDATE manual nem uma
-- inferência a partir de outro dado da campanha (diferente, por exemplo, de
-- um backfill que leria `status` pra decidir o valor).
--
-- Modelo (evita duas fontes da mesma verdade): `stage` só representa a etapa
-- ENQUANTO a campanha está ACTIVE — CAPTACAO ou TA_ROLANDO_POS_LIVE (a etapa
-- "Tá rolando / Pós live" é UMA única etapa visual, não duas). "Encerrada"
-- NUNCA é gravada em `stage` — é só a leitura de campaigns.status='CLOSED',
-- que já existe. Ao encerrar, `stage` não muda (endedAt/status continuam
-- exatamente como hoje); ao reabrir, a última etapa gravada é preservada sem
-- inventar nenhuma outra.
begin;

-- ---------------------------------------------------------------------------
-- 1. Coluna nova (texto + CHECK, mesmo padrão já usado em
--    integration_events.processing_status / external_numbers.reason — mais
--    fácil de ampliar depois do que um enum, sem precisar de migration em
--    duas etapas). Default 'CAPTACAO': toda campanha já existente passa a
--    ter essa coluna preenchida com esse valor (NOT NULL exige algum valor)
--    — não é uma inferência sobre o estado real de nenhuma campanha
--    específica, só o ponto de partida técnico da coluna.
-- ---------------------------------------------------------------------------
alter table public.campaigns
  add column if not exists stage text not null default 'CAPTACAO'
  check (stage in ('CAPTACAO','TA_ROLANDO_POS_LIVE'));

create index if not exists campaigns_stage_idx on public.campaigns (stage);

-- ---------------------------------------------------------------------------
-- 2. Auditoria: CAMPAIGN_STAGE_CHANGED (base: cópia integral da função
--    atual — supabase/010_location_responsible.sql, confirmada como a
--    última redefinição em TODAS as migrations do projeto — 011 a 017 não
--    tocam esta função. Nenhum outro bloco (numbers/restrictions/clients/
--    squads/locations/responsibles/incidents/profiles/number_campaign_links)
--    muda. Dentro do bloco `campaigns`, além do ramo novo (stage), os ramos
--    de UPDATE deixam de ser um único elsif encadeado e passam a ser `if`
--    independentes entre si — necessário pra CAMPAIGN_RESPONSIBLE_CHANGED e
--    CAMPAIGN_STAGE_CHANGED (e CAMPAIGN_UPDATED) poderem ser auditados
--    juntos quando mais de um desses campos muda na MESMA operação; CLOSED/
--    REACTIVATED continuam elsif só entre si, por serem mutuamente
--    exclusivos. Nenhum evento existente (CREATED/DELETED/CLOSED/
--    REACTIVATED/RESPONSIBLE_CHANGED/UPDATED) deixa de disparar em nenhum
--    caso que já disparava antes — só passam a poder coexistir.
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
    elsif tg_op='UPDATE' then
      -- Ramos independentes (não elsif entre si): se responsible_id e stage (ou qualquer
      -- combinação deles) mudarem na MESMA operação, cada evento aplicável é auditado — nenhum
      -- é "engolido" por outro. CLOSED/REACTIVATED continuam como elsif só entre si porque são
      -- mutuamente exclusivos por natureza (status não pode virar CLOSED e ACTIVE ao mesmo tempo).
      if old.status is distinct from new.status and new.status='CLOSED' then
        perform public.append_audit_log('CAMPAIGN_CLOSED','CAMPAIGN',new.id,to_jsonb(old),to_jsonb(new),v_metadata);
      elsif old.status is distinct from new.status and new.status='ACTIVE' then
        perform public.append_audit_log('CAMPAIGN_REACTIVATED','CAMPAIGN',new.id,to_jsonb(old),to_jsonb(new),v_metadata);
      end if;
      if old.responsible_id is distinct from new.responsible_id then
        perform public.append_audit_log('CAMPAIGN_RESPONSIBLE_CHANGED','CAMPAIGN',new.id,jsonb_build_object('responsibleId',old.responsible_id),jsonb_build_object('responsibleId',new.responsible_id),v_metadata);
      end if;
      if old.stage is distinct from new.stage then
        perform public.append_audit_log('CAMPAIGN_STAGE_CHANGED','CAMPAIGN',new.id,jsonb_build_object('stage',old.stage),jsonb_build_object('stage',new.stage),v_metadata);
      end if;
      if row(old.name,old.client_id,old.squad_id,old.notes,old.started_at) is distinct from row(new.name,new.client_id,new.squad_id,new.notes,new.started_at) then
        perform public.append_audit_log('CAMPAIGN_UPDATED','CAMPAIGN',new.id,to_jsonb(old),to_jsonb(new),v_metadata);
      end if;
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
    elsif tg_op='UPDATE' and old.responsible_id is distinct from new.responsible_id then
      perform public.append_audit_log('LOCATION_RESPONSIBLE_CHANGED','LOCATION',new.id,jsonb_build_object('responsibleId',old.responsible_id),jsonb_build_object('responsibleId',new.responsible_id),v_metadata);
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

commit;
