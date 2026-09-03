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
import { createConfiguredSupabaseClient } from "./infra/supabase-client.js";
import { SupabaseAuthRepository } from "./repositories/supabase-auth-repository.js";
import { createSupabaseRepositories } from "./repositories/supabase-repository.js";
import { AuthService } from "./services/auth-service.js";
import { AuthController } from "./controllers/auth-controller.js";
import { ProfilesService } from "./services/profiles-service.js";
import { ProfilesController } from "./controllers/profiles-controller.js";
import { AuditLogService } from "./services/audit-log-service.js";
import { AuditLogController } from "./controllers/audit-log-controller.js";
import { AboutController } from "./controllers/about-controller.js";

const content=document.querySelector("#page-content");
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

function createOperationalControllers(repository,{runLegacyMaintenance=false}={}) {
  const numbersService=new NumbersService(repository);
  if(runLegacyMaintenance) {
    const migration=new ApprovedSpreadsheetMigrationService(numbersService).run();
    const cleanup=new TestDataCleanupService(numbersService).run();
    if(migration.created||migration.alreadyCompleted) console.info("Migração inicial aprovada:",migration);
    if(cleanup.removedNumbers?.length||cleanup.alreadyCompleted) console.info("Limpeza de dados de teste:",cleanup);
  }
  const campaignsService=new CampaignsService(numbersService);
  const directoryService=new DirectoryService(numbersService);
  return {
    numbersService,
    numbers:new NumbersController({service:numbersService,campaignsService,content}),
    campaigns:new CampaignsController({service:campaignsService,content}),
    directories:Object.fromEntries(["clients","groups","responsibles"].map((type)=>[type,new DirectoryController({service:directoryService,campaignsService,content,type})])),
    incidents:new IncidentsController({service:new IncidentsService(numbersService,new HistoryService(numbersService)),numbers:numbersService,content}),
    history:new HistoryController({service:new HistoryService(numbersService),numbers:numbersService,content}),
    dashboard:new DashboardController({service:new DashboardService(numbersService),content}),
    guide:new GuideController({content}),
    backup:new BackupController({service:new BackupService(numbersService),content}),
  };
}

function showView(viewName) {
  if(!controllers)return;
  const [view,resourceId]=viewName.split("/");
  if(view==="dashboard")controllers.dashboard.render();
  else if(view==="numbers")resourceId?controllers.numbers.showDetail(resourceId):controllers.numbers.render();
  else if(view==="campaigns")resourceId?controllers.campaigns.detail(resourceId):controllers.campaigns.render();
  else if(view==="profiles"&&profilesController)profilesController.render();
  else if(view==="activity"&&auditLogController)auditLogController.render();
  else if(view==="activity"){window.location.hash="#dashboard";return;}
  else if(controllers.directories[view])controllers.directories[view].render();
  else if(view==="incidents")controllers.incidents.render();
  else if(view==="history")controllers.history.render();
  else if(view==="guide")controllers.guide.render();
  else if(view==="backup")controllers.backup.render();
  else content.innerHTML=renderView(view);
  title.textContent=getViewTitle(view);
  navigationLinks.forEach((link)=>link.classList.toggle("is-active",link.dataset.view===view));
  setMobileNavigation(false);
}

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

async function bootstrap() {
  const supabase=await createConfiguredSupabaseClient();
  if(!supabase) {
    controllers=createOperationalControllers(new AppRepository(),{runLegacyMaintenance:true});
    internalRoutesEnabled=true;
    showView(currentView());
    updateStickyHeader();
    return;
  }
  const repositories=createSupabaseRepositories(supabase);
  const authService=new AuthService(new SupabaseAuthRepository(supabase));
  const authController=new AuthController({service:authService,root:appShell});
  let authenticated=null;
  try{authenticated=await authService.getActiveSession();}catch{await authController.render();return;}
  if(!authenticated){await authController.render();return;}
  appShell.classList.remove("is-auth-screen");
  appShell.dataset.accessLevel=authenticated.profile.access_level;
  content.innerHTML='<section class="directory-empty"><div><h2>Carregando dados compartilhados…</h2><p>Sincronizando com o Supabase.</p></div></section>';
  const remoteRepository=await SupabaseStateRepository.create(supabase);
  controllers=createOperationalControllers(remoteRepository);
  profilesController=new ProfilesController({service:new ProfilesService(repositories.profiles,repositories.squads),content,currentProfile:authenticated.profile});
  if(authenticated.profile.access_level==="ADMIN") auditLogController=new AuditLogController({service:new AuditLogService({repository:repositories.auditLogs,profilesRepository:repositories.profiles,squadsRepository:repositories.squads,numbersService:controllers.numbersService,currentProfile:authenticated.profile}),content});
  document.querySelectorAll("[data-admin-only]").forEach((item)=>{item.hidden=authenticated.profile.access_level!=="ADMIN";});
  const profileLabel=document.createElement("span");
  profileLabel.dataset.profileLabel="";
  profileLabel.className="environment-label";
  profileLabel.textContent=authenticated.profile.name;
  logoutButton.before(profileLabel);
  authController.bindLogout(logoutButton);
  internalRoutesEnabled=true;
  showView(currentView());
  updateStickyHeader();
  authService.onAuthStateChange((event)=>{if(event==="SIGNED_OUT")window.location.reload();});
}

bootstrap().catch((error)=>{
  console.error("Falha ao iniciar o Number Ops.",error);
  content.innerHTML='<section class="directory-empty"><div><h2>Não foi possível carregar os dados compartilhados</h2><p>Verifique sua conexão e tente novamente. A base local não foi usada como substituta automática.</p></div></section>';
});
