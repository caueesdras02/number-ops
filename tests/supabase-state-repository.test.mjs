import assert from "node:assert/strict";
import { SupabaseStateRepository } from "../src/js/repositories/supabase-state-repository.js";

const timestamp="2026-09-03T00:00:00.000Z";
const tables={
  numbers:[{id:"n1",phone:"5511999999999",identification:"Chip",status:"ACTIVE",location_id:"loc1",responsible_id:"r1",group_count:12,notes:"",archived_at:null,created_at:timestamp,updated_at:timestamp}],
  clients:[{id:"c1",name:"Cliente",squad_id:"s1",is_active:true,created_at:timestamp,updated_at:timestamp}],
  squads:[{id:"s1",name:"Squad",is_active:true,created_at:timestamp,updated_at:timestamp}],
  responsibles:[{id:"r1",name:"Pessoa",team:"Operação",is_active:true,created_at:timestamp,updated_at:timestamp}],
  locations:[{id:"loc1",name:"Celular",is_active:true,created_at:timestamp,updated_at:timestamp}],
  incidents:[],restrictions:[],history_events:[],campaigns:[],number_campaign_links:[],
  number_clients:[{number_id:"n1",client_id:"c1"}],number_squads:[{number_id:"n1",squad_id:"s1"}],
};
tables.responsibles[0].squad_id="s1";
const writes=[];
const deletes=[];
const client={from(table){return{
  select:async()=>({data:structuredClone(tables[table]),error:null}),
  upsert:async(rows)=>{writes.push({table,rows:structuredClone(rows)});return{data:null,error:null};},
  insert:async(rows)=>{writes.push({table,rows:structuredClone(rows)});return{data:null,error:null};},
  delete:()=>({eq:(col,val)=>{deletes.push({table,col,val});return{eq:()=>({then:(r)=>r({data:null,error:null})}),then:(r)=>r({data:null,error:null})};}}),
};}};
const repository=await SupabaseStateRepository.create(client);
const state=repository.initialize();
assert.equal(state.meta.source,"supabase");
assert.equal(state.numbers.length,1);
assert.deepEqual(state.numbers[0].clientIds,["c1"]);
assert.deepEqual(state.numbers[0].groupIds,["s1"]);
assert.equal(state.numbers[0].groupCount,12);
assert.equal(state.responsibles[0].squadId,"s1","responsibles carregam squad_id");
state.numbers[0].groupCount=18;
await repository.save(state);
await repository.flush();
assert.equal(writes.findLast((item)=>item.table==="numbers").rows[0].group_count,18);
// diff-upsert: só a tabela alterada foi enviada
assert.ok(!writes.some((item)=>item.table==="clients"),"tabela não alterada não é reenviada");
assert.ok(!writes.some((item)=>item.table==="squads"));
assert.equal(repository.initialize().numbers[0].groupCount,18);
// remove()
await repository.remove("locations","loc9");
assert.deepEqual(deletes.at(-1),{table:"locations",col:"id",val:"loc9"});
console.log("SupabaseStateRepository: leitura remota, escrita diferencial, remove() e reload validados.");
