// Camada de classificação/acompanhamento entre integration_events e
// public.incidents (Ocorrências — estrutura já existente, reaproveitada,
// nenhuma tabela nova). Isolado do parsing/match de handler.js de propósito:
// esta é a única parte da integração que grava um registro operacional
// visível (uma Ocorrência) — mesmo assim, NUNCA altera numbers.status,
// restriction, utilização ou number_campaign_links.
//
// Consolidação por número: vários alertas CONNECTIVITY consecutivos do MESMO
// número, enquanto a Ocorrência anterior continuar OPEN, reaproveitam essa
// mesma Ocorrência (nunca criam uma segunda) — sem janela de tempo, só
// "existe uma CONNECTIVITY/TELEGRAM_BOT OPEN para este número?". Depois que
// ela for RESOLVED (bloco futuro: Normalizou/Confirmar queda), um novo
// alerta volta a criar uma Ocorrência nova.
//
// Classificações preparadas (ver migration 014, coluna incidents.classification):
// - CONNECTIVITY: alerta de desconexão/infraestrutura. Única com evidência
//   hoje suficiente para ser atribuída automaticamente.
// - CONFIRMED_RESTRICTION: reservado para quando houver critério objetivo de
//   queda/bloqueio real. NÃO implementado aqui — nenhum caminho de código
//   atribui esse valor ainda.
// - INDETERMINATE: reservado para evento existente sem informação suficiente
//   para classificar com segurança. NÃO implementado aqui por não termos,
//   hoje, nenhum cenário real que o exija (todo MATCHED atual é
//   CONNECTIVITY_ALERT) — mantido só como valor válido no CHECK do banco.
//
// event_type "CONNECTIVITY_RESTORED" (recuperação/normalização): a
// ARQUITETURA está pronta (resolveOpenConnectivity abaixo), mas NENHUM
// código de parsing produz esse event_type ainda — não existe, até agora,
// nenhuma evidência de qual texto real o bot de infraestrutura envia quando
// a conexão normaliza, e adivinhar palavras-chave aqui seria exatamente o
// tipo de heurística arriscada que este projeto evita. Quando esse texto for
// conhecido, o único ponto que precisa mudar é a atribuição de `eventType`
// em handler.js (ver comentário lá) — esta camada já sabe o que fazer com
// "CONNECTIVITY_RESTORED" no momento em que ele começar a existir.

const CONNECTIVITY_TITLE = "Alerta de desconexão (Telegram)";
const CONNECTIVITY_DESCRIPTION =
  "Evento de conectividade recebido via integração automática (Telegram). " +
  "Não implica bloqueio/queda confirmada — aguardando diagnóstico manual antes de qualquer ação operacional.";
const CONNECTIVITY_RESOLVED_DESCRIPTION = "Ocorrência resolvida automaticamente pela integração (Telegram): conectividade normalizada.";

/**
 * Garante que um integration_event MATCHED de um CONNECTIVITY_ALERT tenha um
 * acompanhamento (incidents) associado — criando um novo quando ainda não
 * existe, ou recuperando/completando o vínculo quando uma tentativa anterior
 * já criou o registro mas falhou antes de terminar (idempotente e seguro a
 * reprocessamento parcial).
 *
 * @param {{
 *   insertIncident: (row: object) => Promise<{ data: {id:string,title:string}|null, error: null|{code?:string,message:string} }>,
 *   insertHistoryEvent: (row: object) => Promise<{ error: null|{message:string} }>,
 *   linkIncidentToIntegrationEvent: (integrationEventId: string, incidentId: string) => Promise<{ error: null|{message:string} }>,
 *   findIncidentByIntegrationEventId: (integrationEventId: string) => Promise<{id:string}|null>,
 *   findOpenConnectivityIncident: (numberId: string) => Promise<{id:string}|null>,
 *   resolveIncident: (incidentId: string) => Promise<{ data: boolean, error: null|{message:string} }>,
 * }} deps
 * @param {{ id: string, processing_status: string, event_type: string, number_id: string|null, campaign_id: string|null, linked_incident_id: string|null }} integrationEvent
 */
