-- Prova do acesso de cliente (migrations 028/029, sobre 025-027).
--
-- ⚠️ NUNCA rode em PRODUÇÃO. Só em banco LOCAL ou STAGING com as migrations até 029.
-- Tudo dentro de UMA transação que termina em ROLLBACK: nenhum dado fica gravado.
--
-- Como rodar:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/client_portal_rls.test.sql
-- Saída esperada no final: NOTICE  client_portal: todos os cenários passaram.
begin;

create schema cptest;
grant usage on schema cptest to authenticated;

create function cptest.expect(label text, actual bigint, expected bigint) returns void language plpgsql as $$
begin
  if actual is distinct from expected then raise exception 'FALHOU: % (esperado %, obtido %)', label, expected, actual; end if;
end $$;
create function cptest.expect_true(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FALHOU: %', label; end if;
end $$;
create function cptest.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------------------
-- Massa de teste (como postgres). Cliente acompanhado: "CPTEST Zig".
-- ---------------------------------------------------------------------------
insert into public.squads (id, name) values ('cpt_sA', 'CPTEST Squad A');
insert into public.clients (id, name, squad_id) values ('cpt_zig', 'CPTEST Zig', 'cpt_sA'), ('cpt_other', 'CPTEST Outro Cliente', 'cpt_sA');
insert into public.responsibles (id, name, squad_id) values ('cpt_r1', 'CPTEST Colaborador Secreto', 'cpt_sA');
insert into public.locations (id, name, responsible_id) values ('cpt_loc', 'CPTEST Celular 01', 'cpt_r1');
insert into public.campaigns (id, name, client_id, squad_id, status, started_at, ended_at) values
  ('cpt_kZig', 'CPTEST Live Zig', 'cpt_zig', 'cpt_sA', 'ACTIVE', now() - interval '15 days', null),
  ('cpt_kZigOld', 'CPTEST Live Zig antiga', 'cpt_zig', 'cpt_sA', 'CLOSED', now() - interval '60 days', now() - interval '40 days'),
  ('cpt_kOther', 'CPTEST Live Outro', 'cpt_other', 'cpt_sA', 'ACTIVE', now() - interval '40 days', null);
insert into public.numbers (id, phone, identification, status, location_id, responsible_id, group_count, notes) values
  ('cpt_n1', '5598000000001', 'CHIP 1', 'ACTIVE', 'cpt_loc', 'cpt_r1', 40, 'NOTA SECRETA INTERNA'),
  ('cpt_n2', '5598000000002', 'CHIP 2', 'WARMING', null, null, 12, ''),
  ('cpt_n3', '5598000000003', 'CHIP 3', 'ACTIVE', null, null, 5, '');
insert into public.number_squads (number_id, squad_id) values ('cpt_n1', 'cpt_sA'), ('cpt_n2', 'cpt_sA'), ('cpt_n3', 'cpt_sA');
insert into public.number_campaign_links (id, number_id, campaign_id, role, started_at, ended_at) values
  ('cpt_l1', 'cpt_n1', 'cpt_kZig', 'PRIMARY', now() - interval '10 days', null),
  ('cpt_l2', 'cpt_n2', 'cpt_kOther', 'PRIMARY', now() - interval '30 days', now() - interval '20 days'),
  ('cpt_l3', 'cpt_n2', 'cpt_kZig', 'BACKUP', now() - interval '10 days', null),
  ('cpt_l4', 'cpt_n3', 'cpt_kOther', 'PRIMARY', now() - interval '30 days', null);
insert into public.incidents (id, number_id, type, title, description, status, origin, classification, created_at) values
  ('cpt_i1', 'cpt_n1', 'CONNECTIVITY', 'Queda', 'x', 'OPEN', 'TELEGRAM_BOT', 'CONNECTIVITY', now() - interval '2 days'),
  ('cpt_i2', 'cpt_n2', 'CONNECTIVITY', 'Queda', 'x', 'RESOLVED', 'TELEGRAM_BOT', 'CONNECTIVITY', now() - interval '25 days'),
  ('cpt_i3', 'cpt_n2', 'CONNECTIVITY', 'Queda', 'x', 'RESOLVED', 'TELEGRAM_BOT', 'CONNECTIVITY', now() - interval '5 days'),
  ('cpt_i4', 'cpt_n3', 'CONNECTIVITY', 'Queda', 'x', 'OPEN', 'TELEGRAM_BOT', 'CONNECTIVITY', now() - interval '1 day'),
  ('cpt_i5', 'cpt_n1', 'OTHER', 'Manual', 'DESCRICAO INTERNA DA OCORRENCIA', 'OPEN', 'MANUAL', null, now() - interval '1 day');
insert into public.restrictions (id, number_id, kind, description) values ('cpt_res1', 'cpt_n1', 'SEND_LIMIT', 'DETALHE INTERNO DA RESTRICAO');
insert into public.external_numbers (id, phone_normalized) values ('cpt_ext1', '5598000000099');
insert into public.external_number_campaign_links (id, external_number_id, campaign_id, phone_normalized, linked_at) values
  ('cpt_el1', 'cpt_ext1', 'cpt_kZig', '5598000000099', now() - interval '3 days');
insert into public.integration_events (id, source, source_event_id, event_type, raw_payload, phone_normalized, processing_status, received_at) values
  ('cpt_ev1', 'CPTEST', 'cpt-1', 'CONNECTIVITY_ALERT', '{"segredo":"PAYLOAD BRUTO"}', '5598000000099', 'IGNORED_NOT_OWNED', now() - interval '1 day');

-- Convites: CLIENT sem cliente é recusado pelo banco.
do $$ begin
  begin
    insert into public.signup_authorizations (id, email, access_level) values ('cpt_bad', 'cpt+bad@example.invalid', 'CLIENT');
    raise exception 'FALHOU: autorização CLIENT sem cliente foi aceita';
  exception when check_violation then null; end;
end $$;

insert into public.signup_authorizations (id, email, access_level, squad_id, client_id) values
  ('cpt_auth_client', 'cpt+client@example.invalid', 'CLIENT', 'cpt_sA', 'cpt_zig'), -- squad informado de propósito: tem que ser ignorado
  ('cpt_auth_admin', 'cpt+admin@example.invalid', 'ADMIN', null, null),
  ('cpt_auth_user', 'cpt+user@example.invalid', 'USER', 'cpt_sA', null);
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', 'cpt+client@example.invalid', '{"name":"CPTEST Cliente Zig"}'),
  ('00000000-0000-4000-8000-0000000000c2', 'cpt+admin@example.invalid', '{"name":"CPTEST Admin"}'),
  ('00000000-0000-4000-8000-0000000000c3', 'cpt+user@example.invalid', '{"name":"CPTEST User"}');

select cptest.expect_true('cadastro CLIENT grava o cliente e nunca o Squad',
  (select client_id = 'cpt_zig' and squad_id is null from public.profiles where id = '00000000-0000-4000-8000-0000000000c1'));
select cptest.expect_true('cadastro interno nunca grava cliente',
  (select client_id is null from public.profiles where id = '00000000-0000-4000-8000-0000000000c3'));

create function cptest.portal(p_client text default null) returns jsonb language sql as $$ select public.client_portal(p_client) $$;

create table cptest.portal_client (data jsonb);
grant select, insert on cptest.portal_client to authenticated;
grant execute on all functions in schema cptest to authenticated;
set local role authenticated;

-- ---------------------------------------------------------------------------
-- 1) CLIENT não lê NENHUMA tabela operacional diretamente (nem pela API).
-- ---------------------------------------------------------------------------
select cptest.as_user('00000000-0000-4000-8000-0000000000c1');
select cptest.expect('CLIENT: numbers', (select count(*) from public.numbers), 0);
select cptest.expect('CLIENT: campaigns', (select count(*) from public.campaigns), 0);
select cptest.expect('CLIENT: clients', (select count(*) from public.clients), 0);
select cptest.expect('CLIENT: squads', (select count(*) from public.squads), 0);
select cptest.expect('CLIENT: responsibles', (select count(*) from public.responsibles), 0);
select cptest.expect('CLIENT: locations', (select count(*) from public.locations), 0);
select cptest.expect('CLIENT: incidents', (select count(*) from public.incidents), 0);
select cptest.expect('CLIENT: restrictions', (select count(*) from public.restrictions), 0);
select cptest.expect('CLIENT: history_events', (select count(*) from public.history_events), 0);
select cptest.expect('CLIENT: number_campaign_links', (select count(*) from public.number_campaign_links), 0);
select cptest.expect('CLIENT: number_squads', (select count(*) from public.number_squads), 0);
select cptest.expect('CLIENT: number_clients', (select count(*) from public.number_clients), 0);
select cptest.expect('CLIENT: integration_events', (select count(*) from public.integration_events), 0);
select cptest.expect('CLIENT: external_numbers', (select count(*) from public.external_numbers), 0);
select cptest.expect('CLIENT: external_number_campaign_links', (select count(*) from public.external_number_campaign_links), 0);
select cptest.expect('CLIENT: profiles (só o próprio)', (select count(*) from public.profiles), 1);

