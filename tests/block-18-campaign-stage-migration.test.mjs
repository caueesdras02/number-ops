import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// BLOCO 18 — migration 018 (etapa operacional da campanha), modelo final: só
// 2 valores de stage (CAPTACAO/TA_ROLANDO_POS_LIVE), sem EM_ANDAMENTO/POS_LIVE
// isolada, sem backfill de inferência histórica. Só valida o texto do .sql
// (mesmo estilo dos blocos 6/15/16) — não aplica nada em banco real.
// ---------------------------------------------------------------------------

const m018 = await readFile(new URL("../supabase/018_campaign_stage.sql", import.meta.url), "utf8");

assert.match(m018, /alter table public\.campaigns\s+add column if not exists stage text not null default 'CAPTACAO'/i);

// Documentação precisa refletir corretamente que ADD COLUMN ... NOT NULL DEFAULT preenche a
// coluna nova em toda campanha já existente (não é "nada é alterado") — só não infere nada a
// partir de outro dado da campanha.
assert.doesNotMatch(m018, /Nenhuma campanha,? .*(é alterad|são alterad)/i, "comentário não pode afirmar que nenhuma campanha é tocada — a coluna stage é preenchida em todas");
assert.match(m018, /toda campanha já existente passa a[\s\S]{0,20}ter essa coluna preenchida/, "comentário precisa explicar que o default técnico preenche a coluna em toda linha existente");
assert.match(m018, /check \(stage in \('CAPTACAO','TA_ROLANDO_POS_LIVE'\)\)/, "só as 2 etapas ACTIVE — 'Tá rolando / Pós live' é UMA etapa, não duas");
assert.match(m018, /create index if not exists campaigns_stage_idx on public\.campaigns \(stage\)/i);

// Modelo final removido: nenhum vestígio de EM_ANDAMENTO/POS_LIVE isolada/TA_ROLANDO isolada.
assert.doesNotMatch(m018, /EM_ANDAMENTO/, "EM_ANDAMENTO foi removido do modelo final");
assert.doesNotMatch(m018, /'POS_LIVE'/, "POS_LIVE como etapa isolada foi removido");

// Nenhum backfill/inferência histórica — 'Encerrada' nunca é gravada em stage, é só leitura de status.
assert.doesNotMatch(m018, /update public\.campaigns set stage/i, "não deve inferir nenhuma etapa histórica a partir de status/dado existente");
assert.doesNotMatch(m018, /'ENCERRADA'/, "ENCERRADA nunca é um valor gravável em stage — é derivado de status='CLOSED' no frontend");

// Auditoria: ramo novo preservado, sem prejudicar os existentes.
assert.match(m018, /old\.stage is distinct from new\.stage/);
assert.match(m018, /'CAMPAIGN_STAGE_CHANGED'/);
assert.match(m018, /'CAMPAIGN_CREATED'/);
assert.match(m018, /'CAMPAIGN_DELETED'/);
assert.match(m018, /'CAMPAIGN_CLOSED'/);
assert.match(m018, /'CAMPAIGN_REACTIVATED'/);
assert.match(m018, /'CAMPAIGN_RESPONSIBLE_CHANGED'/);
assert.match(m018, /'CAMPAIGN_UPDATED'/);

// Auditoria: RESPONSIBLE_CHANGED/STAGE_CHANGED/UPDATED precisam ser `if` INDEPENDENTES entre si
// (não um único elsif encadeado) — senão, mudar responsible_id e stage na MESMA operação só
// audita um dos dois. Extrai o bloco `campaigns` inteiro e confere a estrutura real.
{
  const campaignsBlockMatch = m018.match(/elsif tg_table_name='campaigns' then([\s\S]*?)\n  elsif tg_table_name=/);
  assert.ok(campaignsBlockMatch, "bloco campaigns não encontrado na função de auditoria");
  const campaignsBlock = campaignsBlockMatch[1];
  assert.doesNotMatch(campaignsBlock, /elsif tg_op='UPDATE' and old\.responsible_id/, "responsible_id não pode estar encadeado num elsif — precisa ser um if independente");
  assert.doesNotMatch(campaignsBlock, /elsif tg_op='UPDATE' and old\.stage/, "stage não pode estar encadeado num elsif — precisa ser um if independente");
  assert.match(campaignsBlock, /end if;\s*if old\.responsible_id is distinct from new\.responsible_id then/, "responsible_id precisa ser um `if` novo, não elsif do bloco anterior (CLOSED/REACTIVATED)");
  assert.match(campaignsBlock, /end if;\s*if old\.stage is distinct from new\.stage then/, "stage precisa ser um `if` novo, independente de responsible_id");
  assert.match(campaignsBlock, /end if;\s*if row\(old\.name,old\.client_id,old\.squad_id,old\.notes,old\.started_at\)/, "CAMPAIGN_UPDATED precisa ser um `if` novo, independente de stage");
  // CLOSED/REACTIVATED continuam mutuamente exclusivos entre si (elsif só entre os dois).
  assert.match(campaignsBlock, /if old\.status is distinct from new\.status and new\.status='CLOSED' then[\s\S]*?elsif old\.status is distinct from new\.status and new\.status='ACTIVE' then/);
}

// Não é uma policy nova: RLS de UPDATE em campaigns já cobre a linha inteira (MASTER/ADMIN/USER).
assert.doesNotMatch(m018, /create policy/i, "não deveria precisar de policy nova — UPDATE de campaigns já é liberado por linha inteira");

assert.doesNotMatch(m018, /truncate|drop table|delete from public\.(numbers|clients|campaigns|number_campaign_links|incidents)/i, "018 é aditiva — nunca apaga dado operacional existente");

console.log("Bloco 18 (migration 018 — etapa operacional da campanha): todos os cenários passaram.");
