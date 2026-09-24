-- Incremental, não destrutiva. Permite que cada inscrição de push ("número caiu") escolha
-- notificar só de determinados Squads, em vez de sempre todos. Sem preferência salva (nenhuma
-- linha nesta tabela pra aquela inscrição) continua notificando de TUDO — mesmo comportamento de
-- hoje, preservado como padrão (nunca some notificação de quem não configurou nada).
--
-- Filtragem de verdade acontece na Edge Function send-push-notifications (deps.listSubscriptions
-- retorna squadIds por inscrição, deps.getIncidentContext retorna numberSquadIds do Número que
-- caiu) — esta migration só guarda a preferência.
begin;

-- id sintético (não a chave composta subscription_id+squad_id) pra poder usar o mesmo
-- SupabaseRepository genérico (get/update/remove por id) já usado em todo o resto do app.
create table public.push_subscription_squads (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  squad_id text not null references public.squads(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (subscription_id, squad_id)
);
create index push_subscription_squads_subscription_idx on public.push_subscription_squads (subscription_id);

alter table public.push_subscription_squads enable row level security;
-- Mesmo modelo de dono de push_subscriptions (dado pessoal por dispositivo, não operacional) —
-- só quem é dono da inscrição (via subscription_id) enxerga/mexe na própria preferência.
create policy push_subscription_squads_own_select on public.push_subscription_squads
  for select to authenticated using (
    exists (select 1 from public.push_subscriptions ps where ps.id = subscription_id and ps.profile_id = auth.uid())
  );
create policy push_subscription_squads_own_insert on public.push_subscription_squads
  for insert to authenticated with check (
    exists (select 1 from public.push_subscriptions ps where ps.id = subscription_id and ps.profile_id = auth.uid())
  );
create policy push_subscription_squads_own_delete on public.push_subscription_squads
  for delete to authenticated using (
    exists (select 1 from public.push_subscriptions ps where ps.id = subscription_id and ps.profile_id = auth.uid())
  );
grant select, insert, delete on public.push_subscription_squads to authenticated;

commit;