-- ---------------------------------------------------------------------------
-- 2) Portal: só os dados dele, só os campos combinados.
-- ---------------------------------------------------------------------------
insert into cptest.portal_client select cptest.portal();
select cptest.expect_true('portal: cliente correto', (select data #>> '{client,name}' = 'CPTEST Zig' from cptest.portal_client));
select cptest.expect('portal: campanhas só do cliente', (select jsonb_array_length(data -> 'campaigns') from cptest.portal_client), 2);
select cptest.expect('portal: chips que estão/estiveram em campanha dele (não o CHIP 3)', (select jsonb_array_length(data -> 'chips') from cptest.portal_client), 2);
select cptest.expect_true('portal: localização, grupos e tipo de restrição do CHIP 1',
  (select c ->> 'location' = 'CPTEST Celular 01' and (c ->> 'groupCount')::int = 40 and c ->> 'restriction' = 'SEND_LIMIT'
   from cptest.portal_client, jsonb_array_elements(data -> 'chips') c where c ->> 'id' = 'cpt_n1'));
select cptest.expect('portal: CHIP 2 só mostra o vínculo com a campanha dele',
  (select jsonb_array_length(c -> 'links') from cptest.portal_client, jsonb_array_elements(data -> 'chips') c where c ->> 'id' = 'cpt_n2'), 1);
-- Quedas: i1 (CHIP 1) e i3 (CHIP 2, já na campanha dele). Nunca i2 (CHIP 2 quando era de outro
-- cliente), i4 (CHIP 3, de outro cliente) nem i5 (ocorrência manual, não é queda).
select cptest.expect('portal: quedas só no período das campanhas dele', (select jsonb_array_length(data -> 'outages') from cptest.portal_client), 2);
select cptest.expect_true('portal: quedas certas',
  (select array_agg(o ->> 'id' order by o ->> 'id') = array['cpt_i1','cpt_i3'] from cptest.portal_client, jsonb_array_elements(data -> 'outages') o));
select cptest.expect('portal: chip externo vinculado', (select jsonb_array_length(data -> 'externalChips') from cptest.portal_client), 1);
select cptest.expect('portal: alertas do chip externo', (select jsonb_array_length(data #> '{externalChips,0,alerts}') from cptest.portal_client), 1);
-- Nada interno ou de outro cliente vaza no conteúdo.
select cptest.expect_true('portal: sem dado interno ou de outro cliente',
  (select data::text !~* 'NOTA SECRETA|DESCRICAO INTERNA|DETALHE INTERNO|Colaborador Secreto|Outro Cliente|Live Outro|PAYLOAD BRUTO|cpt_n3' from cptest.portal_client));

-- 3) CLIENT não consegue pedir o portal de OUTRO cliente: o parâmetro é ignorado.
select cptest.expect_true('CLIENT: parâmetro de outro cliente é ignorado',
  (select cptest.portal('cpt_other') #>> '{client,name}' = 'CPTEST Zig'));

-- 4) CLIENT nunca escreve dado operacional. Push: só com 030 aplicada (a Edge Function nova
--    escopa o envio); só com 029, a inscrição é bloqueada.
do $$ begin
  begin
    insert into public.numbers (id, phone, status) values ('cpt_hack', '5598000000077', 'ACTIVE');
    raise exception 'FALHOU: CLIENT criou número';
  exception when insufficient_privilege then null; end;
end $$;
do $$
declare v_has_030 boolean := to_regprocedure('public.notify_external_number_alert()') is not null;
begin
  begin
    insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth_key) values ('00000000-0000-4000-8000-0000000000c1', 'https://push.invalid/x', 'k', 'a');
    if not v_has_030 then raise exception 'FALHOU: CLIENT se inscreveu no push sem a 030'; end if;
  exception when insufficient_privilege then
    if v_has_030 then raise exception 'FALHOU: com a 030 o CLIENT deveria poder se inscrever no push'; end if;
  end;
  begin
    insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth_key) values ('00000000-0000-4000-8000-0000000000c2', 'https://push.invalid/y', 'k', 'a');
    raise exception 'FALHOU: CLIENT inscreveu o push de outra pessoa';
  exception when insufficient_privilege then null; end;
end $$;
do $$ declare n int; begin
  update public.profiles set client_id = 'cpt_other' where id = '00000000-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  perform cptest.expect('CLIENT: não troca o próprio cliente', n, 0);
end $$;

-- ---------------------------------------------------------------------------
-- 5) ADMIN pré-visualiza qualquer cliente; USER (interno) não tem portal.
-- ---------------------------------------------------------------------------
select cptest.as_user('00000000-0000-4000-8000-0000000000c2');
select cptest.expect_true('ADMIN: pré-visualiza outro cliente', (select cptest.portal('cpt_other') #>> '{client,name}' = 'CPTEST Outro Cliente'));
select cptest.expect('ADMIN: continua lendo tudo de teste', (select count(*) from public.numbers where id like 'cpt\_%'), 3);
select cptest.expect('ADMIN: localizações continuam visíveis', (select count(*) from public.locations where id = 'cpt_loc'), 1);

select cptest.as_user('00000000-0000-4000-8000-0000000000c3');
do $$ begin
  begin
    perform cptest.portal('cpt_zig');
    raise exception 'FALHOU: USER abriu o portal de um cliente';
  exception when insufficient_privilege then null; end;
end $$;
select cptest.expect('USER: localizações continuam visíveis', (select count(*) from public.locations where id = 'cpt_loc'), 1);

reset role;
do $$ begin raise notice 'client_portal: todos os cenários passaram.'; end $$;
rollback;
