/**
 * El embudo de un anuncio, un conjunto o una campaña, segun para que optimiza Meta.
 *
 * Una campaña de visitas al perfil no busca clics salientes: busca visitas al perfil. Por eso los pasos de Meta cambian
 * con la optimizacion del conjunto (`meta_adsets.optimization_goal`), y si no hay, con el objetivo de la campaña. Lo que
 * viene despues es igual en todos: los leads (lo que cuenta Meta al lado de lo que llego a tu CRM), las agendas y las
 * ventas. Desde los leads en adelante, los porcentajes salen del CRM.
 *
 * Puro: la pantalla le pasa los totales, las acciones del periodo sumadas y lo que dice el CRM.
 */

import { ratio, type AdsRow, type AdsTotals } from "./ads";

// ── Que funnel corresponde ───────────────────────────────────────────────

export type FunnelKind = "profile" | "traffic" | "messages" | "leads" | "sales" | "video" | "engagement" | "awareness" | "generic";

export const FUNNEL_KIND_LABELS: Record<FunnelKind, string> = {
  profile: "Visitas al perfil",
  traffic: "Tráfico a la web",
  messages: "Mensajes",
  leads: "Clientes potenciales",
  sales: "Ventas",
  video: "Reproducciones de video",
  engagement: "Interacción",
  awareness: "Reconocimiento",
  generic: "General",
};

/** Por la optimizacion del conjunto: es lo que Meta trata de conseguir con cada peso. */
const BY_GOAL: Record<string, FunnelKind> = {
  PROFILE_VISIT: "profile",
  VISIT_INSTAGRAM_PROFILE: "profile",
  LANDING_PAGE_VIEWS: "traffic",
  LINK_CLICKS: "traffic",
  CONVERSATIONS: "messages",
  REPLIES: "messages",
  LEAD_GENERATION: "leads",
  QUALITY_LEAD: "leads",
  QUALITY_CALL: "leads",
  VALUE: "sales",
  THRUPLAY: "video",
  TWO_SECOND_CONTINUOUS_VIDEO_VIEWS: "video",
  POST_ENGAGEMENT: "engagement",
  ENGAGED_USERS: "engagement",
  PAGE_LIKES: "engagement",
  EVENT_RESPONSES: "engagement",
  REACH: "awareness",
  IMPRESSIONS: "awareness",
  AD_RECALL_LIFT: "awareness",
};

/** Por el objetivo de la campaña: lo que queda cuando la optimizacion no alcanza (una conversion puede ser un lead o una compra). */
const BY_OBJECTIVE: Record<string, FunnelKind> = {
  OUTCOME_LEADS: "leads",
  LEAD_GENERATION: "leads",
  OUTCOME_SALES: "sales",
  OUTCOME_TRAFFIC: "traffic",
  LINK_CLICKS: "traffic",
  MESSAGES: "messages",
  OUTCOME_ENGAGEMENT: "engagement",
  VIDEO_VIEWS: "video",
  OUTCOME_AWARENESS: "awareness",
  REACH: "awareness",
  BRAND_AWARENESS: "awareness",
};

/** El funnel de UN conjunto. Una conversion (`OFFSITE_CONVERSIONS`, `ONSITE_CONVERSIONS`) la define el objetivo de la campaña. */
export function funnelKindFor(goal: string | null, objective: string | null): FunnelKind {
  const byGoal = goal ? BY_GOAL[goal] : undefined;
  if (byGoal) return byGoal;
  const byObjective = objective ? BY_OBJECTIVE[objective] : undefined;
  return byObjective ?? "generic";
}

/**
 * El funnel de un objeto: el de sus conjuntos (un anuncio o un conjunto tienen uno; una campaña, los de todos). Si los
 * conjuntos optimizan cosas distintas, el general, con la lista de lo que se mezcla para avisarlo: sumar visitas al perfil
 * con leads daria un numero que no significa nada.
 */
export function resolveFunnelKind(params: { goals: Array<string | null>; objective: string | null }): { kind: FunnelKind; mixed: FunnelKind[] } {
  const kinds = [...new Set((params.goals.length > 0 ? params.goals : [null]).map((goal) => funnelKindFor(goal, params.objective)))];
  if (kinds.length === 1) return { kind: kinds[0], mixed: [] };
  return { kind: "generic", mixed: kinds };
}

