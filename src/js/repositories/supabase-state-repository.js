import { SCHEMA_VERSION } from "../config/constants.js";
import { createInitialState } from "../data/initial-state.js";
import { LocalStorageRepository } from "./local-storage-repository.js";
import { APP_STORAGE_KEY } from "../config/constants.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const check = ({ data, error }) => { if (error) throw error; return data; };
const camelNumber = (row, clientIds, groupIds, restriction) => ({ id:row.id,phone:row.phone,identification:row.identification,status:row.status,locationId:row.location_id,responsibleId:row.responsible_id,clientIds,groupIds,groupCount:row.group_count,notes:row.notes,restriction,archivedAt:row.archived_at,createdAt:row.created_at,updatedAt:row.updated_at });
const named = (row) => ({ id:row.id,name:row.name,isActive:row.is_active,createdAt:row.created_at,updatedAt:row.updated_at });

export class SupabaseStateRepository {
  constructor(client, state) { this.client=client; this.state=clone(state); this.previous=clone(state); this.pending=Promise.resolve(); }

  static async create(client) {
    const tables=["numbers","clients","squads","responsibles","locations","incidents","restrictions","history_events","campaigns","number_campaign_links","number_clients","number_squads"];
    const values=await Promise.all(tables.map(async(table)=>[table,check(await client.from(table).select("*"))]));
    const rows=Object.fromEntries(values);
    const clientsByNumber=Object.groupBy(rows.number_clients,(item)=>item.number_id);
    const squadsByNumber=Object.groupBy(rows.number_squads,(item)=>item.number_id);
    const restrictionsByNumber=Object.groupBy(rows.restrictions.filter((item)=>!item.ended_at),(item)=>item.number_id);
    const state={...createInitialState(),schemaVersion:SCHEMA_VERSION,meta:{seedApplied:true,source:"supabase"},
      groups:rows.squads.map(named),
      clients:rows.clients.map((row)=>({...named(row),squadId:row.squad_id})),
      responsibles:rows.responsibles.map((row)=>({...named(row),team:row.team})),
      locations:rows.locations.map(named),
      numbers:rows.numbers.map((row)=>camelNumber(row,(clientsByNumber[row.id]??[]).map((item)=>item.client_id),(squadsByNumber[row.id]??[]).map((item)=>item.squad_id),restrictionsByNumber[row.id]?.[0]?{kind:restrictionsByNumber[row.id][0].kind,description:restrictionsByNumber[row.id][0].description,recordedAt:restrictionsByNumber[row.id][0].recorded_at}:null)),
      campaigns:rows.campaigns.map((row)=>({id:row.id,name:row.name,clientId:row.client_id,squadId:row.squad_id,notes:row.notes,status:row.status,startedAt:row.started_at,endedAt:row.ended_at,createdAt:row.created_at,updatedAt:row.updated_at})),
      numberCampaignLinks:rows.number_campaign_links.map((row)=>({id:row.id,numberId:row.number_id,campaignId:row.campaign_id,role:row.role,startedAt:row.started_at,endedAt:row.ended_at,createdAt:row.created_at,updatedAt:row.updated_at})),
      incidents:rows.incidents.map((row)=>({id:row.id,numberId:row.number_id,type:row.type,title:row.title,description:row.description,status:row.status,responsibleId:row.responsible_id,resolutionNotes:row.resolution_notes,resolvedById:row.resolved_by_id,resolvedAt:row.resolved_at,createdAt:row.created_at,updatedAt:row.updated_at})),
      historyEvents:rows.history_events.map((row)=>({id:row.id,numberId:row.number_id,type:row.type,description:row.description,previousValue:row.previous_value,newValue:row.new_value,metadata:row.metadata,occurredAt:row.occurred_at})),
    };
    return new SupabaseStateRepository(client,state);
  }

  initialize() { return clone(this.state); }
  save(state) {
    const snapshot=clone(state);
    this.pending=this.pending.catch(()=>{}).then(()=>this.sync(snapshot));
    return this.pending;
  }
  flush() { return this.pending; }

