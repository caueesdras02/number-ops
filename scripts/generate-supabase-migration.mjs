import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { BackupService } from "../src/js/services/backup-service.js";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Informe os caminhos do backup e do SQL de saída.");
const raw = await readFile(resolve(inputPath), "utf8");
const state = new BackupService({ state: {}, replaceState() {}, repository: {} }).inspect(raw).state;
const json = (value) => JSON.stringify(value).replaceAll("$number_ops$", "$number_ops_safe$");
const block = (value) => `$number_ops$${json(value)}$number_ops$::jsonb`;
const numberClients = state.numbers.flatMap((number) => number.clientIds.map((clientId) => ({ numberId: number.id, clientId })));
const numberSquads = state.numbers.flatMap((number) => number.groupIds.map((squadId) => ({ numberId: number.id, squadId })));
const restrictions = state.numbers.filter((number) => number.restriction).map((number) => ({
  id: `restriction_${number.id}`, numberId: number.id, ...number.restriction,
}));

const sql = `begin;

do $$
declare existing_count bigint;
begin
  select (select count(*) from public.numbers) + (select count(*) from public.clients) +
    (select count(*) from public.squads) + (select count(*) from public.campaigns) +
    (select count(*) from public.number_campaign_links) + (select count(*) from public.responsibles) +
    (select count(*) from public.locations) + (select count(*) from public.incidents) +
    (select count(*) from public.restrictions) + (select count(*) from public.history_events)
  into existing_count;
  if existing_count <> 0 then raise exception 'Migração cancelada: as tabelas operacionais não estão vazias (% registros).', existing_count; end if;
end $$;

insert into public.squads(id,name,is_active,created_at,updated_at)
select value->>'id',value->>'name',coalesce((value->>'isActive')::boolean,true),(value->>'createdAt')::timestamptz,(value->>'updatedAt')::timestamptz from jsonb_array_elements(${block(state.groups)});
insert into public.clients(id,name,squad_id,is_active,created_at,updated_at)
select value->>'id',value->>'name',nullif(value->>'squadId',''),coalesce((value->>'isActive')::boolean,true),(value->>'createdAt')::timestamptz,(value->>'updatedAt')::timestamptz from jsonb_array_elements(${block(state.clients)});
insert into public.responsibles(id,name,team,is_active,created_at,updated_at)
select value->>'id',value->>'name',coalesce(value->>'team',''),coalesce((value->>'isActive')::boolean,true),(value->>'createdAt')::timestamptz,(value->>'updatedAt')::timestamptz from jsonb_array_elements(${block(state.responsibles)});
insert into public.locations(id,name,is_active,created_at,updated_at)
select value->>'id',value->>'name',coalesce((value->>'isActive')::boolean,true),(value->>'createdAt')::timestamptz,(value->>'updatedAt')::timestamptz from jsonb_array_elements(${block(state.locations)});
insert into public.numbers(id,phone,identification,status,location_id,responsible_id,group_count,notes,archived_at,created_at,updated_at)
select value->>'id',value->>'phone',coalesce(value->>'identification',''),value->>'status',nullif(value->>'locationId',''),nullif(value->>'responsibleId',''),coalesce((value->>'groupCount')::integer,0),coalesce(value->>'notes',''),nullif(value->>'archivedAt','')::timestamptz,(value->>'createdAt')::timestamptz,(value->>'updatedAt')::timestamptz from jsonb_array_elements(${block(state.numbers)});
insert into public.number_clients(number_id,client_id)
select value->>'numberId',value->>'clientId' from jsonb_array_elements(${block(numberClients)});
insert into public.number_squads(number_id,squad_id)
select value->>'numberId',value->>'squadId' from jsonb_array_elements(${block(numberSquads)});
insert into public.campaigns(id,name,client_id,squad_id,notes,status,started_at,ended_at,created_at,updated_at)
select value->>'id',value->>'name',value->>'clientId',value->>'squadId',coalesce(value->>'notes',''),(value->>'status')::public.campaign_status,(value->>'startedAt')::timestamptz,nullif(value->>'endedAt','')::timestamptz,(value->>'createdAt')::timestamptz,(value->>'updatedAt')::timestamptz from jsonb_array_elements(${block(state.campaigns)});
insert into public.number_campaign_links(id,number_id,campaign_id,role,started_at,ended_at,created_at,updated_at)
select value->>'id',value->>'numberId',value->>'campaignId',(value->>'role')::public.campaign_role,(value->>'startedAt')::timestamptz,nullif(value->>'endedAt','')::timestamptz,(value->>'createdAt')::timestamptz,(value->>'updatedAt')::timestamptz from jsonb_array_elements(${block(state.numberCampaignLinks)});
insert into public.incidents(id,number_id,type,title,description,status,responsible_id,resolution_notes,resolved_by_id,resolved_at,created_at,updated_at)
select value->>'id',value->>'numberId',value->>'type',value->>'title',coalesce(value->>'description',''),value->>'status',nullif(value->>'responsibleId',''),coalesce(value->>'resolutionNotes',''),nullif(value->>'resolvedById',''),nullif(value->>'resolvedAt','')::timestamptz,(value->>'createdAt')::timestamptz,(value->>'updatedAt')::timestamptz from jsonb_array_elements(${block(state.incidents)});
insert into public.restrictions(id,number_id,kind,description,recorded_at,ended_at,created_at,updated_at)
select value->>'id',value->>'numberId',value->>'kind',coalesce(value->>'description',''),(value->>'recordedAt')::timestamptz,nullif(value->>'endedAt','')::timestamptz,coalesce((value->>'createdAt')::timestamptz,(value->>'recordedAt')::timestamptz),coalesce((value->>'updatedAt')::timestamptz,(value->>'recordedAt')::timestamptz) from jsonb_array_elements(${block(restrictions)});
insert into public.history_events(id,number_id,type,description,previous_value,new_value,metadata,occurred_at)
select value->>'id',value->>'numberId',value->>'type',value->>'description',nullif(value->'previousValue','null'::jsonb),nullif(value->'newValue','null'::jsonb),nullif(value->'metadata','null'::jsonb),(value->>'occurredAt')::timestamptz from jsonb_array_elements(${block(state.historyEvents)});

do $$
begin
  if (select count(*) from public.numbers) <> ${state.numbers.length} then raise exception 'Falha de contagem em numbers'; end if;
  if (select count(*) from public.clients) <> ${state.clients.length} then raise exception 'Falha de contagem em clients'; end if;
  if (select count(*) from public.squads) <> ${state.groups.length} then raise exception 'Falha de contagem em squads'; end if;
  if (select count(*) from public.campaigns) <> ${state.campaigns.length} then raise exception 'Falha de contagem em campaigns'; end if;
  if (select count(*) from public.number_campaign_links) <> ${state.numberCampaignLinks.length} then raise exception 'Falha de contagem em number_campaign_links'; end if;
  if (select count(*) from public.responsibles) <> ${state.responsibles.length} then raise exception 'Falha de contagem em responsibles'; end if;
  if (select count(*) from public.locations) <> ${state.locations.length} then raise exception 'Falha de contagem em locations'; end if;
  if (select count(*) from public.incidents) <> ${state.incidents.length} then raise exception 'Falha de contagem em incidents'; end if;
  if (select count(*) from public.history_events) <> ${state.historyEvents.length} then raise exception 'Falha de contagem em history_events'; end if;
  if (select count(*) from public.number_clients) <> ${numberClients.length} then raise exception 'Falha de contagem em number_clients'; end if;
  if (select count(*) from public.number_squads) <> ${numberSquads.length} then raise exception 'Falha de contagem em number_squads'; end if;
end $$;

commit;
`;

const target = resolve(outputPath);
await mkdir(dirname(target), { recursive: true });
await writeFile(target, sql, "utf8");
console.log(JSON.stringify({ output: target, numbers: state.numbers.length, clients: state.clients.length, squads: state.groups.length, campaigns: state.campaigns.length, links: state.numberCampaignLinks.length, incidents: state.incidents.length, history: state.historyEvents.length, numberClients: numberClients.length, numberSquads: numberSquads.length, restrictions: restrictions.length }));
