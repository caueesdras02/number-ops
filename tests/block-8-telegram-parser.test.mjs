import assert from "node:assert/strict";
import { parseAlertText, normalizePhone } from "../supabase/functions/telegram-webhook/parse-alert.js";

// ---------------------------------------------------------------------------
// BLOCO 1 — parser do alerta de infraestrutura do Telegram (puro, sem rede/DB)
// ---------------------------------------------------------------------------

// 1) alerta DESCONECTADO válido, formato "de livro"
{
  const text = [
    "🚨 ALERTA DE INFRAESTRUTURA",
    "",
    "Status: 🔴 DESCONECTADO",
    "Empresa: Aura Radiante",
    "Liveshop: Pré Black Aura Radiante",
    "Conta do Cliente: Conta 42",
    "Número: 5511999999999",
  ].join("\n");
  const parsed = parseAlertText(text);
  assert.equal(parsed.matchesAlertShape, true);
  assert.equal(parsed.status, "DESCONECTADO");
  assert.equal(parsed.empresa, "Aura Radiante");
  assert.equal(parsed.liveshop, "Pré Black Aura Radiante");
  assert.equal(parsed.contaCliente, "Conta 42");
  assert.equal(parsed.phoneNormalized, "5511999999999");
}

// 2) emojis diferentes / ausentes na linha de status não impedem o parse
{
  const semEmoji = parseAlertText("Status: DESCONECTADO\nNúmero: 5511999999999");
  assert.equal(semEmoji.status, "DESCONECTADO");
  const outroEmoji = parseAlertText("⚠️ ALERTA\nStatus: ⚠️ DESCONECTADO\nNúmero: 5511999999999");
  assert.equal(outroEmoji.status, "DESCONECTADO");
}

// 3) espaços extras / múltiplas quebras de linha / CRLF
{
  const text = "🚨 ALERTA DE INFRAESTRUTURA\r\n\r\n\r\nStatus:    🔴   DESCONECTADO\r\n\r\nNúmero:      5511999999999   ";
  const parsed = parseAlertText(text);
  assert.equal(parsed.matchesAlertShape, true);
  assert.equal(parsed.status, "DESCONECTADO");
  assert.equal(parsed.phoneNormalized, "5511999999999");
}

// 4) telefone formatado (com +, espaços, parênteses e hífen)
{
  const parsed = parseAlertText("Status: DESCONECTADO\nNúmero: +55 (11) 99999-9999");
  assert.equal(parsed.phoneNormalized, "5511999999999");
}

// 5) telefone sem formatação nenhuma
{
  const parsed = parseAlertText("Status: DESCONECTADO\nNúmero: 5511999999999");
  assert.equal(parsed.phoneNormalized, "5511999999999");
}
assert.equal(normalizePhone(" +55 (11) 99999-9999 "), "5511999999999");

// 6) campo opcional ausente (Conta do Cliente) — continua reconhecendo o alerta normalmente
{
  const text = "🚨 ALERTA DE INFRAESTRUTURA\nStatus: 🔴 DESCONECTADO\nEmpresa: Aura Radiante\nLiveshop: Campanha X\nNúmero: 5511999999999";
  const parsed = parseAlertText(text);
  assert.equal(parsed.matchesAlertShape, true);
  assert.equal(parsed.contaCliente, null);
  assert.equal(parsed.phoneNormalized, "5511999999999");
}

// 7) campo obrigatório ausente (sem "Número:") — reconhece o formato de alerta, mas sem telefone extraível
{
  const text = "🚨 ALERTA DE INFRAESTRUTURA\nStatus: 🔴 DESCONECTADO\nEmpresa: Aura Radiante";
  const parsed = parseAlertText(text);
  assert.equal(parsed.matchesAlertShape, true);
  assert.equal(parsed.phoneRaw, null);
  assert.equal(parsed.phoneNormalized, null);
}

// 8) mensagem não relacionada ao alerta — não deve ser tratada como alerta
{
  const parsed = parseAlertText("Bom dia time, tudo certo por aqui hoje!");
  assert.equal(parsed.matchesAlertShape, false);
  assert.equal(parsed.phoneNormalized, null);
}

// 9) texto vazio/ausente não quebra o parser
{
  assert.equal(parseAlertText("").matchesAlertShape, false);
  assert.equal(parseAlertText(undefined).matchesAlertShape, false);
}

console.log("Bloco 1 (parser Telegram): todos os cenários passaram.");
