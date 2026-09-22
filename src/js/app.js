import { AppRepository } from "./repositories/app-repository.js";
import { SupabaseStateRepository } from "./repositories/supabase-state-repository.js";
import { NumbersService } from "./services/numbers-service.js";
import { NumbersController } from "./controllers/numbers-controller.js";
import { DirectoryController } from "./controllers/directory-controller.js";
import { DirectoryService } from "./services/directory-service.js";
import { HistoryService } from "./services/history-service.js";
import { IncidentsService } from "./services/incidents-service.js";
import { IncidentsController } from "./controllers/incidents-controller.js";
import { HistoryController } from "./controllers/history-controller.js";
import { DashboardService } from "./services/dashboard-service.js";
import { DashboardController } from "./controllers/dashboard-controller.js";
import { GuideController } from "./controllers/guide-controller.js";
import { BackupService } from "./services/backup-service.js";
import { BackupController } from "./controllers/backup-controller.js";
import { CampaignsService } from "./services/campaigns-service.js";
import { CampaignsController } from "./controllers/campaigns-controller.js";
import { ApprovedSpreadsheetMigrationService } from "./services/approved-spreadsheet-migration-service.js";
import { TestDataCleanupService } from "./services/test-data-cleanup-service.js";
import { getViewTitle, renderView } from "./ui/views.js";
import { BotService } from "./services/bot-service.js";
import { BotController } from "./controllers/bot-controller.js";
import { createConfiguredSupabaseClient } from "./infra/supabase-client.js";
import { SupabaseAuthRepository } from "./repositories/supabase-auth-repository.js";
import { createSupabaseRepositories } from "./repositories/supabase-repository.js";
import { AuthService } from "./services/auth-service.js";
import { AuthController } from "./controllers/auth-controller.js";
import { ProfilesService } from "./services/profiles-service.js";
import { ProfilesController } from "./controllers/profiles-controller.js";
import { SignupAuthorizationsService } from "./services/signup-authorizations-service.js";
import { AuditLogService } from "./services/audit-log-service.js";
import { AuditLogController } from "./controllers/audit-log-controller.js";
import { AboutController } from "./controllers/about-controller.js";
import { ACCESS_LEVEL_LABELS, isAdminOrAbove, isMaster } from "./models/access.js";
import { initTheme, bindThemeToggles } from "./ui/theme-toggle.js";
import { PushService } from "./services/push-service.js";
import { bindPushToggle } from "./ui/push-toggle.js";
import { VAPID_PUBLIC_KEY } from "./config/supabase-runtime.js";
import { observeTableScrollHints } from "./ui/table-scroll-hint.js";
import { observeSearchableSelects } from "./ui/searchable-select.js";

initTheme();
bindThemeToggles();

const content=document.querySelector("#page-content");
observeTableScrollHints(content);
observeSearchableSelects(content);
const title=document.querySelector("#page-title");
const navigationLinks=document.querySelectorAll("[data-view]");
const appShell=document.querySelector(".app-shell");
const topbar=document.querySelector(".topbar");
const menuToggle=document.querySelector("[data-mobile-nav-toggle]");
const mobileNavClose=document.querySelector("[data-mobile-nav-close]");
const logoutButton=document.querySelector("[data-auth-logout]");
let controllers=null;
let profilesController=null;
let auditLogController=null;
let internalRoutesEnabled=false;
new AboutController({trigger:document.querySelector("[data-about-open]")}).bind();

function createOperationalControllers(repository,{runLegacyMaintenance=false,hardDeletePort=null,integrationEventsRepository=null,externalNumbersRepository=null,incidentsRepository=null,historyEventsRepository=null,currentProfile=null}={}) {
  const numbersService=new NumbersService(repository,{hardDeletePort});
  if(runLegacyMaintenance) {
    const migration=new ApprovedSpreadsheetMigrationService(numbersService).run();
    const cleanup=new TestDataCleanupService(numbersService).run();
    if(migration.created||migration.alreadyCompleted) console.info("Migração inicial aprovada:",migration);
    if(cleanup.removedNumbers?.length||cleanup.alreadyCompleted) console.info("Limpeza de dados de teste:",cleanup);
  }
  const campaignsService=new CampaignsService(numbersService);
  campaignsService.reconcileClientSquadFromActiveLinks();
  const directoryService=new DirectoryService(numbersService);
  return {
    numbersService,
    numbers:new NumbersController({service:numbersService,campaignsService,content}),
    campaigns:new CampaignsController({service:campaignsService,content,currentProfile}),
    directories:Object.fromEntries(["clients","groups","responsibles","locations"].map((type)=>[type,new DirectoryController({service:directoryService,campaignsService,content,type})])),
    incidents:new IncidentsController({service:new IncidentsService(numbersService,new HistoryService(numbersService)),numbers:numbersService,content}),
    history:new HistoryController({service:new HistoryService(numbersService),numbers:numbersService,content}),
    dashboard:new DashboardController({service:new DashboardService(numbersService),content}),
    guide:new GuideController({content}),
    backup:new BackupController({service:new BackupService(numbersService),content}),
    // Central Number Ops Bot — leitura. Sem repository (modo local/offline) ela
    // mesma mostra um estado "indisponível", sem quebrar a rota.
    bot:new BotController({service:new BotService({integrationEventsRepository,externalNumbersRepository,incidentsRepository,historyEventsRepository,numbersService,currentProfile}),content}),
  };
}

