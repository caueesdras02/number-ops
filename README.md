# Number Ops

Sistema web para gerenciamento operacional de números utilizados em operações de WhatsApp.

## Sobre o projeto

O Number Ops foi criado para centralizar o controle dos números utilizados pela operação.

A aplicação permite acompanhar informações como:

- Status do número;
- Localização;
- Responsável;
- Clientes relacionados;
- Grupos relacionados;
- Ocorrências;
- Histórico de alterações.
- Campanhas e papéis operacionais;
- Usuários e níveis de acesso;
- Registro de atividades (Audit Log).

O objetivo é facilitar a administração dos números e permitir uma visão rápida da situação operacional de cada um.

## Objetivo

Criar uma ferramenta simples e centralizada para controlar os números utilizados pela empresa, reduzindo a necessidade de controles manuais e informações espalhadas.

## Versão atual

A aplicação é um frontend estático com autenticação e persistência compartilhada no Supabase. O localStorage permanece somente para compatibilidade, recuperação e migração controlada.

Produção: hospedado na Vercel (deploy a partir do branch `main`).

O Audit Log é gerado no banco por triggers autenticadas e consultado por administradores/master em modo somente leitura.

Para uma instalação nova, execute as migrations de `supabase/` **nesta ordem**:
`schema.sql` → `002_operational_policies.sql` → `003_audit_log.sql` → `004_campaign_responsible_and_reactivation.sql` → `005_seed_missing_clients.sql` → `007_audit_locations_responsibles.sql` → `008_master_access_level.sql` → `009_master_permissions_and_cleanup.sql` → `010_location_responsible.sql` → `011_multi_campaign_links.sql` → `012_restrict_directory_writes_to_admin.sql` → `013_integration_events.sql` → `014_incidents_connectivity_tracking.sql` → `015_integration_events_read_access.sql` → `016_external_numbers_and_not_owned_status.sql` → `017_push_notifications.sql` → `018_campaign_stage.sql` → `019_signup_authorizations.sql` → `020_profile_job_title_other.sql` → `021_profile_job_title_other_trigger.sql` → `022_notify_unregistered_number.sql`.

`017` precisa que, **antes** de ser aplicada, você rode uma vez no SQL editor `select vault.create_secret('<valor aleatório longo>', 'push_trigger_secret');` — é um segredo, não fica versionado. `018` adiciona a etapa operacional da campanha (`campaigns.stage`) — independente do status estrutural (ACTIVE/CLOSED). `022` reaproveita o mesmo segredo/Edge Function da `017` (não precisa de nenhum passo manual novo) — só a Edge Function `send-push-notifications` precisa ser redeployada com o handler.js atualizado (ver `supabase/functions/send-push-notifications/`), porque ela passa a aceitar um segundo formato de chamada (`{unregisteredPhone}` além de `{incidentId}`).

`008` adiciona o valor de enum `MASTER` e **deve ser aplicada isolada** (um novo valor de enum não pode ser usado na mesma transação em que é criado); só então aplique `009`, que cria as políticas/trigger do MASTER, adiciona `responsibles.squad_id`, promove o MASTER inicial e remove o usuário de teste. `010` adiciona `locations.responsible_id`. `011` permite que um número tenha vínculos ativos com várias campanhas simultaneamente. `012` restringe a escrita em Clientes/Squads/Colaboradores/Localizações a ADMIN/MASTER. `019` torna o cadastro por convite: só e-mails pré-autorizados por um MASTER (na área de Usuários) conseguem concluir o signup — a checagem é feita em `handle_new_user()` e bloqueia inclusive chamadas diretas ao Supabase Auth, não só o formulário. Não afeta contas já existentes. `020` adiciona o valor de enum `OTHER` ("Outro") a `profile_job_title` e **também deve ser aplicada isolada**, pela mesma regra de `008`; só então aplique `021`, que atualiza `handle_new_user()` para reconhecer o novo cargo no cadastro.

Níveis de acesso: `MASTER` > `ADMIN` > `USER` > `VIEWER`. Somente MASTER altera `access_level`, exclui registros definitivamente ou gerencia autorizações de cadastro. USER opera Números e Campanhas normalmente, mas não cria/edita/arquiva Clientes, Squads, Colaboradores ou Localizações (só consulta) — essa escrita é restrita a ADMIN e MASTER.

## Tecnologias

- HTML5
- CSS3
- JavaScript ES Modules
- Supabase Auth
- Supabase PostgreSQL com Row Level Security
- Vercel

## Estrutura

```text
number-ops/
│
├── docs/
│
├── src/
│   ├── css/
│   ├── js/
│   └── data/
│
├── .gitignore
├── PROJECT.md
├── REQUIREMENTS.md
├── ROADMAP.md
└── README.md