// ── Las acciones del periodo ─────────────────────────────────────────────

/**
 * Lo que Meta da como RESULTADO del objetivo se guarda junto con las acciones, con este prefijo (`lib/meta/insights.ts`).
 * Las visitas al perfil solo vienen por ahi: no estan en la lista de acciones.
 */
export const RESULT_PREFIX = "result:";

export const ACTION_KEYS = {
  profileVisits: `${RESULT_PREFIX}profile_visit_view`,
  conversations: "onsite_conversion.messaging_conversation_started_7d",
  linkClicks: "link_click",
  landingPageViews: "landing_page_view",
  videoViews: "video_view",
  engagement: "post_engagement",
} as const;

/** Las acciones de las filas, sumadas. Una accion que no vino en ninguna fila no esta (no es un cero). */
export function sumActions(rows: AdsRow[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    for (const [type, value] of Object.entries(row.actions ?? {})) {
      if (typeof value === "number" && Number.isFinite(value)) totals[type] = (totals[type] ?? 0) + value;
    }
  }
  return totals;
}

// ── Los pasos ────────────────────────────────────────────────────────────

export type FunnelStepKey =
  | "impressions"
  | "reach"
  | "clicks"
  | "linkClicks"
  | "landingPageViews"
  | "profileVisits"
  | "conversations"
  | "videoViews"
  | "engagement"
  | "leadsMeta"
  | "leadsCrm"
  | "bookings"
  | "purchasesMeta"
  | "sales";

export interface FunnelVizStep {
  key: FunnelStepKey;
  label: string;
  value: number | null;
  /** Que porcentaje de `base` es este paso (el primero, 100). Null: no hay con que compararlo. */
  percent: number | null;
  /** El paso contra el que se calcula el porcentaje. Null en el primero. */
  base: FunnelStepKey | null;
  /** Quien da el numero: las dos fuentes cuentan cosas distintas. */
  source: "meta" | "crm";
  /** Que es este numero, para el tooltip. */
  tip: string;
}

/** Lo que dice el CRM del objeto en el periodo. */
export interface FunnelCrm {
  leadsTotal: number;
  bookings: number;
  sales: number;
}

type MetaStep = Omit<FunnelVizStep, "percent" | "base" | "source">;

const CLICKS_TIP = {
  outbound:
    "Los clics que Meta cuenta como salientes: los que llevan fuera de Facebook o Instagram, a tu destino. Por eso pueden ser menos que los Clics de la tabla, que cuentan cualquier clic en el anuncio.",
  all: "Todos los clics que informa Meta en el anuncio. Meta no informó clics salientes en este período.",
};

function clicksStep(totals: AdsTotals): MetaStep {
  const outbound = totals.outboundClicks;
  return { key: "clicks", label: "Clics", value: outbound ?? totals.clicks, tip: outbound !== null ? CLICKS_TIP.outbound : CLICKS_TIP.all };
}

const action = (actions: Record<string, number>, key: string): number | null => (key in actions ? actions[key] : null);

