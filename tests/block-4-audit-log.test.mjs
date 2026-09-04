import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AuditLogService } from "../src/js/services/audit-log-service.js";
import { renderAuditDetail, renderAuditLog } from "../src/js/ui/audit-log-view.js";
import { renderAboutModal } from "../src/js/ui/about-view.js";
import { renderCampaignLinkForm, renderNumberDetailView } from "../src/js/ui/number-detail-view.js";
import { renderDirectoryForm } from "../src/js/ui/directory-view.js";
import { DirectoryService } from "../src/js/services/directory-service.js";
import { NumbersService } from "../src/js/services/numbers-service.js";

const timestamp="2026-09-03T12:00:00.000Z";
const state={schemaVersion:2,meta:{seedApplied:true},numbers:[{id:"n1",phone:"5511999999999",identification:"Chip",status:"ACTIVE",locationId:null,responsibleId:null,clientIds:["c1"],groupIds:["s1"],groupCount:18,notes:"",restriction:null,archivedAt:null}],clients:[{id:"c1",name:"Cliente",squadId:"s1",isActive:true}],groups:[{id:"s1",name:"Squad",isActive:true}],responsibles:[],locations:[],incidents:[],historyEvents:[],campaigns:[{id:"ca1",name:"Campanha",clientId:"c1",squadId:"s1",status:"ACTIVE",startedAt:timestamp}],numberCampaignLinks:[{id:"l1",numberId:"n1",campaignId:"ca1",role:"PRIMARY",startedAt:timestamp,endedAt:null}]};
const rows=[{id:7,user_id:"u1",action:"NUMBER_GROUP_COUNT_CHANGED",entity_type:"NUMBER",entity_id:"n1",occurred_at:timestamp,previous_data:{groupCount:12},new_data:{groupCount:18},metadata:{squadId:"s1"}}];
const profiles=[{id:"u1",name:"Cauê",squad_id:"s1"}];
const squads=[{id:"s1",name:"Squad",is_active:true}];
const numbersService={state};
const service=new AuditLogService({repository:{list:async()=>rows},profilesRepository:{list:async()=>profiles},squadsRepository:{list:async()=>squads},numbersService,currentProfile:{access_level:"ADMIN"}});
const data=await service.load();
assert.equal(data.logs[0].userName,"Cauê");
assert.equal(data.logs[0].actionLabel,"Quantidade de grupos alterada");
assert.equal(data.logs[0].entityName,"5511999999999");
assert.match(data.logs[0].summary,/Quantidade de grupos/);
assert.equal(service.filter(data.logs,{userId:"u1",squadId:"s1",action:"NUMBER_GROUP_COUNT_CHANGED",entityType:"NUMBER",dateFrom:"2026-09-03",dateTo:"2026-09-03"}).length,1);
assert.equal(service.filter(data.logs,{userId:"outro"}).length,0);
const listHtml=renderAuditLog({...data,filters:{}});
assert.match(listHtml,/Registro de atividades/);
assert.match(listHtml,/Somente leitura/);
assert.match(listHtml,/data-audit-filter="userId"/);
assert.doesNotMatch(listHtml,/Excluir|Editar/);
assert.match(renderAuditDetail(data.logs[0],squads),/Valor anterior/);

await assert.rejects(()=>new AuditLogService({repository:{list:async()=>[]},profilesRepository:{list:async()=>[]},squadsRepository:{list:async()=>[]},numbersService,currentProfile:{access_level:"USER"}}).load(),/Somente administradores/);
const about=renderAboutModal();
assert.match(about,/Sobre o Number Ops/);
assert.match(about,/desenvolvido por Cauê Esdras/);
assert.match(about,/aria-modal="true"/);
assert.match(about,/data-about-close/);

