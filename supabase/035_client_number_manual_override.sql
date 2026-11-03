-- Classificação de "Número de Cliente" (aba que separa números cuja identificação já indica
-- o cliente) é automática por padrão (texto da identificação bate com o nome de um Cliente
-- cadastrado). Esta coluna permite forçar manualmente a classificação pra dentro (true) ou
-- pra fora (false) dessa aba, independente do texto — null (padrão) mantém a detecção
-- automática. Ver NumbersService.isClientNamed()/setClientNumberOverride().
begin;

alter table public.numbers
  add column if not exists client_number_override boolean;

commit;
