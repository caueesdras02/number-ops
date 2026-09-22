import { renderCampaignDetail, renderCampaignForm, renderCampaignLinkAddForm, renderCampaignRows, renderCampaigns, renderChangeRoleForm, stageMenuItemsFor } from "../ui/campaigns-view.js";
import { openStageMenu, closeActiveStageMenu, isStageMenuOpenFor } from "../ui/stage-dropdown.js";
import { showToast } from "../ui/toast.js";
import { guardedSubmit } from "../ui/form-submit-guard.js";
import { confirmHardDelete } from "../ui/hard-delete-dialog.js";
import { confirmDialog } from "../ui/confirm-dialog.js";
import { canOperate } from "../models/access.js";
import { matchesSearch } from "../models/search-match.js";
export class CampaignsController {
  constructor({ service, content, currentProfile = null }) { this.service=service; this.content=content; this.filters={query:"",status:"",stage:""}; this.currentProfile=currentProfile; }
  // Diálogos reaproveitados nos 2-3 pontos que disparam a mesma ação (lista, detalhe, seletor de
  // Situação) — um só lugar pra manter o texto, nunca duplicado por cópia-e-cola.
  confirmCloseCampaign() {
    return confirmDialog(this.content, {
      icon: "!",
      title: "Encerrar esta campanha?",
      bodyHtml: `<p>Os vínculos ativos com números serão encerrados e o histórico será preservado.</p>`,
      confirmLabel: "Encerrar campanha",
      tone: "danger",
    });
  }
  confirmReactivateCampaign() {
    return confirmDialog(this.content, {
      icon: "!",
      title: "Reativar esta campanha?",
      bodyHtml: `<p>Ela voltará a ficar disponível para novos vínculos de número.</p>`,
      confirmLabel: "Reativar campanha",
      tone: "primary",
    });
  }
  confirmEndLink() {
    return confirmDialog(this.content, {
      icon: "!",
      title: "Encerrar este vínculo?",
      bodyHtml: `<p>O histórico será preservado — o número continua consultável depois.</p>`,
      confirmLabel: "Encerrar vínculo",
      tone: "danger",
    });
  }
  /** Um único filtro de Situação na UI (Captação / Tá rolando·Pós live / Encerrada) mapeado
   * pros dois filtros internos que o service ainda trata separado (status/stage) — não duplica
   * o conceito pro usuário, só traduz pra dentro. */
  applySituacaoFilter(value) {
    if (value === "ENCERRADA") { this.filters.status = "CLOSED"; this.filters.stage = ""; }
    else if (value) { this.filters.status = "ACTIVE"; this.filters.stage = value; }
    else { this.filters.status = ""; this.filters.stage = ""; }
  }
  // Sem profile (modo local/offline, sem Supabase) = acesso total, igual ao resto do app nesse
  // modo (não passa por RLS nem pelo `data-access-level` do app-shell). Só restringe quando existe
  // um profile autenticado E ele é VIEWER.
  get canEdit() { return !this.currentProfile || canOperate(this.currentProfile); }
  render() {
    const state=this.service.state;
    this.content.innerHTML=renderCampaigns({campaigns:this.service.list(this.filters),clients:state.clients,squads:state.groups,responsibles:state.responsibles,filters:this.filters,gaps:this.service.findClientCampaignGaps(),canEdit:this.canEdit});
    this.content.querySelector('[data-action="add"]')?.addEventListener("click",()=>this.openForm());
    // Digitar não repinta a página inteira (isso destruiria e recriaria este <input>, derrubando
    // o foco a cada letra) — só as linhas da tabela são atualizadas, ver renderResults().
    this.content.querySelector('[data-action="search"]')?.addEventListener("input",(event)=>{this.filters.query=event.target.value;this.renderResults();});
    this.content.querySelector('[data-action="situacao-filter"]')?.addEventListener("change",(event)=>{this.applySituacaoFilter(event.target.value);this.render();});
    this.content.querySelectorAll('[data-action="open-number"]').forEach((button)=>button.addEventListener("click",()=>{window.location.hash=`#numbers/${button.dataset.id}`;})); // linhas do relatório de vínculos faltando (gap-report), não muda com a busca
    this.bindListActions();
  }
  /** Delegado no <tbody> (um listener só, não um por botão/linha): continua funcionando depois
   * que renderResults() troca o innerHTML das linhas a cada busca, sem precisar religar nada.
   * Cobre também o gatilho de Etapa (stage-open), que também vive dentro de cada linha. */
  bindListActions() {
    const tbody=this.content.querySelector(".table-card tbody");
    if(!tbody||tbody.dataset.actionsBound==="true")return;
    tbody.dataset.actionsBound="true";
    tbody.addEventListener("click",async(event)=>{
      const stageTrigger=event.target.closest('[data-action="stage-open"]');
      if(stageTrigger){
        if(isStageMenuOpenFor(stageTrigger)){closeActiveStageMenu();return;}
        const id=stageTrigger.dataset.id;
        const item=this.service.get(id);
        if(!item)return;
        openStageMenu(stageTrigger,{items:stageMenuItemsFor(item.status),current:item.stage,onSelect:(value)=>this.handleStageSelect(id,value,false)});
        return;
      }
      const button=event.target.closest("[data-action]");
      if(!button)return;
      const id=button.dataset.id;
      const action=button.dataset.action;
      if(action==="view")this.detail(id);
      else if(action==="edit")this.openForm(id);
      else if(action==="hard-delete")this.hardDelete(id);
      else if(action==="close"){
        if(!(await this.confirmCloseCampaign()))return;
        try{this.service.close(id);await this.service.flush();showToast("Campanha encerrada.","warning");this.render();}catch(error){showToast(error.message,"error");}
      }else if(action==="reactivate"){
        if(!(await this.confirmReactivateCampaign()))return;
        try{this.service.reactivate(id);await this.service.flush();showToast("Campanha reativada.","success");this.render();}catch(error){showToast(error.message,"error");}
      }
    });
  }
  /** Só re-renderiza as linhas da tabela (mesma função usada no HTML completo, ver
   * renderCampaignRows) — busca, filtro de Situação e o resto da página não mudam. */
  renderResults() {
    const tbody=this.content.querySelector(".table-card tbody");
    if(!tbody)return this.render();
    const state=this.service.state;
    tbody.innerHTML=renderCampaignRows(this.service.list(this.filters),state.clients,state.groups,state.responsibles,this.canEdit);
    // Recalcula o fade de scroll horizontal da tabela (table-scroll-hint.js já escuta 'scroll' no
    // .table-scroll) — sem isso, o fade ficaria desatualizado depois que a busca muda a largura útil.
    this.content.querySelector(".table-scroll")?.dispatchEvent(new Event("scroll"));
  }
  /** Etapa operacional: abre o popover customizado (ui/stage-dropdown.js) com as opções da
   * campanha ACTIVE (Captação / Tá rolando·Pós live / Encerrada). Mesmo widget na listagem e no
   * detalhe; só existe como botão quando ACTIVE e canEdit — campanha CLOSED ou VIEWER só vê o
   * badge estático (view), então este código nunca roda nesses casos — dupla proteção, sem
   * duplicar lógica de RBAC. */
  bindStageTriggers() {
    const onDetail=Boolean(this.content.querySelector('[data-action="back"]'));
    this.content.querySelectorAll('[data-action="stage-open"]').forEach((trigger)=>trigger.addEventListener("click",()=>{
      if(isStageMenuOpenFor(trigger)){closeActiveStageMenu();return;}
      const id=trigger.dataset.id;
      const item=this.service.get(id);
      if(!item)return;
      openStageMenu(trigger,{
        items:stageMenuItemsFor(item.status),
        current:item.stage,
        onSelect:(value)=>this.handleStageSelect(id,value,onDetail),
      });
    }));
  }
  /** "Encerrada" reaproveita close() com segurança — mesmo fluxo oficial (confirmação,
   * encerra vínculos, preserva histórico) usado pelo botão "Encerrar campanha"; nunca duplicado
   * aqui. Qualquer outra opção só troca a etapa operacional (changeStage), sem tocar status. */
  async handleStageSelect(id,value,onDetail) {
    try{
      if(value==="ENCERRADA"){
        if(!(await this.confirmCloseCampaign()))return;
        this.service.close(id);
        await this.service.flush();
        showToast("Campanha encerrada.","warning");
      }else{
        this.service.changeStage(id,value);
        await this.service.flush();
        showToast("Etapa atualizada.","success");
      }
    }catch(error){showToast(error.message,"error");return;}
    onDetail?this.detail(id):this.render();
  }
  detail(id) {
    const item=this.service.get(id);if(!item)return this.render();const state=this.service.state;
    this.content.innerHTML=renderCampaignDetail({item,clients:state.clients,squads:state.groups,responsibles:state.responsibles,numbers:state.numbers,locations:state.locations,allLinks:state.numberCampaignLinks,links:state.numberCampaignLinks.filter((link)=>link.campaignId===id).sort((a,b)=>(b.startedAt||"").localeCompare(a.startedAt||"")),canEdit:this.canEdit});
    this.bindStageTriggers();
    this.content.querySelector('[data-action="back"]')?.addEventListener("click",()=>{if(window.location.hash!=="#campaigns")window.location.hash="#campaigns";else this.render();});
    this.content.querySelector('[data-action="add-links"]')?.addEventListener("click",()=>this.openLinkForm(id));
    this.content.querySelector('[data-action="hard-delete"]')?.addEventListener("click",()=>this.hardDelete(id,true));
    this.content.querySelector('[data-action="close"]')?.addEventListener("click",async()=>{
      if(!(await this.confirmCloseCampaign()))return;
      try{this.service.close(id);await this.service.flush();showToast("Campanha encerrada.","warning");this.detail(id);}catch(error){showToast(error.message,"error");}
    });
    this.content.querySelector('[data-action="reactivate"]')?.addEventListener("click",async()=>{
      if(!(await this.confirmReactivateCampaign()))return;
      try{this.service.reactivate(id);await this.service.flush();showToast("Campanha reativada.","success");this.detail(id);}catch(error){showToast(error.message,"error");}
    });
    this.content.querySelectorAll('[data-action="end-link"]').forEach((button)=>button.addEventListener("click",async()=>{
      if(!(await this.confirmEndLink()))return;
      try{this.service.unassign(button.dataset.numberId,id);await this.service.flush();showToast("Vínculo encerrado.","warning");this.detail(id);}catch(error){showToast(error.message,"error");}
    }));
    this.content.querySelectorAll('[data-action="change-role"]').forEach((button)=>button.addEventListener("click",()=>this.openChangeRoleForm(id,button.dataset.numberId,button.dataset.role)));
  }
  openChangeRoleForm(campaignId,numberId,currentRole) {
    const campaign=this.service.get(campaignId);const number=this.service.state.numbers.find((item)=>item.id===numberId);
    if(!campaign||!number)return;
    this.content.insertAdjacentHTML("beforeend",renderChangeRoleForm({numberId,campaignId,phone:number.phone,campaignName:campaign.name,currentRole}));
    const close=()=>this.content.querySelector(".modal-backdrop")?.remove();
    this.content.querySelectorAll('[data-action="close-form"]').forEach((button)=>button.addEventListener("click",close));
    const form=this.content.querySelector("#change-role-form");
    form?.addEventListener("submit",(event)=>guardedSubmit(form,event,async()=>{
      try{
        const role=new FormData(form).get("role");
        this.service.assign(numberId,campaignId,role);
        await this.service.flush();
        close();
        showToast("Função atualizada.","success");
        this.detail(campaignId);
      }catch(error){showToast(error.message,"error");}
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
      if(!(await this.confirmEndLink()))return;
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
      const rows=[...form.querySelectorAll("[data-relation-option]")];
      let visible=0;
      rows.forEach((row)=>{const matches=matchesSearch(row.textContent,event.target.value);row.hidden=!matches;if(matches)visible++;});
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
