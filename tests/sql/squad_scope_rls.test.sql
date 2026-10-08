-- Prova de RLS do isolamento por Squad (migrations 025/026/027).
--
-- ⚠️ NUNCA rode em PRODUÇÃO. Rode só em banco LOCAL (supabase start) ou em um
-- projeto/branch de STAGING com as migrations 001-027 aplicadas.
-- Tudo roda dentro de UMA transação que termina em ROLLBACK: nenhum dado fica gravado.
-- Qualquer falha levanta exceção com a descrição do cenário e aborta a transação.
--
-- Como rodar (local):  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/squad_scope_rls.test.sql
-- Saída esperada no final: NOTICE  squad_scope_rls: todos os cenários passaram.
begin;

-- Schema só desta transação (some no ROLLBACK) para os helpers do teste.
create schema sqtest_rls;
grant usage on schema sqtest_rls to authenticated;

create function sqtest_rls.expect(label text, actual bigint, expected bigint) returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FALHOU: % (esperado %, obtido %)', label, expected, actual;
  end if;
end $$;

create function sqtest_rls.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------------------
-- Massa de teste (como postgres, sem RLS). Prefixo sqtest_ em tudo.
-- ---------------------------------------------------------------------------
insert into public.squads (id, name) values ('sqtest_sA', 'SQTEST Squad A'), ('sqtest_sB', 'SQTEST Squad B');

insert into public.signup_authorizations (id, email, access_level, squad_id) values
  ('sqtest_auth_master', 'sqtest+master@example.invalid', 'MASTER', null),
  ('sqtest_auth_admin',  'sqtest+admin@example.invalid',  'ADMIN',  'sqtest_sB'),
  ('sqtest_auth_userA',  'sqtest+usera@example.invalid',  'USER',   'sqtest_sA'),
  ('sqtest_auth_viewA',  'sqtest+viewa@example.invalid',  'VIEWER', 'sqtest_sA'),
  ('sqtest_auth_noSq',   'sqtest+nosq@example.invalid',   'USER',   null);

-- handle_new_user() cria os profiles a partir das autorizações acima.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000001', 'sqtest+master@example.invalid', '{"name":"SQTEST Master"}'),
  ('00000000-0000-4000-8000-000000000002', 'sqtest+admin@example.invalid',  '{"name":"SQTEST Admin"}'),
  ('00000000-0000-4000-8000-000000000003', 'sqtest+usera@example.invalid',  '{"name":"SQTEST User A"}'),
  ('00000000-0000-4000-8000-000000000004', 'sqtest+viewa@example.invalid',  '{"name":"SQTEST Viewer A"}'),
  ('00000000-0000-4000-8000-000000000005', 'sqtest+nosq@example.invalid',   '{"name":"SQTEST Sem Squad"}');

insert into public.clients (id, name, squad_id) values
  ('sqtest_cA', 'SQTEST Cliente A', 'sqtest_sA'), ('sqtest_cB', 'SQTEST Cliente B', 'sqtest_sB'), ('sqtest_cN', 'SQTEST Cliente sem Squad', null);
insert into public.responsibles (id, name, squad_id) values
  ('sqtest_rA', 'SQTEST Colab A', 'sqtest_sA'), ('sqtest_rB', 'SQTEST Colab B', 'sqtest_sB'), ('sqtest_rN', 'SQTEST Colab sem Squad', null);
insert into public.numbers (id, phone, status) values
  ('sqtest_nA', '5599000000001', 'ACTIVE'), ('sqtest_nB', '5599000000002', 'ACTIVE'),
  ('sqtest_nAB', '5599000000003', 'ACTIVE'), ('sqtest_nStock', '5599000000004', 'ACTIVE');
insert into public.number_squads (number_id, squad_id) values
  ('sqtest_nA', 'sqtest_sA'), ('sqtest_nB', 'sqtest_sB'), ('sqtest_nAB', 'sqtest_sA'), ('sqtest_nAB', 'sqtest_sB');
insert into public.number_clients (number_id, client_id) values ('sqtest_nA', 'sqtest_cA'), ('sqtest_nB', 'sqtest_cB');
insert into public.campaigns (id, name, client_id, squad_id) values
  ('sqtest_kA', 'SQTEST Campanha A', 'sqtest_cA', 'sqtest_sA'), ('sqtest_kB', 'SQTEST Campanha B', 'sqtest_cB', 'sqtest_sB');
insert into public.number_campaign_links (id, number_id, campaign_id, role) values
  ('sqtest_lA', 'sqtest_nA', 'sqtest_kA', 'PRIMARY'), ('sqtest_lB', 'sqtest_nB', 'sqtest_kB', 'PRIMARY');