/** Los pasos propios de Meta para cada funnel, despues de las impresiones. Un paso opcional en cero no se muestra. */
function metaSteps(kind: FunnelKind, totals: AdsTotals, actions: Record<string, number>): MetaStep[] {
  const linkClicks: MetaStep = {
    key: "linkClicks",
    label: "Clics en el enlace",
    value: action(actions, ACTION_KEYS.linkClicks) ?? totals.outboundClicks,
    tip: "Los clics en el enlace del anuncio: los que llevan a tu web o a tu destino.",
  };
  const landing: MetaStep = {
    key: "landingPageViews",
    label: "Visitas a la página",
    value: action(actions, ACTION_KEYS.landingPageViews),
    tip: "Las veces que tu página terminó de cargar después de un clic. Las cuenta el píxel de Meta: si no está instalado, no hay dato.",
  };
  const conversations: MetaStep = {
    key: "conversations",
    label: "Conversaciones",
    value: action(actions, ACTION_KEYS.conversations),
    tip: "Las conversaciones por mensaje directo que empezaron por el anuncio, según Meta (dentro de los 7 días del clic o la vista).",
  };
  const optional = (step: MetaStep) => ((step.value ?? 0) > 0 ? [step] : []);

  switch (kind) {
    case "profile":
      return [
        {
          key: "profileVisits",
          label: "Visitas al perfil",
          value: action(actions, ACTION_KEYS.profileVisits),
          tip: "Las visitas a tu perfil de Instagram que vinieron del anuncio. Es el resultado que busca esta campaña, según Meta.",
        },
        ...optional(conversations),
      ];
    case "traffic":
      return [linkClicks, ...optional(landing)];
    case "messages":
      return [clicksStep(totals), conversations];
    case "sales":
      return [linkClicks, ...optional(landing)];
    case "video":
      return [{ key: "videoViews", label: "Reproducciones", value: action(actions, ACTION_KEYS.videoViews), tip: "Las reproducciones de al menos 3 segundos, según Meta." }];
    case "engagement":
      return [{ key: "engagement", label: "Interacciones", value: action(actions, ACTION_KEYS.engagement), tip: "Las interacciones con la publicación del anuncio (reacciones, comentarios, guardados, clics), según Meta." }];
    case "awareness":
      return [{ key: "reach", label: "Alcance", value: totals.reach, tip: "Cuántas personas distintas vieron el anuncio al menos una vez en el período." }];
    case "leads":
    case "generic":
      return [clicksStep(totals)];
  }
}

const pct = (value: number | null, base: number | null): number | null => {
  const r = ratio(value, base);
  // Dos decimales: con uno, 40 clics sobre 172.000 impresiones serian un cero.
  return r === null ? null : Number((r * 100).toFixed(2));
};

/**
 * Los pasos del embudo.
 *
 * 1. Impresiones y los pasos de Meta del funnel que corresponde, cada uno contra el anterior.
 * 2. Leads: los que cuenta Meta y los que llegaron a tu CRM, los dos contra el ultimo paso de Meta. Son dos formas de
 *    contar lo mismo, asi que uno no se calcula contra el otro.
 * 3. Agendas y ventas, del CRM, contra los leads del CRM (o, sin leads, contra lo ultimo que haya). Compras Meta, si hubo,
 *    al lado de las ventas, contra los leads de Meta.
 *
 * Un paso del CRM en cero no se muestra (lo dice `funnelNote`). Sin impresiones no hay embudo (null).
 */
