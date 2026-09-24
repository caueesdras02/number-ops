// "Caixa de correio" transitória (só memória, nunca persistida) pra levar dados de
// pré-preenchimento do form de Nova Campanha de um controller pro outro (Central Number Ops Bot
// -> Campanhas) sem acoplar os dois nem introduzir um store/roteador global — mesmo espírito de
// simplicidade do resto do app. set() no clique de origem, take() consome E limpa no destino, então
// nunca "sobra" pendurado pra uma navegação futura sem relação com isso.
let pending = null;

export function setPendingCampaignPrefill(data) {
  pending = data;
}

export function takePendingCampaignPrefill() {
  const value = pending;
  pending = null;
  return value;
}
