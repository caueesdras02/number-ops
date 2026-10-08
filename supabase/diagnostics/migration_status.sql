-- Quais migrations já estão aplicadas neste banco? SOMENTE LEITURA (um único SELECT).
-- Cole no SQL Editor do Supabase e rode. Para cada migration, procura no banco o objeto que só
-- ela cria (tabela, coluna, função, policy, valor de enum).
--
-- situacao:
--   'aplicada'                     -> já está no banco; NÃO rode de novo (vale para schema/002-024)
--   'NÃO aplicada'                 -> falta aplicar (na ordem da coluna "ordem")
--   'VERSÃO ANTIGA — rode de novo' -> foi aplicada uma versão anterior do arquivo; rode a atual
--
-- 025-029 podem ser rodadas de novo sem problema. schema.sql e 002-024 NÃO: algumas regravam
-- policies/funções com versões antigas (ex.: 009 desfaria a 012 e o isolamento por Squad).
with
  fn as (select p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
  pol as (select tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr from pg_policies where schemaname = 'public'),
  col as (select table_name, column_name from information_schema.columns where table_schema = 'public'),
  enum_label as (select t.typname, e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid),
  checks(ordem, migration, aplicada, versao_antiga, observacao) as (values
    (0,  'schema.sql', to_regclass('public.numbers') is not null, false, 'tabelas base'),
    (2,  '002_operational_policies', exists(select 1 from fn where proname = 'registration_squads'), false, ''),
    (3,  '003_audit_log', exists(select 1 from fn where proname = 'append_audit_log'), false, ''),
    (4,  '004_campaign_responsible_and_reactivation', exists(select 1 from col where table_name = 'campaigns' and column_name = 'responsible_id'), false, ''),
    (5,  '005_seed_missing_clients', exists(select 1 from public.clients where lower(name) = lower('3BKASA')), false, 'estimativa: procura um dos clientes semeados'),
    (7,  '007_audit_locations_responsibles', exists(select 1 from pg_trigger where tgname = 'audit_locations_changes' and not tgisinternal), false, ''),
    (8,  '008_master_access_level', exists(select 1 from enum_label where typname = 'access_level' and enumlabel = 'MASTER'), false, 'rodar SOZINHA'),
    (9,  '009_master_permissions_and_cleanup', exists(select 1 from fn where proname = 'current_is_master'), false, ''),
    (10, '010_location_responsible', exists(select 1 from col where table_name = 'locations' and column_name = 'responsible_id'), false, ''),
    (11, '011_multi_campaign_links', to_regclass('public.number_campaign_links_one_active_per_pair_uidx') is not null, false, ''),
    (12, '012_restrict_directory_writes_to_admin', exists(select 1 from pol where tablename = 'clients' and policyname = 'clients_insert' and expr not like '%USER%'), false, ''),
    (13, '013_integration_events', to_regclass('public.integration_events') is not null, false, ''),
    (14, '014_incidents_connectivity_tracking', exists(select 1 from col where table_name = 'incidents' and column_name = 'classification'), false, ''),
    (15, '015_integration_events_read_access', exists(select 1 from pol where policyname = 'integration_events_select'), false, ''),
    (16, '016_external_numbers_and_not_owned_status', to_regclass('public.external_numbers') is not null, false, ''),
    (17, '017_push_notifications', to_regclass('public.push_subscriptions') is not null, false, 'exige o segredo push_trigger_secret no vault antes'),
    (18, '018_campaign_stage', exists(select 1 from col where table_name = 'campaigns' and column_name = 'stage'), false, ''),
    (19, '019_signup_authorizations', to_regclass('public.signup_authorizations') is not null, false, ''),
    (20, '020_profile_job_title_other', exists(select 1 from enum_label where typname = 'profile_job_title' and enumlabel = 'OTHER'), false, 'rodar SOZINHA'),
    (21, '021_profile_job_title_other_trigger', exists(select 1 from fn where proname = 'handle_new_user' and prosrc like '%''OTHER''%'), false, ''),
    (22, '022_notify_unregistered_number', exists(select 1 from fn where proname = 'notify_unregistered_number'), false, ''),
    (23, '023_external_number_campaign_links', to_regclass('public.external_number_campaign_links') is not null, false, ''),
    (24, '024_push_squad_preferences', to_regclass('public.push_subscription_squads') is not null, false, ''),
    (25, '025_squad_scope_helpers', exists(select 1 from fn where proname = 'current_squad_id'),
         exists(select 1 from fn where proname = 'current_squad_id') and not (
           exists(select 1 from fn where proname = 'current_squad_id' and prosrc like '%VIEWER%')
           and exists(select 1 from fn where proname = 'visible_number_ids')
           and exists(select 1 from fn where proname = 'is_unassigned_number')), 'isolamento por Squad (funções)'),
    (26, '026_squad_scope_select_policies', exists(select 1 from pol where policyname = 'numbers_select' and (expr like '%visible_number_ids%' or expr like '%can_see_number%')),
         exists(select 1 from pol where policyname = 'numbers_select' and expr like '%can_see_number%' and expr not like '%visible_number_ids%'), 'isolamento por Squad (leitura)'),
    (27, '027_squad_scope_write_policies', exists(select 1 from pol where policyname = 'numbers_update' and expr like '%can_see_number%'), false, 'isolamento por Squad (escrita)'),
    (28, '028_client_access_level', exists(select 1 from enum_label where typname = 'access_level' and enumlabel = 'CLIENT'), false, 'rodar SOZINHA'),
    (29, '029_client_portal', exists(select 1 from fn where proname = 'client_portal'), false, 'portal do cliente'),
    (30, '030_client_push_notifications', exists(select 1 from fn where proname = 'notify_external_number_alert'), false, 'ANTES: publicar a Edge Function send-push-notifications nova')
  )
select ordem, migration,
       case when versao_antiga then 'VERSÃO ANTIGA — rode de novo'
            when aplicada then 'aplicada'
            else 'NÃO aplicada' end as situacao,
       observacao
from checks
order by ordem;
