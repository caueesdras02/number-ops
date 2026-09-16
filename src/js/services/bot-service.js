// Camada de leitura da Central Number Ops Bot. Só lê (integration_events via
// repository dedicado + incidents/numbers/campaigns/clients já carregados em
// numbersService.state) — nenhuma escrita, nenhuma regra operacional aqui.
// Visível para qualquer usuário autenticado (RLS de leitura cobre isso;
// nenhum gate de nível de acesso é aplicado neste serviço de propósito).

export const PROCESSING_STATUS_LABELS = Object.freeze({
  RECEIVED: "Recebido",
  MATCHED: "Número encontrado",
  LINKED_TO_INCIDENT: "Vinculado a ocorrência",
  PENDING_ASSOCIATION: "Sem número associado",
  IGNORED: "Ignorado (não relacionado)",
  ERROR: "Erro ao processar",
});

export const EVENT_TYPE_LABELS = Object.freeze({
  CONNECTIVITY_ALERT: "Alerta de desconexão",
  CONNECTIVITY_RESTORED: "Recuperação de conectividade",
  UNKNOWN: "Não identificado",
});

export const CLASSIFICATION_LABELS = Object.freeze({
  CONNECTIVITY: "Conectividade",
  CONFIRMED_RESTRICTION: "Restrição confirmada",
  INDETERMINATE: "Indeterminado",
});

function mapRow(row) {
  return {
    id: row.id,
    source: row.source,
    sourceEventId: row.source_event_id,
    eventType: row.event_type,
    phoneNormalized: row.phone_normalized,
    numberId: row.number_id,
    campaignId: row.campaign_id,
    clientId: row.client_id,
    matchedConfidence: row.matched_confidence,
    processingStatus: row.processing_status,
    linkedIncidentId: row.linked_incident_id,
    errorMessage: row.error_message,
    metadata: row.metadata ?? {},
    receivedAt: row.received_at,
    processedAt: row.processed_at,
  };
}

export class BotService {
  /** @param {{ repository: {list():Promise<any[]>}|null, numbersService: object }} params */
  constructor({ repository, numbersService }) {
    this.repository = repository;
    this.numbers = numbersService;
  }

  /** false no modo local/offline (sem Supabase) — não há como saber sobre eventos do Telegram. */
  get available() { return Boolean(this.repository); }

  async load() {
    if (!this.repository) return { available: false, events: [], metrics: this.emptyMetrics() };
    const rows = await this.repository.list();
    const events = rows.map(mapRow).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).map((event) => this.enrich(event));
    return { available: true, events, metrics: this.computeMetrics(events) };
  }

  enrich(event) {
    const state = this.numbers.state;
    const number = event.numberId ? state.numbers.find((item) => item.id === event.numberId) ?? null : null;
    const campaign = event.campaignId ? state.campaigns.find((item) => item.id === event.campaignId) ?? null : null;
    const client = event.clientId ? state.clients.find((item) => item.id === event.clientId) ?? null : null;
    const incident = event.linkedIncidentId ? state.incidents.find((item) => item.id === event.linkedIncidentId) ?? null : null;
    return { ...event, number, campaign, client, incident };
  }

  emptyMetrics() { return { total: 0, matched: 0, pending: 0, openConnectivity: this.openConnectivityCount() }; }

  computeMetrics(events) {
    return {
      total: events.length,
      matched: events.filter((event) => event.processingStatus === "MATCHED" || event.processingStatus === "LINKED_TO_INCIDENT").length,
      pending: events.filter((event) => event.processingStatus === "PENDING_ASSOCIATION").length,
      openConnectivity: this.openConnectivityCount(),
      lastEvent: events[0] ?? null,
    };
  }

  /** Ocorrências CONNECTIVITY abertas criadas pela integração — não depende de integration_events,
   * só de incidents (já carregado), por isso funciona mesmo se a lista de eventos ainda não chegou. */
  openConnectivityCount() {
    return this.numbers.state.incidents.filter((item) => item.classification === "CONNECTIVITY" && item.origin === "TELEGRAM_BOT" && item.status === "OPEN").length;
  }

  get(id, events) { return events?.find((event) => event.id === id) ?? null; }
}