export async function ensureIncidentLinked(deps, integrationEvent) {
  // Só MATCHED (number_id resolvido) pode virar acompanhamento — nunca para
  // PENDING_ASSOCIATION/IGNORED/ERROR (não existe número para vincular).
  if (integrationEvent.processing_status !== "MATCHED") return { created: false };
  if (!integrationEvent.number_id) return { created: false };
  // Já linkado (idempotência do lado do próprio evento) — nada a fazer.
  if (integrationEvent.linked_incident_id) return { created: false };
  // Hoje só sabemos classificar com segurança um CONNECTIVITY_ALERT. Qualquer
  // outro event_type que um dia chegue MATCHED fica sem acompanhamento
  // automático (não inventa classificação) até uma regra explícita existir.
  if (integrationEvent.event_type !== "CONNECTIVITY_ALERT") return { created: false };

  const classification = "CONNECTIVITY";

  // Enquanto existir uma Ocorrência CONNECTIVITY ainda OPEN para este número
  // (criada pela própria integração), qualquer novo alerta de conectividade
  // do MESMO número pertence a ela — sem janela de tempo arbitrária, só
  // "existe uma OPEN?". campaign_id nunca entra nesse critério (o número é a
  // entidade principal do acompanhamento); cada integration_event preserva a
  // campanha que ele mesmo identificou naquele momento, sem reescrever a
  // ocorrência. Só depois que ela virar RESOLVED (bloco futuro) um novo
  // alerta volta a criar uma Ocorrência nova.
  const openIncident = await deps.findOpenConnectivityIncident(integrationEvent.number_id);
  if (openIncident) {
    const { error: linkError } = await deps.linkIncidentToIntegrationEvent(integrationEvent.id, openIncident.id);
    if (linkError) throw new Error("Falha ao vincular o evento à ocorrência existente.");
    return { created: false, reused: true, incidentId: openIncident.id };
  }

  const { data: incident, error } = await deps.insertIncident({
    number_id: integrationEvent.number_id,
    campaign_id: integrationEvent.campaign_id ?? null,
    origin: "TELEGRAM_BOT",
    classification,
    integration_event_id: integrationEvent.id,
    type: "CONNECTIVITY",
    title: CONNECTIVITY_TITLE,
    description: CONNECTIVITY_DESCRIPTION,
    status: "OPEN",
  });

  if (error) {
    if (error.code === "23505") {
      // Duas causas possíveis, ambas idempotentes: (a) o mesmo integration_event
      // já tinha criado a ocorrência numa tentativa anterior (retry pós-falha);
      // (b) uma corrida concorrente já criou a OPEN deste número primeiro
      // (garantida pelo índice único parcial da migration 014). Nos dois casos,
      // recupera a ocorrência certa e só completa o vínculo — nunca duplica.
      const existing = (await deps.findIncidentByIntegrationEventId(integrationEvent.id)) ?? (await deps.findOpenConnectivityIncident(integrationEvent.number_id));
      if (existing) {
        const { error: linkError } = await deps.linkIncidentToIntegrationEvent(integrationEvent.id, existing.id);
        if (linkError) throw new Error("Falha ao completar o vínculo do acompanhamento existente.");
      }
      return { created: false, recovered: Boolean(existing) };
    }
    throw new Error("Falha ao criar acompanhamento a partir do evento de conectividade.");
  }

  // Espelha, no histórico do número, o mesmo evento que a criação manual de
  // uma ocorrência já registra hoje (IncidentsService.create) — reaproveita
  // o padrão existente, não inventa um mecanismo novo de trilha. Falha aqui
  // não deve passar batido: propaga para o chamador devolver 500 e o
  // Telegram reenviar (o incident já existe e não será duplicado no retry).
  const { error: historyError } = await deps.insertHistoryEvent({
    number_id: integrationEvent.number_id,
    type: "INCIDENT_CREATED",
    description: `Ocorrência criada automaticamente pela integração (Telegram): ${incident.title}`,
    metadata: { incidentId: incident.id, origin: "TELEGRAM_BOT", integrationEventId: integrationEvent.id },
  });
  if (historyError) throw new Error("Falha ao registrar histórico do acompanhamento.");

  const { error: linkError } = await deps.linkIncidentToIntegrationEvent(integrationEvent.id, incident.id);
  if (linkError) throw new Error("Falha ao vincular o acompanhamento ao evento de origem.");

  return { created: true, incidentId: incident.id };
}

