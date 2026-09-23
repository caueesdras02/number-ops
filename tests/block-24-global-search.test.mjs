import assert from "node:assert/strict";
import { search } from "../src/js/ui/global-search.js";

// ---------------------------------------------------------------------------
// BLOCO 24 — busca global (Ctrl+K). Só a lógica pura de correspondência aqui
// (search(state, query)) — a UI (abrir/fechar, teclado, navegação) foi
// verificada manualmente em navegador real (headless Chrome), documentada na
// conversa que introduziu esta funcionalidade.
// ---------------------------------------------------------------------------

const state = {
  numbers: [
    { id: "n1", phone: "5511988887777", identification: "CHIP 1", archivedAt: null },
    { id: "n2", phone: "5511999998888", identification: "CHIP 2", archivedAt: "2026-01-01T00:00:00Z" }, // arquivado — não deve aparecer
  ],
  campaigns: [{ id: "c1", name: "Live do Líder", status: "ACTIVE" }],
  clients: [
    { id: "cl1", name: "São Paulo Comércio", isActive: true },
    { id: "cl2", name: "Cliente Inativo", isActive: false }, // inativo — não deve aparecer
  ],
  groups: [{ id: "g1", name: "Comercial Norte", isActive: true }],
  responsibles: [{ id: "r1", name: "José Oliveira", isActive: true }],
  locations: [{ id: "l1", name: "São Paulo · Estação 1", isActive: true }],
};

// 1) string vazia -> nenhum resultado (não lista tudo à toa)
assert.deepEqual(search(state, ""), []);
assert.deepEqual(search(state, "   "), []);

// 2) busca por telefone (número) — só o ativo aparece
{
  const results = search(state, "988887777");
  assert.equal(results.length, 1);
  assert.equal(results[0].item.id, "n1");
  assert.equal(results[0].config.type, "numbers");
}

// 3) número arquivado nunca aparece, mesmo buscando pelo telefone dele
assert.equal(search(state, "999998888").length, 0);

// 4) cliente inativo nunca aparece
assert.equal(search(state, "Cliente Inativo").length, 0);

// 5) acento/caixa não importa (mesma normalização usada em todo o app)
{
  const results = search(state, "sao paulo");
  const types = results.map((r) => r.config.type).sort();
  assert.deepEqual(types, ["clients", "locations"], "acha Cliente E Localização com 'São Paulo', mesmo sem acento/com minúsculo");
}

// 6) espaço duplicado/nas pontas não atrapalha
assert.equal(search(state, "  josé   oliveira  ").length, 1);

// 7) cada tipo devolve até MAX_PER_TYPE (5) — não deixa um tipo com muito match engolir os outros
{
  const bigState = { ...state, campaigns: Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, name: `Campanha Teste ${i}`, status: "ACTIVE" })) };
  const results = search(bigState, "campanha teste");
  assert.equal(results.length, 5);
}

// 8) sem nenhum match -> array vazio, nunca erro
assert.deepEqual(search(state, "zzznadaexistecomisso"), []);

console.log("Bloco 24 (busca global): todos os cenários passaram.");