export function funnelSteps(params: {
  kind: FunnelKind;
  totals: AdsTotals;
  actions: Record<string, number>;
  crm: FunnelCrm | null;
}): FunnelVizStep[] | null {
  const { kind, totals, actions, crm } = params;
  if (!totals.impressions) return null;

  const steps: FunnelVizStep[] = [
    { key: "impressions", label: "Impresiones", value: totals.impressions, percent: 100, base: null, source: "meta", tip: "Las veces que Meta mostró el anuncio en el período. Una misma persona puede verlo varias veces." },
  ];
  const push = (step: Omit<FunnelVizStep, "percent">) => {
    const base = steps.find((s) => s.key === step.base) ?? null;
    steps.push({ ...step, percent: base ? pct(step.value, base.value) : null });
  };

  for (const step of metaSteps(kind, totals, actions)) push({ ...step, base: steps[steps.length - 1].key, source: "meta" });
  // La base de los leads: el ultimo paso de Meta con dato.
  const lastMeta = [...steps].reverse().find((s) => s.value !== null) ?? steps[0];

  const metaLeads = totals.leads ?? 0;
  const crmLeads = crm?.leadsTotal ?? 0;
  const showMetaLeads = metaLeads > 0 || kind === "leads" || kind === "sales";
  if (showMetaLeads) {
    push({
      key: "leadsMeta",
      label: "Leads Meta",
      value: totals.leads ?? 0,
      base: lastMeta.key,
      source: "meta",
      tip: "Los leads que reporta Meta (su píxel o sus formularios). Pueden no coincidir con los del CRM: Meta los atribuye con su propio criterio, y no todos llegan con sus datos.",
    });
  }
  if (crm && (crmLeads > 0 || showMetaLeads)) {
    push({
      key: "leadsCrm",
      label: "Leads CRM",
      value: crmLeads,
      base: lastMeta.key,
      source: "crm",
      tip: "Personas de tu CRM que tuvieron un toque de esto en el período (por ejemplo, un formulario o un mensaje con sus datos de anuncio). Cada persona cuenta una vez. Se compara contra el mismo paso que los Leads Meta: son dos formas de contar lo mismo.", // @plantilla-quitar(formularios)
      // @plantilla-sin(formularios): tip: "Personas de tu CRM que tuvieron un toque de esto en el período (por ejemplo, un mensaje con sus datos de anuncio). Cada persona cuenta una vez. Se compara contra el mismo paso que los Leads Meta: son dos formas de contar lo mismo.",
    });
  }

  // Desde aca, la base es el CRM: los leads del CRM si hubo, si no lo ultimo que haya.
  const crmBase = (): FunnelStepKey => (crmLeads > 0 ? "leadsCrm" : (steps.find((s) => s.key === "leadsMeta" && (s.value ?? 0) > 0)?.key ?? lastMeta.key));
  const bookings = crm?.bookings ?? 0;
  const sales = crm?.sales ?? 0;
  if (bookings > 0) {
    push({ key: "bookings", label: "Agendas", value: bookings, base: crmBase(), source: "crm", tip: "Reuniones que se agendaron en el período y se atribuyen a esto. Incluye las canceladas, no las liberadas." });
  }
  if ((totals.purchases ?? 0) > 0) {
    push({
      key: "purchasesMeta",
      label: "Compras Meta",
      value: totals.purchases,
      base: metaLeads > 0 ? "leadsMeta" : lastMeta.key,
      source: "meta",
      tip: "Las compras que reporta Meta con su píxel. No son las ventas cargadas en el sistema.", // @plantilla-quitar(ventas)
      // @plantilla-sin(ventas): tip: "Las compras que reporta Meta con su píxel.",
    });
  }
  if (sales > 0) {
    push({
      key: "sales",
      label: "Ventas",
      value: sales,
      base: bookings > 0 ? "bookings" : crmBase(),
      source: "crm",
      tip: "Ventas con fecha dentro del período que se atribuyen a esto, aunque el lead haya entrado antes. Sin canceladas ni reembolsadas.",
    });
  }
  return steps;
}

/** Lo que explica debajo del funnel por que falta algo. */
export function funnelNotes(params: { kind: FunnelKind; mixed: FunnelKind[]; steps: FunnelVizStep[]; crm: FunnelCrm | null; crmFailed: boolean }): string[] {
  const notes: string[] = [];
  if (params.mixed.length > 1) {
    notes.push(`Mezcla objetivos (${params.mixed.map((k) => FUNNEL_KIND_LABELS[k]).join(", ")}): se muestran los pasos comunes. Abrí cada AdSet para ver su funnel.`);
  }
  if (params.kind === "profile" && params.steps.find((s) => s.key === "profileVisits")?.value === null) {
    notes.push("Meta no tiene guardadas las visitas al perfil de estos días: se guardan desde que se sumaron al sincronizado.");
  }
  if (params.crmFailed) {
    notes.push("No pude leer los datos del CRM: se muestra solo lo que dice Meta.");
  } else {
    const missing = [(params.crm?.bookings ?? 0) === 0 ? "agendas" : null, (params.crm?.sales ?? 0) === 0 ? "ventas" : null].filter(Boolean); // @plantilla-quitar(ventas)
    // @plantilla-sin(ventas): const missing = [(params.crm?.bookings ?? 0) === 0 ? "agendas" : null].filter(Boolean);
    if (missing.length > 0) notes.push(`Sin ${missing.join(" ni ")} atribuidas en este período.`);
  }
  return notes;
}

/** Un porcentaje chico se lee mejor como «menos de 0,1» que como un cero o un 100 de caida. */
export function formatFunnelPercent(percent: number): string {
  if (percent > 0 && percent < 0.1) return "<0.1%";
  return `${percent.toFixed(1)}%`;
}

export function formatFunnelDrop(percent: number): string {
  if (percent > 0 && percent < 0.1) return ">99.9%";
  return `${(100 - percent).toFixed(1)}%`;
}
