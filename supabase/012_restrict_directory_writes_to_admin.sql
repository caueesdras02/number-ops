-- Incremental, não destrutiva. Restringe criação/edição/arquivamento de
-- Clientes, Squads, Colaboradores e Localizações a ADMIN e MASTER (USER
-- deixa de poder escrever nessas tabelas — continua podendo ler/consultar
-- normalmente).
--
-- Números e Campanhas (e as tabelas de vínculo number_clients/number_squads/
-- number_campaign_links) NÃO são afetados: USER continua operando
-- normalmente (cadastrar/editar número, criar/editar campanha, vincular
-- número a campanha/cliente/squad).
begin;

do $$
declare t text;
begin
  foreach t in array array['clients', 'squads', 'responsibles', 'locations']
  loop
    execute format(
      'alter policy %I on public.%I with check (public.current_access_level() in (''MASTER'',''ADMIN''))',
      t || '_insert', t);
    execute format(
      'alter policy %I on public.%I using (public.current_access_level() in (''MASTER'',''ADMIN'')) with check (public.current_access_level() in (''MASTER'',''ADMIN''))',
      t || '_update', t);
  end loop;
end $$;

commit;