// Notificação push ("número caiu") — registra o service worker e liga o botão do topbar
// só depois de autenticado (a inscrição é vinculada ao profile). Se o navegador não suportar
// (ou o registro falhar), PushService.available fica false e o botão continua escondido —
// nunca quebra o resto do app.
async function initPush(repository,profileId) {
  let registration=null;
  try{ if("serviceWorker" in navigator) registration=await navigator.serviceWorker.register("./service-worker.js"); }
  catch{ registration=null; }
  const pushService=new PushService({
    pushManager:registration?.pushManager??null,
    requestPermission:typeof Notification!=="undefined"?()=>Notification.requestPermission():null,
    getPermission:typeof Notification!=="undefined"?()=>Notification.permission:null,
    repository,
    profileId,
    vapidPublicKey:VAPID_PUBLIC_KEY,
    userAgent:navigator.userAgent,
  });
  bindPushToggle(pushService);
}

// "Números" reúne, como abas (dentro dos próprios controllers — ver
// NumbersController.render/DirectoryController.render), a lista de números
// e a área de Localizações — ambas continuam sendo as mesmas telas/rotas de
// sempre, só deixam de ocupar item próprio na sidebar. "locations" nunca
// colide com um id real de número (createId sempre gera "number_<uuid>").
function showView(viewName) {
  if(!controllers)return;
  const [view,resourceId]=viewName.split("/");
  if(view==="dashboard")controllers.dashboard.render();
  else if(view==="numbers"&&resourceId==="locations")controllers.directories.locations.render();
  else if(view==="numbers"&&resourceId)controllers.numbers.showDetail(resourceId);
  else if(view==="numbers")controllers.numbers.render();
  else if(view==="campaigns")resourceId?controllers.campaigns.detail(resourceId):controllers.campaigns.render();
  else if(view==="profiles"&&profilesController)profilesController.render();
  else if(view==="activity"&&auditLogController)auditLogController.render();
  else if(view==="activity"){window.location.hash="#dashboard";return;}
  else if(view==="bot")controllers.bot.render();
  else if(controllers.directories[view])controllers.directories[view].render();
  else if(view==="incidents"&&resourceId)controllers.incidents.detail(resourceId);
  else if(view==="incidents")controllers.incidents.render();
  else if(view==="history")controllers.history.render();
  else if(view==="guide")controllers.guide.render();
  else if(view==="backup")controllers.backup.render();
  else if(views_has(view))content.innerHTML=renderView(view);
  else {window.location.hash="#dashboard";return;}
  title.textContent=getViewTitle(view);
  navigationLinks.forEach((link)=>link.classList.toggle("is-active",link.dataset.view===view));
  setMobileNavigation(false);
}

function views_has(view){return ["clients","groups","responsibles","locations","numbers","campaigns","incidents","history","guide","backup","dashboard","profiles","activity"].includes(view);}

function currentView(){return window.location.hash.slice(1)||"dashboard";}
function setMobileNavigation(open){appShell.classList.toggle("is-nav-open",open);menuToggle.setAttribute("aria-expanded",String(open));menuToggle.setAttribute("aria-label",open?"Fechar menu":"Abrir menu");}
function updateStickyHeader(){const compact=window.scrollY>12;topbar.classList.toggle("is-compact",compact);appShell.classList.toggle("has-compact-header",compact);}

window.addEventListener("hashchange",()=>{if(internalRoutesEnabled)showView(currentView());});
window.addEventListener("scroll",updateStickyHeader,{passive:true});
menuToggle.addEventListener("click",()=>setMobileNavigation(!appShell.classList.contains("is-nav-open")));
mobileNavClose.addEventListener("click",()=>setMobileNavigation(false));
navigationLinks.forEach((link)=>link.addEventListener("click",()=>setMobileNavigation(false)));
window.addEventListener("keydown",(event)=>{if(event.key==="Escape"){content.querySelector(".modal-backdrop")?.remove();setMobileNavigation(false);}});
window.matchMedia("(min-width: 861px)").addEventListener("change",(event)=>{if(event.matches)setMobileNavigation(false);});

