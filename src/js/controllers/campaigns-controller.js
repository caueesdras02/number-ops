import { renderCampaignDetail, renderCampaignForm, renderCampaignLinkAddForm, renderCampaigns } from "../ui/campaigns-view.js";
import { showToast } from "../ui/toast.js";
import { guardedSubmit } from "../ui/form-submit-guard.js";
import { confirmHardDelete } from "../ui/hard-delete-dialog.js";
export class CampaignsController {
  constructor({ service, content }) { this.service=service; this.content=content; this.filters={query:"",status:""}; }
  render() {
    const state=this.service.state;
    this.content.innerHTML=renderCampaigns({campaigns:this.service.list(this.filters),clients:state.clients,squads:state.groups,responsibles:state.responsibles,filters:this.filters,gaps:this.service.findClientCampaignGaps()});
    this.content.querySelector('[data-action="add"]')?.addEventListener("click",()=>this.openForm());
    this.content.querySelector('[data-action="search"]')?.addEventListener("input",(event)=>{this.filters.query=event.target.value;this.render();});
    this.content.querySelector('[data-action="status"]')?.addEventListener("change",(event)=>{this.filters.status=event.target.value;this.render();});
    this.content.querySelectorAll('[data-action="view"]').forEach((button)=>button.addEventListener("click",()=>this.detail(button.dataset.id)));
    this.content.querySelectorAll('[data-action="edit"]').forEach((button)=>button.addEventListener("click",()=>this.openForm(button.dataset.id)));
    this.content.querySelectorAll('[data-action="hard-delete"]').forEach((button)=>button.addEventListener("click",()=>this.hardDelete(button.dataset.id)));
    this.content.querySelectorAll('[data-action="open-number"]').forEach((button)=>button.addEventListener("click",()=>{window.location.hash=`#numbers/${button.dataset.id}`;}));
    this.content.querySelectorAll('[data-action="close"]').forEach((button)=>button.addEventListener("click",async()=>{
      if(!confirm("Encerrar esta campanha?"))return;
      try{this.service.close(button.dataset.id);await this.service.flush();showToast("Campanha encerrada.","warning");this.render();}catch(error){showToast(error.message,"error");}
    }));
    this.content.querySelectorAll('[data-action="reactivate"]').forEach((button)=>button.addEventListener("click",async()=>{
      if(!confirm("Reativar esta campanha? Ela voltará a ficar disponível para novos vínculos."))return;
      try{this.service.reactivate(button.dataset.id);await this.service.flush();showToast("Campanha reativada.","success");this.render();}catch(error){showToast(error.message,"error");}
    }));
  }
  detail(id) {
    const item=this.service.get(id);if(!item)return this.render();const state=this.service.state;
    this.content.innerHTML=renderCampaignDetail({item,clients:state.clients,squads:state.groups,responsibles:state.responsibles,numbers:state.numbers,locations:state.locations,allLinks:state.numberCampaignLinks,links:state.numberCampaignLinks.filter((link)=>link.campaignId===id).sort((a,b)=>(b.startedAt||"").localeCompare(a.startedAt||""))});
    this.content.querySelector('[data-action="back"]')?.addEventListener("click",()=>{if(window.location.hash!=="#campaigns")window.location.hash="#campaigns";else this.render();});
    this.content.querySelector('[data-action="add-links"]')?.addEventListener("click",()=>this.openLinkForm(id));
    this.content.querySelector('[data-action="hard-delete"]')?.addEventListener("click",()=>this.hardDelete(id,true));
    this.content.querySelector('[data-action="close"]')?.addEventListener("click",async()=>{
      if(!confirm("Encerrar esta campanha?"))return;
      try{this.service.close(id);await this.service.flush();showToast("Campanha encerrada.","warning");this.detail(id);}catch(error){showToast(error.message,"error");}
    });
    this.content.querySelector('[data-action="reactivate"]')?.addEventListener("click",async()=>{
      if(!confirm("Reativar esta campanha? Ela voltará a ficar disponível para novos vínculos."))return;
      try{this.service.reactivate(id);await this.service.flush();showToast("Campanha reativada.","success");this.detail(id);}catch(error){showToast(error.message,"error");}
    });
    this.content.querySelectorAll('[data-action="end-link"]').forEach((button)=>button.addEventListener("click",async()=>{
      if(!confirm("Encerrar este vínculo? O histórico será preservado."))return;
      try{this.service.unassign(button.dataset.numberId,id);await this.service.flush();showToast("Vínculo encerrado.","warning");this.detail(id);}catch(error){showToast(error.message,"error");}
    }));
  }
  async hardDelete(id,fromDetail=false) {
    const campaign=this.service.get(id);
    if(!campaign)return;
    if(!(await confirmHardDelete(this.content,{entity:"campaigns",state:this.service.state,id,name:campaign.name,typeLabel:"campanha"})))return;
    try{
      await this.service.hardDelete(id);
      await this.service.flush();
      showToast("Campanha excluída definitivamente.","warning");
      if(fromDetail)window.location.hash="#campaigns";else this.render();
    }catch(error){showToast(error.message,"error");}
  }
  openForm(id=null) {
    const state=this.service.state;
    this.content.insertAdjacentHTML("beforeend",renderCampaignForm({item:id?this.service.get(id):{},clients:state.clients.filter((item)=>item.isActive),squads:state.groups.filter((item)=>item.isActive),responsibles:state.responsibles.filter((item)=>item.isActive),numbers:state.numbers,links:id?this.service.activeLinksForCampaign(id):[]}));
    const close=()=>this.content.querySelector(".modal-backdrop")?.remove();
    this.content.querySelectorAll('[data-action="close-form"]').forEach((button)=>button.addEventListener("click",close));
    this.content.querySelector('[data-action="add-links-inline"]')?.addEventListener("click",()=>{close();this.openLinkForm(id,{onDone:()=>this.openForm(id)});});
    this.content.querySelectorAll('[data-action="remove-link-inline"]').forEach((button)=>button.addEventListener("click",async()=>{
      if(!confirm("Encerrar este vínculo? O histórico será preservado."))return;
      try{this.service.unassign(button.dataset.numberId,id);await this.service.flush();close();showToast("Vínculo encerrado.","warning");this.openForm(id);}catch(error){showToast(error.message,"error");}
    }));
    const form=this.content.querySelector("#campaign-form");
    const squadSelect=form?.elements.squadId,clientSelect=form?.elements.clientId,squadHint=form?.querySelector("[data-squad-hint]");
    // Cliente -> Squad: selecionar o cliente deriva e trava o Squad da campanha.
    const syncSquadFromClient=()=>{
      if(!clientSelect||!squadSelect)return;
      const squadId=clientSelect.selectedOptions[0]?.dataset.squad||"";
      if(squadId){squadSelect.value=squadId;squadSelect.disabled=true;if(squadHint)squadHint.textContent="Squad definido pelo Cliente selecionado.";}
      else{squadSelect.disabled=false;if(squadHint)squadHint.textContent="Este cliente não tem Squad — selecione um Squad para a campanha.";}
    };
    clientSelect?.addEventListener("change",syncSquadFromClient);
    if(clientSelect?.value)syncSquadFromClient();
    form?.addEventListener("submit",(event)=>guardedSubmit(form,event,async()=>{
      try{
        if(squadSelect)squadSelect.disabled=false; // garante que entra no FormData
        const values=Object.fromEntries(new FormData(form));
        id?this.service.update(id,values):this.service.create(values);
        await this.service.flush();close();showToast(id?"Campanha atualizada.":"Campanha criada.","success");this.render();
      }
      catch(error){if(squadSelect&&clientSelect?.selectedOptions[0]?.dataset.squad)squadSelect.disabled=true;showToast(error.message,"error");}
    }));
  }
  openLinkForm(campaignId,{onDone}={}) {
    const campaign=this.service.get(campaignId);if(!campaign)return;
    const done=onDone||(()=>this.detail(campaignId));
    this.content.insertAdjacentHTML("beforeend",renderCampaignLinkAddForm({campaign,numbers:this.service.availableNumbersFor(campaignId)}));
    const close=()=>this.content.querySelector(".modal-backdrop")?.remove();
    this.content.querySelectorAll('[data-action="close-form"]').forEach((button)=>button.addEventListener("click",close));
    const form=this.content.querySelector("#campaign-add-links-form");
    form?.querySelector("[data-link-search]")?.addEventListener("input",(event)=>{
      const query=event.target.value.trim().toLocaleLowerCase("pt-BR");
      const rows=[...form.querySelectorAll("[data-relation-option]")];
      let visible=0;
      rows.forEach((row)=>{const matches=!query||row.textContent.toLocaleLowerCase("pt-BR").includes(query);row.hidden=!matches;if(matches)visible++;});
      const empty=form.querySelector("[data-link-empty]");
      if(empty)empty.hidden=visible!==0||rows.length===0;
    });
    form?.addEventListener("submit",(event)=>guardedSubmit(form,event,async()=>{
      try{
        const formData=new FormData(form);
        const numberIds=formData.getAll("numberIds");
        if(!numberIds.length) throw new Error("Selecione ao menos um número.");
        numberIds.forEach((numberId)=>this.service.assign(numberId,campaignId,formData.get(`role_${numberId}`)||"PRIMARY"));
        await this.service.flush();
        close();
        showToast(numberIds.length>1?"Números vinculados à campanha.":"Número vinculado à campanha.","success");
        done();
      } catch(error){showToast(error.message,"error");}
    }));
  }
}