/**
 * Resolve a Ocorrência CONNECTIVITY OPEN do número, a partir de um evento de
 * recuperação/normalização (event_type "CONNECTIVITY_RESTORED"). NUNCA cria
 * uma Ocorrência — só resolve uma que já exista. Idempotente: reenvio do
 * mesmo evento (ou um segundo evento de recuperação concorrente) nunca
 * duplica a resolução nem o histórico, mesmo sob corrida (a atualização no
 * banco só "conta" como resolução nova quando ela de fato muda o status).
 *
 * NÃO altera number.status/restriction/utilização/vínculo de campanha — só
 * escreve em `incidents` (status/resolved_at/resolution_notes) e
 * `history_events`, exatamente como a resolução manual já existente faz.
 *
 * @param {object} deps ver JSDoc de ensureIncidentLinked (mesmo objeto, + resolveIncident)
 * @param {{ id: string, processing_status: string, event_type: string, number_id: string|null, linked_incident_id: string|null }} integrationEvent
 */
export async function resolveOpenConnectivity(deps, integrationEvent) {
  if (integrationEvent.processing_status !== "MATCHED") return { resolved: false };
  if (!integrationEvent.number_id) return { resolved: false };
  if (integrationEvent.linked_incident_id) return { resolved: false };
  if (integrationEvent.event_type !== "CONNECTIVITY_RESTORED") return { resolved: false };

  const openIncident = await deps.findOpenConnectivityIncident(integrationEvent.number_id);
  // Regra explícita: se não houver Ocorrência OPEN, não cria nada — a
  // recuperação só faz sentido em relação a uma desconexão já registrada.
  if (!openIncident) return { resolved: false };

  const { data: resolvedNow, error: resolveError } = await deps.resolveIncident(openIncident.id);
  if (resolveError) throw new Error("Falha ao resolver o acompanhamento a partir do evento de recuperação.");

  // Só grava o histórico quando ESTA chamada de fato mudou o status (evita
  // duplicar INCIDENT_RESOLVED se outra tentativa concorrente já resolveu).
  if (resolvedNow) {
    const { error: historyError } = await deps.insertHistoryEvent({
      number_id: integrationEvent.number_id,
      type: "INCIDENT_RESOLVED",
      description: CONNECTIVITY_RESOLVED_DESCRIPTION,
      metadata: { incidentId: openIncident.id, origin: "TELEGRAM_BOT", integrationEventId: integrationEvent.id },
    });
    if (historyError) throw new Error("Falha ao registrar histórico da resolução automática.");
  }

  const { error: linkError } = await deps.linkIncidentToIntegrationEvent(integrationEvent.id, openIncident.id);
  if (linkError) throw new Error("Falha ao vincular o evento de recuperação à ocorrência.");

  return { resolved: Boolean(resolvedNow), incidentId: openIncident.id };
}

/**
 * Único ponto de despacho entre os dois caminhos de classificação. Hoje,
 * `event_type` só pode ser "CONNECTIVITY_ALERT" (o parser não produz mais
 * nada) — o ramo "CONNECTIVITY_RESTORED" fica pronto e testado, aguardando o
 * dia em que soubermos reconhecer a mensagem real de recuperação.
 */
export async function processConnectivityClassification(deps, integrationEvent) {
  if (integrationEvent.event_type === "CONNECTIVITY_ALERT") return ensureIncidentLinked(deps, integrationEvent);
  if (integrationEvent.event_type === "CONNECTIVITY_RESTORED") return resolveOpenConnectivity(deps, integrationEvent);
  return { created: false, resolved: false };
}