const detail=renderNumberDetailView({number:state.numbers[0],locations:[],responsibles:[],clients:state.clients,groups:state.groups,campaigns:state.campaigns,campaignLinks:state.numberCampaignLinks});
assert.match(detail,/Campanha atual/);
assert.match(detail,/Principal/);
assert.match(detail,/Encerrar vínculo/);
assert.match(renderCampaignLinkForm(state.numbers[0],state.campaigns,state.numberCampaignLinks[0]),/Principal|Backup|Apoio/);
assert.match(renderDirectoryForm("clients",state.clients[0],state.groups),/name="squadId"/);

let persisted=structuredClone(state);
const operational=new NumbersService({initialize:()=>structuredClone(persisted),save:(next)=>{persisted=structuredClone(next);}});
new DirectoryService(operational).update("clients","c1",{name:"Cliente",squadId:""});
assert.equal(operational.state.clients[0].squadId,null);

const legacyState=structuredClone(state);
delete legacyState.campaigns;
delete legacyState.numberCampaignLinks;
delete legacyState.numbers[0].groupCount;
delete legacyState.clients[0].squadId;
const legacyService=new NumbersService({initialize:()=>legacyState,save:()=>{}});
assert.deepEqual(legacyService.state.campaigns,[]);
assert.deepEqual(legacyService.state.numberCampaignLinks,[]);
assert.equal(legacyService.state.numbers[0].groupCount,0);
assert.equal(legacyService.state.clients[0].squadId,null);

const index=await readFile(new URL("../index.html",import.meta.url),"utf8");
assert.equal((index.match(/data-view="activity"/g)||[]).length,1);
assert.match(index,/<link rel="icon"[^>]*href="\.\/src\/assets\/favicon\.png"/);
assert.match(index,/class="brand-logo" src="\.\/src\/assets\/number-ops-logo\.png"/);
assert.match(index,/data-about-open/);
const sql=await readFile(new URL("../supabase/003_audit_log.sql",import.meta.url),"utf8");
for(const table of ["numbers","restrictions","number_clients","number_squads","campaigns","number_campaign_links","clients","squads","incidents","profiles"]) assert.match(sql,new RegExp(`['\"]${table}['\"]`));
for(const field of ["user_id","action","entity_type","entity_id","occurred_at","previous_data","new_data","metadata"]) assert.match(sql,new RegExp(`\\b${field}\\b`));
for(const action of ["NUMBER_CREATED","NUMBER_UPDATED","NUMBER_STATUS_CHANGED","NUMBER_RESPONSIBLE_CHANGED","NUMBER_LOCATION_CHANGED","NUMBER_GROUP_COUNT_CHANGED","NUMBER_RESTRICTION_ADDED","NUMBER_RESTRICTION_REMOVED","NUMBER_ARCHIVED","NUMBER_RESTORED","CAMPAIGN_CREATED","CAMPAIGN_UPDATED","CAMPAIGN_CLOSED","NUMBER_CAMPAIGN_LINKED","NUMBER_CAMPAIGN_CHANGED","NUMBER_CAMPAIGN_ROLE_CHANGED","NUMBER_CAMPAIGN_LINK_ENDED","CLIENT_CREATED","CLIENT_UPDATED","CLIENT_SQUAD_CHANGED","SQUAD_CREATED","SQUAD_UPDATED","INCIDENT_CREATED","INCIDENT_UPDATED","INCIDENT_RESOLVED","PROFILE_UPDATED","PROFILE_JOB_TITLE_CHANGED","PROFILE_SQUAD_CHANGED","PROFILE_STATUS_CHANGED","PROFILE_ACCESS_LEVEL_CHANGED"]) assert.match(sql,new RegExp(`'${action}'`));
assert.match(sql,/auth\.uid\(\)/);
assert.match(sql,/security definer/i);
assert.match(sql,/format\('create trigger %I/);
assert.doesNotMatch(sql,/audit_%I_changes/);
assert.match(sql,/revoke all on public\.audit_logs from anon, authenticated/i);
assert.doesNotMatch(sql,/service_role|password/i);

console.log("Bloco 4: Audit Log, interface, modal Sobre, favicon e vínculos V2 validados.");
