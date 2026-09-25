// Camada de leitura + ações manuais da Central Number Ops Bot.
//
// LEITURA: integration_events + external_numbers (via repositories dedicados)
// enriquecidos com incidents/numbers/campaigns/clients já carregados em
// numbersService.state — nenhuma query extra para isso.
//
// ESCRITA (só as duas ações manuais deste bloco — RBAC: nunca para VIEWER):
// - markNotOwned: classifica um PENDING_ASSOCIATION como "não pertence à
//   operação" — grava na memória de externos (external_numbers) e move o
//   evento para IGNORED_NOT_OWNED. Nunca cria número/ocorrência, nunca toca
//   status/restrição/utilização/campanha.
// - associateNumber: associa um PENDING_ASSOCIATION a um número JÁ
//   cadastrado (nunca cria número) e reprocessa com segurança o mesmo
//   pipeline campanha -> classificação -> ocorrência que a Edge Function
//   already aplica automaticamente — reaproveitando a MESMA regra de
//   dedupe (Ocorrência CONNECTIVITY OPEN por número).
//
// A classificação automática de números externos em alertas FUTUROS
// acontece no backend (supabase/functions/telegram-webhook/handler.js) —
// este serviço só lê/grava a memória, não reprocessa eventos passados
// automaticamente.
import { canOperate } from "../models/access.js";
import { canonicalBrazilianPhone } from "../models/phone.js";
import { createId, now } from "../models/helpers.js";
import { normalizeSearchText } from "../models/search-match.js";

