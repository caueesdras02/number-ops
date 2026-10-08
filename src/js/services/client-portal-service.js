// Portal do cliente (acesso CLIENT, migrations 028/029). Lê SÓ pela RPC public.client_portal(),
// que já devolve apenas os campos combinados com o cliente — este serviço só organiza esses
// dados para a tela (saúde de cada chip, campanha atual, quedas) e nunca toca o `state` interno.
import { CAMPAIGN_STAGE_LABELS } from "./campaigns-service.js";

export const CHIP_HEALTH = Object.freeze({ CRITICAL: "CRITICAL", ATTENTION: "ATTENTION", OK: "OK", INACTIVE: "INACTIVE" });
export const CHIP_HEALTH_LABELS = Object.freeze({ CRITICAL: "Crítico", ATTENTION: "Atenção", OK: "Saudável", INACTIVE: "Fora de operação" });
export const RESTRICTION_LABELS = Object.freeze({ GROUP_CREATION: "Não consegue criar grupos", SEND_LIMIT: "Limitação no envio", NO_AREA: "Sem área", OTHER: "Restrição operacional" });
export const ROLE_LABELS = Object.freeze({ PRIMARY: "Principal/Disparo", BACKUP: "Backup", SUPPORT: "Apoio" });

const DAY = 24 * 60 * 60 * 1000;
const HEALTH_ORDER = { CRITICAL: 0, ATTENTION: 1, OK: 2, INACTIVE: 3 };
const time = (iso) => (iso ? new Date(iso).getTime() : 0);

/**
 * Saúde do chip a partir do que o cliente pode ver:
 * - Crítico: bloqueado, restrição "Sem área" ou queda em aberto agora;
 * - Atenção: em aquecimento/em análise, outra restrição ativa ou queda nos últimos 7 dias;
 * - Fora de operação: arquivado ou inativo;
 * - Saudável: o resto.
 */
export function chipHealth(chip, outages = [], now = Date.now()) {
  if (chip.archived) return { level: CHIP_HEALTH.INACTIVE, reasons: ["Arquivado"] };
  if (chip.status === "INACTIVE") return { level: CHIP_HEALTH.INACTIVE, reasons: ["Inativo"] };
  const critical = [];
  const attention = [];
  if (chip.status === "BLOCKED") critical.push("Bloqueado");
  if (chip.restriction === "NO_AREA") critical.push(RESTRICTION_LABELS.NO_AREA);
  if (outages.some((outage) => outage.status === "OPEN")) critical.push("Queda em aberto");
  if (chip.status === "WARMING") attention.push("Em aquecimento");
  if (chip.status === "UNDER_REVIEW") attention.push("Em análise");
  if (chip.restriction && chip.restriction !== "NO_AREA") attention.push(RESTRICTION_LABELS[chip.restriction] ?? RESTRICTION_LABELS.OTHER);
  if (outages.some((outage) => outage.status !== "OPEN" && now - time(outage.createdAt) <= 7 * DAY)) attention.push("Queda nos últimos 7 dias");
  if (critical.length) return { level: CHIP_HEALTH.CRITICAL, reasons: [...critical, ...attention] };
  if (attention.length) return { level: CHIP_HEALTH.ATTENTION, reasons: attention };
  return { level: CHIP_HEALTH.OK, reasons: [] };
}

/** Organiza a resposta crua de client_portal() para a tela. Puro — testável sem rede. */
export function buildPortalView(data, now = Date.now()) {
  const campaigns = (data?.campaigns ?? []).map((campaign) => ({
    ...campaign,
    stageLabel: campaign.status === "CLOSED" ? CAMPAIGN_STAGE_LABELS.ENCERRADA : CAMPAIGN_STAGE_LABELS[campaign.stage] ?? "—",
  }));
  const campaignName = (id) => campaigns.find((campaign) => campaign.id === id)?.name ?? "—";
  const rawOutages = data?.outages ?? [];

  const chips = (data?.chips ?? []).map((chip) => {
    const outages = rawOutages.filter((outage) => outage.numberId === chip.id);
    const links = chip.links ?? [];
    const currentLinks = links.filter((link) => !link.endedAt).map((link) => ({ ...link, campaignName: campaignName(link.campaignId), roleLabel: ROLE_LABELS[link.role] ?? link.role }));
    const lastLink = links[0] ?? null;
    return {
      ...chip,
      currentLinks,
      lastCampaignName: lastLink ? campaignName(lastLink.campaignId) : null,
      lastLinkEndedAt: currentLinks.length ? null : lastLink?.endedAt ?? null,
      outages30d: outages.filter((outage) => now - time(outage.createdAt) <= 30 * DAY).length,
      health: chipHealth(chip, outages, now),
    };
  }).sort((a, b) => HEALTH_ORDER[a.health.level] - HEALTH_ORDER[b.health.level] || a.phone.localeCompare(b.phone));

  const chipById = new Map(chips.map((chip) => [chip.id, chip]));
  const outages = rawOutages.map((outage) => ({
    ...outage,
    phone: chipById.get(outage.numberId)?.phone ?? null,
    identification: chipById.get(outage.numberId)?.identification ?? "",
    campaignName: campaignName(outage.campaignId),
  }));

  const externalChips = (data?.externalChips ?? []).map((chip) => ({
    ...chip,
    campaignName: campaignName(chip.campaignId),
    alerts7d: (chip.alerts ?? []).filter((alert) => now - time(alert) <= 7 * DAY).length,
    lastAlertAt: chip.alerts?.[0] ?? null,
  }));

  const operating = chips.filter((chip) => chip.health.level !== CHIP_HEALTH.INACTIVE);
  return {
    client: data?.client ?? null,
    generatedAt: data?.generatedAt ?? null,
    campaigns: campaigns.map((campaign) => ({ ...campaign, chipsNow: chips.filter((chip) => chip.currentLinks.some((link) => link.campaignId === campaign.id)) }))
      .sort((a, b) => (a.status === "CLOSED") - (b.status === "CLOSED") || time(b.startedAt) - time(a.startedAt)),
    chips,
    outages,
    externalChips: externalChips.filter((chip) => !chip.endedAt),
    summary: {
      chips: operating.length + externalChips.filter((chip) => !chip.endedAt).length,
      inCampaignNow: chips.filter((chip) => chip.currentLinks.length).length + externalChips.filter((chip) => !chip.endedAt).length,
      needAttention: chips.filter((chip) => chip.health.level === CHIP_HEALTH.CRITICAL || chip.health.level === CHIP_HEALTH.ATTENTION).length,
      openOutages: outages.filter((outage) => outage.status === "OPEN").length,
      outages7d: outages.filter((outage) => now - time(outage.createdAt) <= 7 * DAY).length
        + externalChips.filter((chip) => !chip.endedAt).reduce((sum, chip) => sum + chip.alerts7d, 0),
    },
  };
}

export class ClientPortalService {
  /** @param {{ rpc: (name: string, args: object) => Promise<{data: any, error: any}> }} deps */
  constructor({ rpc }) { this.rpc = rpc; }

  /** clientId só é aceito pelo banco para MASTER/ADMIN ("ver como o cliente vê"). */
  async load(clientId = null) {
    const { data, error } = await this.rpc("client_portal", clientId ? { p_client_id: clientId } : {});
    if (error) throw new Error(error.code === "42501" ? "Seu acesso de cliente ainda não foi configurado. Fale com a equipe Live Shop Turbo." : "Não foi possível carregar o acompanhamento agora. Tente novamente em instantes.");
    return buildPortalView(data);
  }
}