insert into public.incidents (id, number_id, type, title, status) values
  ('sqtest_iA', 'sqtest_nA', 'OTHER', 'SQTEST Ocorrência A', 'OPEN'), ('sqtest_iB', 'sqtest_nB', 'OTHER', 'SQTEST Ocorrência B', 'OPEN');
insert into public.history_events (id, number_id, type, description) values
  ('sqtest_hA', 'sqtest_nA', 'SQTEST', 'A'), ('sqtest_hB', 'sqtest_nB', 'SQTEST', 'B');
insert into public.integration_events (id, source, source_event_id, event_type, raw_payload, number_id, campaign_id, processing_status) values
  ('sqtest_eA', 'SQTEST', 'sqtest-1', 'CONNECTIVITY_ALERT', '{}', 'sqtest_nA', 'sqtest_kA', 'MATCHED'),
  ('sqtest_eB', 'SQTEST', 'sqtest-2', 'CONNECTIVITY_ALERT', '{}', 'sqtest_nB', 'sqtest_kB', 'MATCHED'),
  ('sqtest_eP', 'SQTEST', 'sqtest-3', 'CONNECTIVITY_ALERT', '{}', null, null, 'PENDING_ASSOCIATION');

-- Contagem por tabela, só das linhas de teste, com o RLS de quem estiver "logado".
create function sqtest_rls.visible(p_table text) returns bigint language plpgsql as $$
declare v bigint;
begin
  if p_table in ('number_squads','number_clients') then
    execute format('select count(*) from public.%I where number_id like ''sqtest\_%%''', p_table) into v;
  else
    execute format('select count(*) from public.%I where id like ''sqtest\_%%''', p_table) into v;
  end if;
  return v;
end $$;

create function sqtest_rls.expect_all(who text, e_squads int, e_clients int, e_resp int, e_numbers int, e_nsq int, e_ncl int, e_camp int, e_links int, e_inc int, e_hist int, e_events int) returns void language plpgsql as $$
begin
  perform sqtest_rls.expect(who || ': squads', sqtest_rls.visible('squads'), e_squads);
  perform sqtest_rls.expect(who || ': clients', sqtest_rls.visible('clients'), e_clients);
  perform sqtest_rls.expect(who || ': responsibles', sqtest_rls.visible('responsibles'), e_resp);
  perform sqtest_rls.expect(who || ': numbers', sqtest_rls.visible('numbers'), e_numbers);
  perform sqtest_rls.expect(who || ': number_squads', sqtest_rls.visible('number_squads'), e_nsq);
  perform sqtest_rls.expect(who || ': number_clients', sqtest_rls.visible('number_clients'), e_ncl);
  perform sqtest_rls.expect(who || ': campaigns', sqtest_rls.visible('campaigns'), e_camp);
  perform sqtest_rls.expect(who || ': number_campaign_links', sqtest_rls.visible('number_campaign_links'), e_links);
  perform sqtest_rls.expect(who || ': incidents', sqtest_rls.visible('incidents'), e_inc);
  perform sqtest_rls.expect(who || ': history_events', sqtest_rls.visible('history_events'), e_hist);
  perform sqtest_rls.expect(who || ': integration_events', sqtest_rls.visible('integration_events'), e_events);
end $$;

grant execute on all functions in schema sqtest_rls to authenticated;
set local role authenticated;
-- A partir daqui, cada bloco troca o usuário "logado" via request.jwt.claims (o mesmo
-- mecanismo que o PostgREST usa com o token do navegador).

-- ---------------------------------------------------------------------------
-- 1) MASTER vê tudo. 2) ADMIN mantém o acesso global (mesmo tendo Squad B no perfil).
-- ---------------------------------------------------------------------------
select sqtest_rls.as_user('00000000-0000-4000-8000-000000000001');
select sqtest_rls.expect_all('MASTER', 2, 3, 3, 4, 4, 2, 2, 2, 2, 2, 3);
select sqtest_rls.as_user('00000000-0000-4000-8000-000000000002');
select sqtest_rls.expect_all('ADMIN', 2, 3, 3, 4, 4, 2, 2, 2, 2, 2, 3);

-- ---------------------------------------------------------------------------
-- 3) USER A só vê o Squad A (+ número compartilhado A/B, número de estoque e colaborador
--    sem Squad). 4) VIEWER A vê exatamente o mesmo.
--    squads: sA | clients: cA | resp: rA,rN | numbers: nA,nAB,nStock | number_squads: (nA,sA),(nAB,sA)
--    number_clients: (nA,cA) | campaigns: kA | links: lA | incidents: iA | history: hA | events: eA
-- ---------------------------------------------------------------------------
select sqtest_rls.as_user('00000000-0000-4000-8000-000000000003');
select sqtest_rls.expect_all('USER A', 1, 1, 2, 3, 2, 1, 1, 1, 1, 1, 1);
select sqtest_rls.as_user('00000000-0000-4000-8000-000000000004');
select sqtest_rls.expect_all('VIEWER A', 1, 1, 2, 3, 2, 1, 1, 1, 1, 1, 1);