export const PROCESSING_STATUS_LABELS = Object.freeze({
  RECEIVED: "Recebido",
  MATCHED: "Número encontrado",
  LINKED_TO_INCIDENT: "Vinculado a ocorrência",
  PENDING_ASSOCIATION: "Sem número associado",
  IGNORED: "Ignorado (não relacionado)",
  IGNORED_NOT_OWNED: "Não pertence à operação",
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

const CONNECTIVITY_TITLE = "Alerta de desconexão (Telegram)";
const CONNECTIVITY_DESCRIPTION =
  "Evento de conectividade recebido via integração automática (Telegram). " +
  "Não implica bloqueio/queda confirmada — aguardando diagnóstico manual antes de qualquer ação operacional.";

function normalizeLabel(value) {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

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
  /**
   * @param {{
   *   integrationEventsRepository: object|null,
   *   externalNumbersRepository?: object|null,
   *   incidentsRepository?: object|null,
   *   historyEventsRepository?: object|null,
   *   numbersService: object,
   *   currentProfile?: object|null,
   * }} params
   */
  constructor({ integrationEventsRepository, externalNumbersRepository = null, incidentsRepository = null, historyEventsRepository = null, externalNumberCampaignLinksRepository = null, numbersService, currentProfile = null }) {
    this.repository = integrationEventsRepository;
    this.externalNumbersRepository = externalNumbersRepository;
    this.incidentsRepository = incidentsRepository;
    this.historyEventsRepository = historyEventsRepository;
    this.externalNumberCampaignLinksRepository = externalNumberCampaignLinksRepository;
    this.numbers = numbersService;
    this.currentProfile = currentProfile;
    this.externalNumbers = [];
  }

  /** false no modo local/offline (sem Supabase) — não há como saber sobre eventos do Telegram. */
  get available() { return Boolean(this.repository); }

  /** VIEWER só visualiza; qualquer outro cargo operacional (USER/ADMIN/MASTER) pode agir. */
  get canModify() { return canOperate(this.currentProfile); }

  assertCanModify() {
    if (!this.canModify) throw new Error("Você não tem permissão para realizar esta ação.");
  }

  async load() {
    if (!this.repository) return { available: false, events: [], metrics: this.emptyMetrics(), canModify: false };
    const [rows, externalRows] = await Promise.all([
      this.repository.list(),
      this.externalNumbersRepository ? this.externalNumbersRepository.list() : Promise.resolve([]),
    ]);
    this.externalNumbers = externalRows ?? [];
    const events = rows.map(mapRow).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).map((event) => this.enrich(event));
    return { available: true, events, metrics: this.computeMetrics(events), canModify: this.canModify };
  }

  enrich(event) {
    const state = this.numbers.state;
    const number = event.numberId ? state.numbers.find((item) => item.id === event.numberId) ?? null : null;
    const campaign = event.campaignId ? state.campaigns.find((item) => item.id === event.campaignId) ?? null : null;
    const client = event.clientId ? state.clients.find((item) => item.id === event.clientId) ?? null : null;
    const incident = event.linkedIncidentId ? state.incidents.find((item) => item.id === event.linkedIncidentId) ?? null : null;
    const externalNumberId = event.metadata?.notOwned?.externalNumberId ?? null;
    const externalRecord = externalNumberId ? this.externalNumbers.find((item) => item.id === externalNumberId) ?? null : null;
    // Campanhas às quais este número externo JÁ está vinculado (ver linkToCampaign) — resolvidas
    // com nome de campanha/cliente pra UI mostrar "já vinculado a X" sem lookup manual.
    const existingExternalLinks = externalNumberId
      ? (state.externalNumberCampaignLinks ?? [])
          .filter((link) => link.externalNumberId === externalNumberId && !link.endedAt)
          .map((link) => {
            const linkCampaign = state.campaigns.find((item) => item.id === link.campaignId) ?? null;
            const linkClient = linkCampaign ? state.clients.find((item) => item.id === linkCampaign.clientId) ?? null : null;
            return { ...link, campaignName: linkCampaign?.name ?? null, clientName: linkClient?.name ?? null };
          })
      : [];
    // Só pra número que não é nosso (IGNORED_NOT_OWNED) — nunca mexe na classificação automática
    // de números já nossos. Ver findPossibleOldCampaign.
    const possibleOldCampaign = event.processingStatus === "IGNORED_NOT_OWNED" ? this.findPossibleOldCampaign(event) : null;
    return { ...event, number, campaign, client, incident, externalRecord, existingExternalLinks, possibleOldCampaign };
  }

  /**
   * Sinal de que a operação pode ter migrado pra uma campanha nova sem encerrar a antiga: a
   * Empresa do alerta bate (nome exato, sem acento/maiúscula) com um Cliente já cadastrado, e
   * esse Cliente já tem uma Campanha ATIVA com nome DIFERENTE do Liveshop deste alerta. Puramente
   * um diagnóstico de LEITURA — quem decide encerrar a campanha antiga é sempre a pessoa (ver
   * data-action="bot-close-old-campaign" em bot-controller.js, que reaproveita
   * CampaignsService.close(), o mesmo fluxo oficial usado em Campanhas).
   */
  findPossibleOldCampaign(event) {
    const empresa = event.metadata?.empresa;
    const liveshop = event.metadata?.liveshop;
    if (!empresa || !liveshop) return null;
    const state = this.numbers.state;
    const client = state.clients.find((item) => item.isActive && normalizeSearchText(item.name) === normalizeSearchText(empresa));
    if (!client) return null;
    const oldCampaign = state.campaigns.find((campaign) => campaign.status === "ACTIVE" && campaign.clientId === client.id && normalizeSearchText(campaign.name) !== normalizeSearchText(liveshop));
    if (!oldCampaign) return null;
    return { campaignId: oldCampaign.id, campaignName: oldCampaign.name, clientId: client.id, clientName: client.name };
  }

  emptyMetrics() { return { total: 0, matched: 0, pending: 0, notOwned: 0, openConnectivity: this.openConnectivityCount() }; }

  computeMetrics(events) {
    return {
      total: events.length,
      matched: events.filter((event) => event.processingStatus === "MATCHED" || event.processingStatus === "LINKED_TO_INCIDENT").length,
      pending: events.filter((event) => event.processingStatus === "PENDING_ASSOCIATION").length,
      notOwned: events.filter((event) => event.processingStatus === "IGNORED_NOT_OWNED").length,
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

  // ---------------------------------------------------------------------
  // Ações manuais (RBAC: nunca para VIEWER; ver assertCanModify)
  // ---------------------------------------------------------------------

  /**
   * Classifica um evento PENDING_ASSOCIATION como "não pertence à operação".
   * Não apaga o integration_event, não cria número, não cria ocorrência, não
   * toca status/restrição/utilização/campanha. Grava quem classificou e
   * quando (na memória de externos e no próprio evento).
   */
  async markNotOwned(eventId, event) {
    this.assertCanModify();
    if (!this.externalNumbersRepository) throw new Error("Memória de números externos não disponível.");
    if (event.processingStatus !== "PENDING_ASSOCIATION") throw new Error("Este evento não está pendente de associação.");
    const canonicalPhone = canonicalBrazilianPhone(event.phoneNormalized);
    if (!canonicalPhone) throw new Error("Telefone do evento não pôde ser normalizado — verifique o alerta original.");

    const nowIso = now();
    let externalId;
    try {
      const inserted = await this.externalNumbersRepository.upsert({ phone_normalized: canonicalPhone, classified_by: this.currentProfile?.id ?? null });
      externalId = inserted.id;
      this.externalNumbers.push(inserted);
    } catch (error) {
      if (error?.code === "23505") {
        // Já existe uma classificação ATIVA para este telefone (ex.: outro evento do
        // mesmo número já foi marcado antes) — reaproveita, nunca duplica a memória.
        // Relê do repositório (não confia só no cache local) para cobrir tanto a
        // corrida entre duas chamadas nesta mesma sessão quanto uma classificação
        // já existente de antes do load() atual.
        const all = await this.externalNumbersRepository.list();
        const active = all.find((item) => item.phone_normalized === canonicalPhone && !item.reverted_at);
        if (!active) throw new Error("Falha ao registrar número externo.");
        externalId = active.id;
        this.externalNumbers = all;
      } else {
        throw new Error("Falha ao registrar número externo.");
      }
    }

    await this.repository.update(eventId, {
      processing_status: "IGNORED_NOT_OWNED",
      metadata: { ...event.metadata, notOwned: { reason: "NUMBER_NOT_OWNED", externalNumberId: externalId, classifiedBy: this.currentProfile?.id ?? null, classifiedAt: nowIso, auto: false } },
      processed_at: nowIso,
    });
  }

  /** Reverte a classificação externa (não apaga o histórico — só marca reverted_at/by).
   * Alertas futuros desse telefone voltam a poder virar PENDING_ASSOCIATION normalmente. */
  async revertNotOwned(externalNumberId) {
    this.assertCanModify();
    if (!this.externalNumbersRepository) throw new Error("Memória de números externos não disponível.");
    await this.externalNumbersRepository.update(externalNumberId, {
      reverted_at: now(),
      reverted_by: this.currentProfile?.id ?? null,
    });
  }

  /**
   * Vincula um número JÁ classificado como externo (IGNORED_NOT_OWNED) a uma Campanha JÁ
   * EXISTENTE — nunca cria Campanha, nunca cria um registro em `numbers`. Cliente/Squad são
   * sempre derivados da Campanha escolhida, nunca gravados aqui. Telefone/empresa/conta do
   * cliente vêm do próprio evento (o texto do alerta do Telegram), desnormalizados na linha do
   * vínculo — mesma regra de dedupe por corrida das outras ações deste serviço (23505 -> relê e
   * reaproveita, nunca duplica).
   */
  async linkToCampaign(eventId, campaignId, event) {
    this.assertCanModify();
    if (!this.externalNumberCampaignLinksRepository) throw new Error("Vínculo de campanha para números externos não disponível.");
    if (event.processingStatus !== "IGNORED_NOT_OWNED") throw new Error("Este evento não está classificado como não pertencente à operação.");
    const externalNumberId = event.metadata?.notOwned?.externalNumberId;
    if (!externalNumberId) throw new Error("Número externo não identificado — reclassifique o evento antes de vincular.");
    const campaign = this.numbers.state.campaigns.find((item) => item.id === campaignId);
    if (!campaign) throw new Error("Selecione uma campanha já cadastrada.");

    const record = {
      id: createId("external_campaign_link"),
      external_number_id: externalNumberId,
      campaign_id: campaignId,
      phone_normalized: event.phoneNormalized,
      company_label: event.metadata?.empresa || null,
      client_account_label: event.metadata?.contaCliente || null,
      linked_by: this.currentProfile?.id ?? null,
    };
    let inserted;
    try {
      inserted = await this.externalNumberCampaignLinksRepository.upsert(record);
    } catch (error) {
      if (error?.code === "23505") {
        // Já vinculado a esta mesma campanha (outra aba/ação ou reenvio) — reaproveita, nunca duplica.
        const all = await this.externalNumberCampaignLinksRepository.list();
        const existing = all.find((row) => row.external_number_id === externalNumberId && row.campaign_id === campaignId && !row.ended_at);
        if (!existing) throw new Error("Conflito ao vincular a campanha — tente novamente.");
        inserted = existing;
      } else {
        throw new Error("Falha ao vincular a campanha.");
      }
    }

    const mapped = {
      id: inserted.id, externalNumberId: inserted.external_number_id, campaignId: inserted.campaign_id,
      phoneNormalized: inserted.phone_normalized, companyLabel: inserted.company_label, clientAccountLabel: inserted.client_account_label,
      linkedBy: inserted.linked_by, linkedAt: inserted.linked_at, endedBy: inserted.ended_by, endedAt: inserted.ended_at,
      createdAt: inserted.created_at, updatedAt: inserted.updated_at,
    };
    // Reflete imediatamente no estado local, sem esperar reload — mesma lógica de
    // linkOrCreateIncident (a escrita já foi feita direto no Supabase acima).
    if (!this.numbers.state.externalNumberCampaignLinks.some((link) => link.id === mapped.id)) {
      this.numbers.state.externalNumberCampaignLinks.push(mapped);
    }
  }

  /**
   * Associa um PENDING_ASSOCIATION a um número JÁ cadastrado (nunca cria
   * número) e reprocessa o pipeline campanha -> classificação -> ocorrência
   * com a MESMA regra de dedupe já usada pela integração automática
   * (Ocorrência CONNECTIVITY OPEN por número — nunca duplica).
   */
  async associateNumber(eventId, numberId, event) {
    this.assertCanModify();
    if (event.processingStatus !== "PENDING_ASSOCIATION") throw new Error("Este evento não está pendente de associação.");
    const number = this.numbers.state.numbers.find((item) => item.id === numberId);
    if (!number) throw new Error("Selecione um número já cadastrado.");

    const activeLinks = (this.numbers.state.numberCampaignLinks ?? []).filter((link) => link.numberId === numberId && !link.endedAt);
    let campaignId = null, clientId = null, campaignMatch = "none";
    if (activeLinks.length === 1) {
      const campaign = this.numbers.state.campaigns.find((item) => item.id === activeLinks[0].campaignId);
      campaignId = campaign?.id ?? null;
      clientId = campaign?.clientId ?? null;
      campaignMatch = "single_active_link";
    } else if (activeLinks.length > 1) {
      const candidates = activeLinks.map((link) => this.numbers.state.campaigns.find((item) => item.id === link.campaignId)).filter(Boolean);
      const targetLabel = event.metadata?.liveshop ? normalizeLabel(event.metadata.liveshop) : null;
      const byName = targetLabel ? candidates.filter((item) => normalizeLabel(item.name) === targetLabel) : [];
      if (byName.length === 1) {
        campaignId = byName[0].id;
        clientId = byName[0].clientId ?? null;
        campaignMatch = "matched_by_name";
      } else {
        campaignMatch = "ambiguous";
      }
    }

    const nowIso = now();
    await this.repository.update(eventId, {
      number_id: numberId,
      campaign_id: campaignId,
      client_id: clientId,
      matched_confidence: 1,
      processing_status: "MATCHED",
      metadata: { ...event.metadata, campaignMatch, manualAssociation: { by: this.currentProfile?.id ?? null, at: nowIso } },
      processed_at: nowIso,
    });

    if (event.eventType === "CONNECTIVITY_ALERT") {
      await this.linkOrCreateIncident({ eventId, numberId, campaignId });
    }
  }

  /** Mesma regra de dedupe da integração automática (classification.js `ensureIncidentLinked`):
   * reaproveita a Ocorrência CONNECTIVITY OPEN do número se já existir; só cria uma nova
   * quando não existe. Nunca cria duas para o mesmo número simultaneamente. */
  async linkOrCreateIncident({ eventId, numberId, campaignId }) {
    if (!this.incidentsRepository) throw new Error("Não é possível criar o acompanhamento — repositório indisponível.");
    const nowIso = now();
    const openIncident = this.numbers.state.incidents.find(
      (item) => item.numberId === numberId && item.classification === "CONNECTIVITY" && item.origin === "TELEGRAM_BOT" && item.status === "OPEN",
    );
    if (openIncident) {
      await this.repository.update(eventId, { linked_incident_id: openIncident.id, processing_status: "LINKED_TO_INCIDENT", processed_at: nowIso });
      return;
    }

    const incidentId = createId("incident");
    try {
      await this.incidentsRepository.upsert({
        id: incidentId,
        number_id: numberId,
        campaign_id: campaignId,
        origin: "TELEGRAM_BOT",
        classification: "CONNECTIVITY",
        integration_event_id: eventId,
        type: "CONNECTIVITY",
        title: CONNECTIVITY_TITLE,
        description: CONNECTIVITY_DESCRIPTION,
        status: "OPEN",
      });
    } catch (error) {
      if (error?.code === "23505") {
        // Corrida rara (outra aba/ação já criou a OPEN deste número, ou já linkou este
        // mesmo evento) — recupera a ocorrência certa em vez de duplicar.
        const all = this.incidentsRepository ? await this.incidentsRepository.list() : [];
        const existing = all.find((item) => item.integration_event_id === eventId)
          ?? all.find((item) => item.number_id === numberId && item.classification === "CONNECTIVITY" && item.origin === "TELEGRAM_BOT" && item.status === "OPEN");
        if (!existing) throw new Error("Conflito ao criar o acompanhamento — tente novamente.");
        await this.repository.update(eventId, { linked_incident_id: existing.id, processing_status: "LINKED_TO_INCIDENT", processed_at: nowIso });
        return;
      }
      throw new Error("Falha ao criar o acompanhamento a partir do evento.");
    }

    if (this.historyEventsRepository) {
      await this.historyEventsRepository.upsert({
        id: createId("history"),
        number_id: numberId,
        type: "INCIDENT_CREATED",
        description: `Ocorrência criada automaticamente pela integração (Telegram): ${CONNECTIVITY_TITLE}`,
        metadata: { incidentId, origin: "TELEGRAM_BOT", integrationEventId: eventId },
        occurred_at: nowIso,
      });
    }

    await this.repository.update(eventId, { linked_incident_id: incidentId, processing_status: "LINKED_TO_INCIDENT", processed_at: nowIso });

    // Reflete imediatamente no estado local (Central/Ocorrências/Dashboard já carregados
    // em memória) sem esperar um reload — mesmo padrão de leitura já usado por
    // openConnectivityCount(). Não chama numbersService.persist() aqui: esta escrita já
    // foi feita direto no Supabase acima; persist() faria um upsert redundante.
    this.numbers.state.incidents.push({
      id: incidentId, numberId, campaignId, type: "CONNECTIVITY", title: CONNECTIVITY_TITLE, description: CONNECTIVITY_DESCRIPTION,
      status: "OPEN", responsibleId: null, resolutionNotes: "", resolvedById: null, resolvedAt: null,
      createdAt: nowIso, updatedAt: nowIso, origin: "TELEGRAM_BOT", classification: "CONNECTIVITY", integrationEventId: eventId,
    });
  }
}