function clearAuthHash(){ window.history.replaceState(null,"",window.location.pathname+window.location.search); }

async function bootstrap() {
  const hashParams=new URLSearchParams(window.location.hash.replace(/^#/,""));
  const isPasswordRecovery=hashParams.get("type")==="recovery";
  const confirmationType=hashParams.get("type");
  const authErrorDescription=hashParams.get("error_description")||hashParams.get("error_code")||hashParams.get("error");
  const supabase=await createConfiguredSupabaseClient();
  if(!supabase) {
    controllers=createOperationalControllers(new AppRepository(),{runLegacyMaintenance:true});
    internalRoutesEnabled=true;
    showView(currentView());
    updateStickyHeader();
    bindThemeToggles();
    return;
  }
  const repositories=createSupabaseRepositories(supabase);
  const authService=new AuthService(new SupabaseAuthRepository(supabase));
  const authController=new AuthController({service:authService,root:appShell});
  if(isPasswordRecovery) { authController.mode="reset"; await authController.render(); bindThemeToggles(); return; }
  if(hashParams.has("error")) {
    clearAuthHash();
    authController.mode="confirm-error";
    authController.message=String(authErrorDescription).replace(/\+/g," ");
    await authController.render();
    bindThemeToggles();
    return;
  }
  if(confirmationType==="signup"||confirmationType==="email_change"||confirmationType==="invite") {
    try{await authService.signOut();}catch{ /* nenhuma sessão ativa a encerrar */ }
    clearAuthHash();
    authController.mode="confirmed";
    await authController.render();
    bindThemeToggles();
    return;
  }
  let authenticated=null;
  try{authenticated=await authService.getActiveSession();}catch{await authController.render();bindThemeToggles();return;}
  if(!authenticated){await authController.render();bindThemeToggles();return;}
  appShell.classList.remove("is-auth-screen");
  appShell.dataset.accessLevel=authenticated.profile.access_level;
  content.innerHTML='<section class="directory-empty"><div><h2>Carregando dados compartilhados…</h2><p>Sincronizando com o Supabase.</p></div></section>';
  const remoteRepository=await SupabaseStateRepository.create(supabase);
  const hardDeletePort={numbers:repositories.numbers,clients:repositories.clients,groups:repositories.squads,responsibles:repositories.responsibles,locations:repositories.locations,campaigns:repositories.campaigns};
  controllers=createOperationalControllers(remoteRepository,{hardDeletePort,integrationEventsRepository:repositories.integrationEvents,externalNumbersRepository:repositories.externalNumbers,incidentsRepository:repositories.incidents,historyEventsRepository:repositories.historyEvents,currentProfile:authenticated.profile});
  profilesController=new ProfilesController({service:new ProfilesService(repositories.profiles,repositories.squads),authorizationsService:new SignupAuthorizationsService(repositories.signupAuthorizations),content,currentProfile:authenticated.profile});
  if(isAdminOrAbove(authenticated.profile)) auditLogController=new AuditLogController({service:new AuditLogService({repository:repositories.auditLogs,profilesRepository:repositories.profiles,squadsRepository:repositories.squads,numbersService:controllers.numbersService,currentProfile:authenticated.profile}),content});
  document.querySelectorAll("[data-admin-only]").forEach((item)=>{item.hidden=!isAdminOrAbove(authenticated.profile);});
  document.querySelectorAll("[data-master-only]").forEach((item)=>{item.hidden=!isMaster(authenticated.profile);});
  const profileLabel=document.createElement("span");
  profileLabel.dataset.profileLabel="";
  profileLabel.className="environment-label";
  profileLabel.textContent=`${authenticated.profile.name} · ${ACCESS_LEVEL_LABELS[authenticated.profile.access_level]??authenticated.profile.access_level}`;
  logoutButton.before(profileLabel);
  authController.bindLogout(logoutButton);
  internalRoutesEnabled=true;
  initPush(repositories.pushSubscriptions,authenticated.profile.id).catch(()=>{ /* notificação nunca pode travar o resto do app */ });
  showView(currentView());
  updateStickyHeader();
  bindThemeToggles();
  authService.onAuthStateChange((event)=>{if(event==="SIGNED_OUT")window.location.reload();});
}

bootstrap().catch((error)=>{
  console.error("Falha ao iniciar o Number Ops.",error);
  content.innerHTML='<section class="directory-empty"><div><h2>Não foi possível carregar os dados compartilhados</h2><p>Verifique sua conexão e tente novamente. A base local não foi usada como substituta automática.</p></div></section>';
});