-- USER/VIEWER sem Squad no perfil: nada operacional.
select sqtest_rls.as_user('00000000-0000-4000-8000-000000000005');
select sqtest_rls.expect_all('USER sem Squad', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

-- ---------------------------------------------------------------------------
-- 5) USER A consultando registro de outro Squad diretamente pela API (equivale a
--    GET /rest/v1/<tabela>?id=eq.<id>, e ao acesso por URL/hash, que só lê o que a API devolve).
-- ---------------------------------------------------------------------------
select sqtest_rls.as_user('00000000-0000-4000-8000-000000000003');
select sqtest_rls.expect('USER A: número B por id', (select count(*) from public.numbers where id = 'sqtest_nB'), 0);
select sqtest_rls.expect('USER A: ocorrência B por id (#incidents/sqtest_iB)', (select count(*) from public.incidents where id = 'sqtest_iB'), 0);
select sqtest_rls.expect('USER A: campanha B por id', (select count(*) from public.campaigns where id = 'sqtest_kB'), 0);
select sqtest_rls.expect('USER A: cliente B por id', (select count(*) from public.clients where id = 'sqtest_cB'), 0);
select sqtest_rls.expect('USER A: histórico de B via número (relação indireta)', (select count(*) from public.history_events where number_id = 'sqtest_nB'), 0);
select sqtest_rls.expect('USER A: vínculos de B via campanha (relação indireta)', (select count(*) from public.number_campaign_links where campaign_id = 'sqtest_kB'), 0);
select sqtest_rls.expect('USER A: evento pendente sem Squad', (select count(*) from public.integration_events where id = 'sqtest_eP'), 0);
select sqtest_rls.expect('USER A: Squad B do número compartilhado não vaza', (select count(*) from public.number_squads where number_id = 'sqtest_nAB' and squad_id = 'sqtest_sB'), 0);

-- ---------------------------------------------------------------------------
-- 6) USER A não escreve fora do próprio Squad.
-- ---------------------------------------------------------------------------
do $$ begin
  begin
    insert into public.campaigns (id, name, client_id, squad_id) values ('sqtest_kX', 'X', 'sqtest_cB', 'sqtest_sB');
    raise exception 'FALHOU: USER A criou campanha no Squad B';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.campaigns (id, name, client_id, squad_id) values ('sqtest_kY', 'Y', 'sqtest_cB', 'sqtest_sA');
    raise exception 'FALHOU: USER A criou campanha do Squad A com cliente do Squad B';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.number_squads (number_id, squad_id) values ('sqtest_nStock', 'sqtest_sB');
    raise exception 'FALHOU: USER A associou número ao Squad B';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.history_events (id, number_id, type, description) values ('sqtest_hX', 'sqtest_nB', 'SQTEST', 'X');
    raise exception 'FALHOU: USER A gravou histórico em número do Squad B';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.external_numbers (phone_normalized) values ('5599000000099');
    raise exception 'FALHOU: USER A gravou na memória global de externos';
  exception when insufficient_privilege then null; end;
end $$;

-- UPDATE em linha invisível não afeta nada (USING filtra) — nunca altera dado de B.
do $$ declare n int; begin
  update public.incidents set title = 'hack' where id = 'sqtest_iB';
  get diagnostics n = row_count;
  perform sqtest_rls.expect('USER A: update em ocorrência B', n, 0);
end $$;

-- Operação legítima continua funcionando: puxar número de estoque para o próprio Squad,
-- criar número novo (ainda sem Squad no instante do upsert) e campanha no Squad A.
insert into public.number_squads (number_id, squad_id) values ('sqtest_nStock', 'sqtest_sA');
insert into public.numbers (id, phone, status) values ('sqtest_nNew', '5599000000005', 'ACTIVE')
  on conflict (id) do update set status = excluded.status; -- mesmo formato do upsert do frontend
insert into public.number_squads (number_id, squad_id) values ('sqtest_nNew', 'sqtest_sA');
insert into public.campaigns (id, name, client_id, squad_id) values ('sqtest_kA2', 'SQTEST Campanha A2', 'sqtest_cA', 'sqtest_sA');
select sqtest_rls.expect('USER A: vê o número novo no próprio Squad', (select count(*) from public.numbers where id = 'sqtest_nNew'), 1);

-- 7) VIEWER A continua somente leitura.
select sqtest_rls.as_user('00000000-0000-4000-8000-000000000004');
do $$ begin
  begin
    insert into public.history_events (id, number_id, type, description) values ('sqtest_hV', 'sqtest_nA', 'SQTEST', 'V');
    raise exception 'FALHOU: VIEWER escreveu';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$ begin raise notice 'squad_scope_rls: todos os cenários passaram.'; end $$;
rollback;
