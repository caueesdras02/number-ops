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

Produção: https://caueesdras02.github.io/number-ops/

O Audit Log é gerado no banco por triggers autenticadas e consultado por administradores/master em modo somente leitura.

Para uma instalação nova, execute as migrations de `supabase/` **nesta ordem**:
`schema.sql` → `002_operational_policies.sql` → `003_audit_log.sql` → `004_campaign_responsible_and_reactivation.sql` → `005_seed_missing_clients.sql` → `007_audit_locations_responsibles.sql` → `008_master_access_level.sql` → `009_master_permissions_and_cleanup.sql` → `010_location_responsible.sql` → `011_multi_campaign_links.sql` → `012_restrict_directory_writes_to_admin.sql`.

`008` adiciona o valor de enum `MASTER` e **deve ser aplicada isolada** (um novo valor de enum não pode ser usado na mesma transação em que é criado); só então aplique `009`, que cria as políticas/trigger do MASTER, adiciona `responsibles.squad_id`, promove o MASTER inicial e remove o usuário de teste. `010` adiciona `locations.responsible_id`. `011` permite que um número tenha vínculos ativos com várias campanhas simultaneamente. `012` restringe a escrita em Clientes/Squads/Colaboradores/Localizações a ADMIN/MASTER.

Níveis de acesso: `MASTER` > `ADMIN` > `USER` > `VIEWER`. Somente MASTER altera `access_level` ou exclui registros definitivamente. USER opera Números e Campanhas normalmente, mas não cria/edita/arquiva Clientes, Squads, Colaboradores ou Localizações (só consulta) — essa escrita é restrita a ADMIN e MASTER.

## Tecnologias

- HTML5
- CSS3
- JavaScript ES Modules
- Supabase Auth
- Supabase PostgreSQL com Row Level Security
- GitHub Pages

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
