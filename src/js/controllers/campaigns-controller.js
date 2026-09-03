import { renderCampaignDetail, renderCampaignForm, renderCampaigns } from "../ui/campaigns-view.js";
import { showToast } from "../ui/toast.js";
export class CampaignsController {
  constructor({ service, content }) { this.service=service; this.content=content; this.filters={query:"",status:""}; }
  render() {
    const state=this.service.state;
    this.content.innerHTML=renderCampaigns({campaigns:this.service.list(this.filters),clients:state.clients,squads:state.groups,filters:this.filters});
    this.content.querySelector('[data-action="add"]')?.addEventListener("click",()=>this.openForm());
    this.content.querySelector('[data-action="search"]')?.addEventListener("input",(event)=>{this.filters.query=event.target.value;this.render();});
    this.content.querySelector('[data-action="status"]')?.addEventListener("change",(event)=>{this.filters.status=event.target.value;this.render();});
    this.content.querySelectorAll('[data-action="view"]').forEach((button)=>button.addEventListener("click",()=>this.detail(button.dataset.id)));
    this.content.querySelectorAll('[data-action="edit"]').forEach((button)=>button.addEventListener("click",()=>this.openForm(button.dataset.id)));
    this.content.querySelectorAll('[data-action="close"]').forEach((button)=>button.addEventListener("click",async()=>{
      if(!confirm("Encerrar esta campanha?"))return;
      try{this.service.close(button.dataset.id);await this.service.flush();showToast("Campanha encerrada.","warning");this.render();}catch(error){showToast(error.message,"error");}
    }));
  }
  detail(id) {
    const item=this.service.get(id);if(!item)return this.render();const state=this.service.state;
    this.content.innerHTML=renderCampaignDetail({item,clients:state.clients,squads:state.groups,numbers:state.numbers,links:state.numberCampaignLinks.filter((link)=>link.campaignId===id).sort((a,b)=>(b.startedAt||"").localeCompare(a.startedAt||""))});
    this.content.querySelector('[data-action="back"]')?.addEventListener("click",()=>{window.location.hash="#campaigns";});
  }
  openForm(id=null) {
    const state=this.service.state;
    this.content.insertAdjacentHTML("beforeend",renderCampaignForm({item:id?this.service.get(id):{},clients:state.clients.filter((item)=>item.isActive),squads:state.groups.filter((item)=>item.isActive)}));
    const close=()=>this.content.querySelector(".modal-backdrop")?.remove();
    this.content.querySelectorAll('[data-action="close-form"]').forEach((button)=>button.addEventListener("click",close));
    const form=this.content.querySelector("#campaign-form"),squadSelect=form?.elements.squadId,clientSelect=form?.elements.clientId;
    const refreshClients=()=>{if(!clientSelect)return;const current=clientSelect.value;clientSelect.replaceChildren(new Option("Selecione",""));state.clients.filter((item)=>item.isActive&&(!squadSelect.value||!item.squadId||item.squadId===squadSelect.value)).forEach((item)=>clientSelect.append(new Option(`${item.name}${item.squadId?"":" · Sem Squad"}`,item.id,false,item.id===current)));};
    squadSelect?.addEventListener("change",refreshClients);refreshClients();
    form?.addEventListener("submit",async(event)=>{
      event.preventDefault();
      try{const values=Object.fromEntries(new FormData(event.currentTarget));id?this.service.update(id,values):this.service.create(values);await this.service.flush();showToast(id?"Campanha atualizada.":"Campanha criada.","success");this.render();}catch(error){showToast(error.message,"error");}
    });
  }
}