  async sync(state) {
    const upsert=async(table,rows)=>{if(!rows.length)return;check(await this.client.from(table).upsert(rows));};
    await upsert("squads",state.groups.map((x)=>({id:x.id,name:x.name,is_active:x.isActive,created_at:x.createdAt,updated_at:x.updatedAt})));
    await upsert("clients",state.clients.map((x)=>({id:x.id,name:x.name,squad_id:x.squadId||null,is_active:x.isActive,created_at:x.createdAt,updated_at:x.updatedAt})));
    await upsert("responsibles",state.responsibles.map((x)=>({id:x.id,name:x.name,team:x.team||"",is_active:x.isActive,created_at:x.createdAt,updated_at:x.updatedAt})));
    await upsert("locations",state.locations.map((x)=>({id:x.id,name:x.name,is_active:x.isActive,created_at:x.createdAt,updated_at:x.updatedAt})));
    await upsert("numbers",state.numbers.map((x)=>({id:x.id,phone:x.phone,identification:x.identification,status:x.status,location_id:x.locationId||null,responsible_id:x.responsibleId||null,group_count:x.groupCount??0,notes:x.notes||"",archived_at:x.archivedAt||null,created_at:x.createdAt,updated_at:x.updatedAt})));
    await this.syncJoins("number_clients","client_id",this.previous.numbers.flatMap((x)=>(x.clientIds??[]).map((id)=>[x.id,id])),state.numbers.flatMap((x)=>(x.clientIds??[]).map((id)=>[x.id,id])));
    await this.syncJoins("number_squads","squad_id",this.previous.numbers.flatMap((x)=>(x.groupIds??[]).map((id)=>[x.id,id])),state.numbers.flatMap((x)=>(x.groupIds??[]).map((id)=>[x.id,id])));
    await upsert("campaigns",state.campaigns.map((x)=>({id:x.id,name:x.name,client_id:x.clientId,squad_id:x.squadId,notes:x.notes||"",status:x.status,started_at:x.startedAt,ended_at:x.endedAt||null,created_at:x.createdAt,updated_at:x.updatedAt})));
    await upsert("number_campaign_links",state.numberCampaignLinks.map((x)=>({id:x.id,number_id:x.numberId,campaign_id:x.campaignId,role:x.role,started_at:x.startedAt,ended_at:x.endedAt||null,created_at:x.createdAt,updated_at:x.updatedAt})));
    await upsert("incidents",state.incidents.map((x)=>({id:x.id,number_id:x.numberId,type:x.type,title:x.title,description:x.description||"",status:x.status,responsible_id:x.responsibleId||null,resolution_notes:x.resolutionNotes||"",resolved_by_id:x.resolvedById||null,resolved_at:x.resolvedAt||null,created_at:x.createdAt,updated_at:x.updatedAt})));
    await this.syncRestrictions(state);
    await upsert("history_events",state.historyEvents.map((x)=>({id:x.id,number_id:x.numberId,type:x.type,description:x.description,previous_value:x.previousValue??null,new_value:x.newValue??null,metadata:x.metadata??null,occurred_at:x.occurredAt})));
    this.state=clone(state); this.previous=clone(state);
  }

  async syncJoins(table,targetColumn,previous,next) {
    const key=([numberId,targetId])=>`${numberId}\u0000${targetId}`;
    const oldSet=new Set(previous.map(key)),newSet=new Set(next.map(key));
    for(const [numberId,targetId] of previous.filter((pair)=>!newSet.has(key(pair)))) check(await this.client.from(table).delete().eq("number_id",numberId).eq(targetColumn,targetId));
    const additions=next.filter((pair)=>!oldSet.has(key(pair))).map(([numberId,targetId])=>({number_id:numberId,[targetColumn]:targetId}));
    if(additions.length) check(await this.client.from(table).insert(additions));
  }

  async syncRestrictions(state) {
    const oldById=new Map(this.previous.numbers.map((x)=>[x.id,x.restriction]));
    for(const number of state.numbers) {
      const before=oldById.get(number.id),current=number.restriction;
      if(before&&!current) check(await this.client.from("restrictions").update({ended_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("number_id",number.id).is("ended_at",null));
      if(current&&JSON.stringify(current)!==JSON.stringify(before)) check(await this.client.from("restrictions").upsert({id:`restriction_${number.id}`,number_id:number.id,kind:current.kind,description:current.description||"",recorded_at:current.recordedAt,ended_at:null,updated_at:new Date().toISOString()}));
    }
  }

  saveRecoveryBackup(name,backup) { new LocalStorageRepository(`${APP_STORAGE_KEY}:recovery:${name}`).save(backup); return true; }
  readRecoveryBackup(name) { return new LocalStorageRepository(`${APP_STORAGE_KEY}:recovery:${name}`).read(null); }
}
