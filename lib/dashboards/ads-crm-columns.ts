/**
 * Las columnas de la tabla «Meta vs CRM» (Extra L, AT4, F31; Tirón 2, B y E): que es cada una, de que grupo, en que
 * niveles aparece, como se formatea y su explicacion (el tooltip del encabezado).
 *
 * Cuatro grupos: **Información** (campaña, conjunto, estado, publicación…), **Meta** (lo que dice Meta, con subtítulos:
 * Entrega, Clics, Video, Conversiones y Calidad), **Meta vs CRM** (lo que cuentan los dos, lado a lado) y **CRM** (lo que
 * pasó después del clic). Una division por cero es «—». Todo lo de Meta sale de lo que ya se guarda: no hay llamadas nuevas.
 *
 * El catálogo no tiene duplicados: «Leads CRM», «Agendas CRM», «CAC» y «Costo por cierre» eran lo mismo que otra columna y se
 * unificaron (`REPLACED_COLUMNS` en `ads-columns.ts` lleva lo que la gente ya había elegido a su equivalente).
 *
 * Modulo puro (sin React): el selector de columnas y la tabla leen de aca.
 */

import { count, money, percent } from "./ads";
import type { CrmLevel, CrmRow } from "./ads-crm";
import { rankingLabel } from "./ads-meta-metrics";

export type ColumnGroup = "info" | "meta" | "metaVsCrm" | "crm";

export const GROUP_ORDER: ColumnGroup[] = ["info", "meta", "metaVsCrm", "crm"];

export const GROUP_LABEL: Record<ColumnGroup, string> = {
  info: "Información",
  meta: "Meta",
  metaVsCrm: "Meta vs CRM",
  crm: "CRM",
};

/** Una linea que explica de donde sale cada grupo (el tooltip del encabezado de color). */
export const GROUP_TIP: Record<ColumnGroup, string> = {
  info: "Qué es cada fila: a qué campaña y conjunto pertenece, su estado y su publicación.",
  meta: "Lo que mide Meta Ads: gasto, alcance, clics, video y lo que cuenta el píxel. No sabe qué pasó después del clic.",
  metaVsCrm: "Lo mismo contado por Meta y por tu CRM, lado a lado. Si no coinciden, el CRM es el que sabe quién llegó de verdad.",
  crm: "Lo que pasó en tu CRM con la gente que llegó de cada anuncio: leads, agendas, ventas y plata.",
};

/** Los subtítulos del grupo Meta, para encontrar rápido una columna entre tantas. */
export type MetaSubgroup = "delivery" | "clicks" | "video" | "conversions" | "quality";

export const SUBGROUP_ORDER: MetaSubgroup[] = ["delivery", "clicks", "video", "conversions", "quality"];

export const SUBGROUP_LABEL: Record<MetaSubgroup, string> = {
  delivery: "Entrega",
  clicks: "Clics",
  video: "Video",
  conversions: "Conversiones",
  quality: "Calidad",
};

/** Qué número de la tabla se puede abrir (el panel con las personas o los registros que lo forman). */
export type CellMetric = "leads_new" | "leads_total" | "bookings" | "sales";

export type ColumnKind = "money" | "count" | "percent" | "decimal" | "seconds" | "text" | "status" | "link";

export type ColumnId =
  // Información
  | "campaignName" | "adsetName" | "status" | "publication" | "objective" | "adsCount"
  // Meta · entrega
  | "spend" | "impressions" | "reach" | "frequency" | "cpm" | "cpc"
  // Meta · clics
  | "clicks" | "ctr" | "linkClicks" | "linkCtr" | "linkCpc"
  // Meta · video
  | "video3s" | "costPerVideo3s" | "hookRate" | "thruplays" | "holdRate" | "retention25" | "retention50" | "retention75" | "retention100" | "avgWatchSeconds"
  // Meta · conversiones
  | "cplMeta" | "viewContent" | "costPerViewContent" | "applications" | "costPerApplication" | "bookingsMeta" | "costPerBookingMeta"
  | "purchasesMeta" | "costPerPurchase" | "purchaseValue" | "roasMeta"
  // Meta · calidad
  | "qualityRanking" | "engagementRanking" | "conversionRanking"
  // Meta vs CRM
  | "leadsMeta" | "leadsTotal"
  // CRM
  | "leadsNew" | "cplNew" | "cplTotal" | "bookings" | "costPerBooking" | "attended" | "costPerAttended" | "leadToBooking"
  | "sales" | "revenue" | "cash" | "ufCash" | "roas" | "roasCash" | "ufRoas" | "costPerNewDeal";

export interface ColumnDef {
  id: ColumnId;
  group: ColumnGroup;
  /** Solo en el grupo Meta: el subtítulo. */
  subgroup?: MetaSubgroup;
  label: string;
  kind: ColumnKind;
  defaultVisible: boolean;
  /** En qué pestañas aparece; sin esto, en las tres. */
  levels?: CrmLevel[];
  tip: { title: string; body: string };
  /** El valor numérico de la fila, o null si no se puede calcular («—»). Las columnas de texto devuelven null. */
  value: (row: CrmRow) => number | null;
  /** Las columnas de texto, estado y enlace: lo que se muestra (null = «—»). */
  text?: (row: CrmRow) => string | null;
  /** Solo `link`: a donde lleva. */
  href?: (row: CrmRow) => string | null;
  /** Si el número es de los que se pueden abrir: qué métrica pide el panel. */
  cell?: CellMetric;
}

const AGENDAS_NOTE = " Cuenta también las agendas canceladas (existieron y costaron); «Asistidas» muestra la calidad. No cuenta las que se liberaron.";
const STATUS_LABEL: Record<string, string> = { active: "Activo", paused: "Pausado" };

/** El estado como se lee: Activo, Pausado, el de Meta tal cual, o «Sin estado» (todavía no llegó el catálogo). */
export function statusText(row: CrmRow): string {
  if (row.statusKind in STATUS_LABEL) return STATUS_LABEL[row.statusKind];
  return row.effectiveStatus ?? "Sin estado";
}

const textCol = (
  id: ColumnId,
  group: ColumnGroup,
  label: string,
  kind: ColumnKind,
  levels: CrmLevel[] | undefined,
  defaultVisible: boolean,
  tip: { title: string; body: string },
  text: (row: CrmRow) => string | null,
  extra: Partial<ColumnDef> = {},
): ColumnDef => ({ id, group, label, kind, levels, defaultVisible, tip, value: () => null, text, ...extra });

export const COLUMNS: ColumnDef[] = [
  // ── Información ───────────────────────────────────────────────────────
  textCol("status", "info", "Estado", "status", undefined, true, { title: "Estado", body: "Activo, pausado u otro, según el catálogo de Meta. Sin catálogo todavía dice «Sin estado»: el estado llega al sincronizar el catálogo." }, statusText),
  textCol("campaignName", "info", "Campaña", "text", ["adset", "ad"], false, { title: "Campaña", body: "La campaña a la que pertenece. Si el catálogo todavía no la trae, sale de los datos de métricas." }, (r) => r.campaignName),
  textCol("adsetName", "info", "Conjunto", "text", ["ad"], false, { title: "Conjunto", body: "El conjunto de anuncios al que pertenece. Si el catálogo todavía no lo trae, sale de los datos de métricas." }, (r) => r.adsetName),
  textCol("publication", "info", "Publicación", "link", ["ad"], false, { title: "Publicación", body: "Enlace al posteo que promociona el anuncio, si está en el catálogo (el vinculado con Contenido, o el de Facebook). «—» si no se conoce." }, (r) => (r.publicationUrl ? "Ver" : null), { href: (r) => r.publicationUrl }),
  textCol("objective", "info", "Objetivo", "text", ["campaign"], false, { title: "Objetivo", body: "El objetivo de la campaña en Meta (leads, ventas, tráfico…). Solo está cuando el catálogo ya se sincronizó." }, (r) => r.objective),
  {
    id: "adsCount", group: "info", label: "# anuncios", kind: "count", defaultVisible: false, levels: ["campaign", "adset"],
    tip: { title: "Cantidad de anuncios", body: "Cuántos anuncios tiene, contando los del catálogo y los que tuvieron métricas en el período." },
    value: (r) => r.adsCount,
  },

  // ── Meta · entrega ────────────────────────────────────────────────────
  { id: "spend", group: "meta", subgroup: "delivery", label: "Gasto", kind: "money", defaultVisible: true, value: (r) => r.spend, tip: { title: "Gasto", body: "Inversión total ejecutada en el período seleccionado." } },
  { id: "impressions", group: "meta", subgroup: "delivery", label: "Impr.", kind: "count", defaultVisible: true, value: (r) => r.impressions, tip: { title: "Impresiones", body: "Cantidad de veces que se mostró el anuncio. Una misma persona puede generar varias." } },
  { id: "reach", group: "meta", subgroup: "delivery", label: "Alcance", kind: "count", defaultVisible: false, value: (r) => r.reach, tip: { title: "Alcance", body: "Personas únicas que vieron el anuncio al menos una vez. No se puede sumar entre anuncios (la misma persona vería dos): en el Total se muestra solo cuando la tabla muestra todo, con el alcance único real de la cuenta." } },
  { id: "frequency", group: "meta", subgroup: "delivery", label: "Frec.", kind: "decimal", defaultVisible: false, value: (r) => r.frequency, tip: { title: "Frecuencia", body: "Veces promedio que cada persona vio el anuncio. Impresiones ÷ Alcance. En el Total, igual que el alcance: «—» salvo que se vea todo." } },
  { id: "cpm", group: "meta", subgroup: "delivery", label: "CPM", kind: "money", defaultVisible: false, value: (r) => r.cpm, tip: { title: "CPM", body: "Lo que pagás por cada 1.000 impresiones." } },
  { id: "cpc", group: "meta", subgroup: "delivery", label: "CPC", kind: "money", defaultVisible: false, value: (r) => r.cpc, tip: { title: "CPC", body: "Lo que cuesta cada clic (de cualquier tipo). Gasto ÷ Clics. El del enlace está en «Clics»." } },

  // ── Meta · clics ──────────────────────────────────────────────────────
  { id: "clicks", group: "meta", subgroup: "clicks", label: "Clics", kind: "count", defaultVisible: false, value: (r) => r.clicks, tip: { title: "Clics", body: "Total de clics en el anuncio en el período (cualquier clic: reacciones, perfil, enlace…)." } },
  { id: "ctr", group: "meta", subgroup: "clicks", label: "CTR", kind: "percent", defaultVisible: false, value: (r) => r.ctr, tip: { title: "CTR", body: "Porcentaje de quienes vieron el anuncio e hicieron cualquier clic. Clics ÷ Impresiones. El que mide interés real es el CTR del enlace." } },
  { id: "linkClicks", group: "meta", subgroup: "clicks", label: "Clics en el enlace", kind: "count", defaultVisible: false, value: (r) => r.linkClicks, tip: { title: "Clics en el enlace", body: "Clics que llevaron a la persona al destino del anuncio (la landing, el chat). Lo que Meta llama «link click»." } },
  { id: "linkCtr", group: "meta", subgroup: "clicks", label: "CTR del enlace", kind: "percent", defaultVisible: true, value: (r) => r.linkCtr, tip: { title: "CTR del enlace", body: "Clics en el enlace ÷ Impresiones. Cuántos de los que vieron el anuncio quisieron ir a donde los llevaba." } },
  { id: "linkCpc", group: "meta", subgroup: "clicks", label: "CPC del enlace", kind: "money", defaultVisible: false, value: (r) => r.linkCpc, tip: { title: "CPC del enlace", body: "Gasto ÷ Clics en el enlace. Lo que cuesta cada visita al destino." } },

  // ── Meta · video ──────────────────────────────────────────────────────
  { id: "video3s", group: "meta", subgroup: "video", label: "Reprod. 3 s", kind: "count", defaultVisible: false, value: (r) => r.video3s, tip: { title: "Reproducciones de 3 segundos", body: "Veces que se miró el video al menos 3 segundos (el evento «video_view» de Meta)." } },
  { id: "costPerVideo3s", group: "meta", subgroup: "video", label: "Costo reprod. 3 s", kind: "money", defaultVisible: false, value: (r) => r.costPerVideo3s, tip: { title: "Costo por reproducción de 3 s", body: "Gasto ÷ Reproducciones de 3 segundos." } },
  { id: "hookRate", group: "meta", subgroup: "video", label: "Hook rate", kind: "percent", defaultVisible: false, value: (r) => r.hookRate, tip: { title: "Hook rate", body: "Reproducciones de 3 s ÷ Impresiones. Qué tan bien «engancha» el comienzo del video: cuántos de los que lo vieron pasar se quedaron." } },
  { id: "thruplays", group: "meta", subgroup: "video", label: "ThruPlays", kind: "count", defaultVisible: false, value: (r) => r.thruplays, tip: { title: "ThruPlays", body: "Reproducciones de 15 segundos o del video completo si dura menos." } },
  { id: "holdRate", group: "meta", subgroup: "video", label: "Hold rate", kind: "percent", defaultVisible: false, value: (r) => r.holdRate, tip: { title: "Hold rate", body: "ThruPlays ÷ Reproducciones de 3 s. De los que empezaron a verlo, cuántos lo siguieron mirando." } },
  { id: "retention25", group: "meta", subgroup: "video", label: "Retención 25 %", kind: "percent", defaultVisible: false, value: (r) => r.retention25, tip: { title: "Retención al 25 %", body: "Reproducciones que llegaron al 25 % del video ÷ Reproducciones de 3 s." } },
  { id: "retention50", group: "meta", subgroup: "video", label: "Retención 50 %", kind: "percent", defaultVisible: false, value: (r) => r.retention50, tip: { title: "Retención al 50 %", body: "Reproducciones que llegaron a la mitad del video ÷ Reproducciones de 3 s." } },
  { id: "retention75", group: "meta", subgroup: "video", label: "Retención 75 %", kind: "percent", defaultVisible: false, value: (r) => r.retention75, tip: { title: "Retención al 75 %", body: "Reproducciones que llegaron al 75 % del video ÷ Reproducciones de 3 s." } },
  { id: "retention100", group: "meta", subgroup: "video", label: "Retención 100 %", kind: "percent", defaultVisible: false, value: (r) => r.retention100, tip: { title: "Retención al 100 %", body: "Reproducciones que llegaron al final del video ÷ Reproducciones de 3 s." } },
  { id: "avgWatchSeconds", group: "meta", subgroup: "video", label: "Tiempo visto", kind: "seconds", defaultVisible: false, value: (r) => r.avgWatchSeconds, tip: { title: "Tiempo promedio visto", body: "Segundos promedio de reproducción, pesando cada día por sus reproducciones (un día con dos vistas no pesa como uno con dos mil). Meta lo informa en pocas filas." } },

  // ── Meta · conversiones (lo que cuenta el píxel) ──────────────────────
  { id: "cplMeta", group: "meta", subgroup: "conversions", label: "CPL Meta", kind: "money", defaultVisible: false, value: (r) => r.cplMeta, tip: { title: "CPL con los leads de Meta", body: "Gasto ÷ leads que cuenta Meta. El costo por lead con la gente que llegó a tu CRM son «CPL nuevo» y «CPL total»." } },
  { id: "viewContent", group: "meta", subgroup: "conversions", label: "Vistas de contenido", kind: "count", defaultVisible: false, value: (r) => r.viewContent, tip: { title: "Vistas de contenido", body: "El evento «view content» del píxel: cuántas veces alguien vio una página o producto. «—» si tu píxel no lo manda." } },
  { id: "costPerViewContent", group: "meta", subgroup: "conversions", label: "Costo vista de contenido", kind: "money", defaultVisible: false, value: (r) => r.costPerViewContent, tip: { title: "Costo por vista de contenido", body: "Gasto ÷ Vistas de contenido." } },
  { id: "applications", group: "meta", subgroup: "conversions", label: "Aplicaciones", kind: "count", defaultVisible: false, value: (r) => r.applications, tip: { title: "Aplicaciones", body: "El evento «submit application» del píxel: solicitudes enviadas. «—» si tu píxel no lo manda." } },
  { id: "costPerApplication", group: "meta", subgroup: "conversions", label: "Costo aplicación", kind: "money", defaultVisible: false, value: (r) => r.costPerApplication, tip: { title: "Costo por aplicación", body: "Gasto ÷ Aplicaciones." } },
  { id: "bookingsMeta", group: "meta", subgroup: "conversions", label: "Agendas Meta", kind: "count", defaultVisible: false, value: (r) => r.bookingsMeta, tip: { title: "Agendas según Meta", body: "Agendas que Meta registra (el evento «schedule» del píxel). Si Meta no manda ese evento, se muestra «—». Para compararlas con las del CRM mirá «Agendas»." } },
  { id: "costPerBookingMeta", group: "meta", subgroup: "conversions", label: "Costo agenda Meta", kind: "money", defaultVisible: false, value: (r) => r.costPerBookingMeta, tip: { title: "Costo por agenda según Meta", body: "Gasto ÷ Agendas Meta." } },
  { id: "purchasesMeta", group: "meta", subgroup: "conversions", label: "Compras Meta", kind: "count", defaultVisible: false, value: (r) => r.purchases, tip: { title: "Compras según Meta", body: "Compras que Meta registra con el píxel o la API de conversiones. «—» si no manda ese evento." } },
  { id: "costPerPurchase", group: "meta", subgroup: "conversions", label: "Costo compra", kind: "money", defaultVisible: false, value: (r) => r.costPerPurchase, tip: { title: "Costo por compra", body: "Gasto ÷ Compras Meta." } },
  { id: "purchaseValue", group: "meta", subgroup: "conversions", label: "Valor de compras", kind: "money", defaultVisible: false, value: (r) => r.purchaseValue, tip: { title: "Valor de compras", body: "Suma del valor de las compras que registra Meta." } },
  { id: "roasMeta", group: "meta", subgroup: "conversions", label: "ROAS Meta", kind: "decimal", defaultVisible: false, value: (r) => r.roasMeta, tip: { title: "ROAS según Meta", body: "Valor de compras ÷ Gasto, con lo que registra Meta. El ROAS del CRM («ROAS») usa tus ventas reales." } },

  // ── Meta · calidad (solo anuncios) ────────────────────────────────────
  textCol("qualityRanking", "meta", "Ranking de calidad", "text", ["ad"], false, { title: "Ranking de calidad", body: "Cómo se percibe la calidad del anuncio frente a otros que compiten por la misma audiencia. Es el del último día con dato y no se suma." }, (r) => rankingLabel(r.qualityRanking), { subgroup: "quality" }),
  textCol("engagementRanking", "meta", "Ranking de interacción", "text", ["ad"], false, { title: "Ranking de interacción", body: "Cómo se compara la interacción esperada del anuncio con otros de la misma audiencia. Último día con dato; no se suma." }, (r) => rankingLabel(r.engagementRanking), { subgroup: "quality" }),
  textCol("conversionRanking", "meta", "Ranking de conversión", "text", ["ad"], false, { title: "Ranking de conversión", body: "Cómo se compara la tasa de conversión esperada del anuncio con otros del mismo objetivo. Último día con dato; no se suma." }, (r) => rankingLabel(r.conversionRanking), { subgroup: "quality" }),

  // ── Meta vs CRM ───────────────────────────────────────────────────────
  { id: "leadsMeta", group: "metaVsCrm", label: "Leads Meta", kind: "count", defaultVisible: true, value: (r) => r.leadsMeta, tip: { title: "Leads según Meta", body: "Leads que cuenta Meta (formulario nativo o evento de lead): un nombre por evento, sin repetir las variantes con que Meta informa el mismo lead." } },
  { id: "leadsTotal", group: "metaVsCrm", label: "Leads totales", kind: "count", defaultVisible: true, cell: "leads_total", value: (r) => r.leadsTotal, tip: { title: "Leads totales", body: "Personas con algún toque de este anuncio en el período, aunque no sea el primero. Una persona que tocó dos anuncios cuenta en cada uno; en el Total se cuenta una sola vez. Puede ser mayor que el de Meta: cuenta a quien llegó por un mensaje, una agenda o un formulario." } },

  // ── CRM ───────────────────────────────────────────────────────────────
  { id: "leadsNew", group: "crm", label: "Leads nuevos", kind: "count", defaultVisible: true, cell: "leads_new", value: (r) => r.leadsNew, tip: { title: "Leads nuevos", body: "Personas cuyo PRIMER contacto con vos fue este anuncio, creadas en el período. Una persona cuenta una sola vez en toda su vida, así que el Total es exactamente la suma de las filas." } },
  { id: "cplNew", group: "crm", label: "CPL nuevo", kind: "money", defaultVisible: true, value: (r) => r.cplNew, tip: { title: "CPL nuevo", body: "Gasto ÷ Leads nuevos. Cuánto cuesta ganar una persona que no te conocía. «—» si no hay leads nuevos. Se diferencia del CPL total en que no cuenta a quien ya había llegado antes por otro lado." } },
  { id: "cplTotal", group: "crm", label: "CPL total", kind: "money", defaultVisible: true, value: (r) => r.cplTotal, tip: { title: "CPL total", body: "Gasto ÷ Leads totales. Cuenta también a quien ya había llegado antes y volvió a tocar el anuncio, por eso es menor que el CPL nuevo. «—» si no hay leads." } },
  { id: "bookings", group: "crm", label: "Agendas", kind: "count", defaultVisible: true, cell: "bookings", value: (r) => r.bookings, tip: { title: "Agendas", body: `Agendas creadas en el período cuyo toque es de este anuncio. Si la agenda no trae un toque con anuncio (manual, del agente o sin parámetros), se atribuye al último toque con anuncio del contacto anterior a la agenda.${AGENDAS_NOTE}` } },
  { id: "costPerBooking", group: "crm", label: "Costo por agenda", kind: "money", defaultVisible: true, value: (r) => r.costPerBooking, tip: { title: "Costo por agenda", body: "Gasto ÷ Agendas. «—» si no hay agendas." } },
  { id: "attended", group: "crm", label: "Asistidas", kind: "count", defaultVisible: false, value: (r) => r.attended, tip: { title: "Agendas asistidas", body: "De las agendas de arriba, las que llegaron a un resultado (seguimiento tibio o frío, venta o no calificado). Mide la calidad." } },
  { id: "costPerAttended", group: "crm", label: "Costo por asistida", kind: "money", defaultVisible: false, value: (r) => r.costPerAttended, tip: { title: "Costo por agenda asistida", body: "Gasto ÷ Agendas asistidas. «—» si ninguna llegó a un resultado." } },
  { id: "leadToBooking", group: "crm", label: "Lead → Agenda", kind: "percent", defaultVisible: false, value: (r) => r.leadToBooking, tip: { title: "Lead → Agenda", body: "Personas con agenda ÷ Leads totales. Cuántos de los que llegaron terminaron agendando. En el Total usa personas distintas en los dos lados." } },
  { id: "sales", group: "crm", label: "Ventas", kind: "count", defaultVisible: true, cell: "sales", value: (r) => r.sales, tip: { title: "Ventas", body: "Ventas no canceladas ni reembolsadas, con fecha de cierre en el período, cuyo toque de atribución es de este anuncio." } },
  { id: "revenue", group: "crm", label: "Revenue", kind: "money", defaultVisible: true, value: (r) => r.revenue, tip: { title: "Revenue", body: "Suma del total de esas ventas, en USD." } },
  { id: "cash", group: "crm", label: "Cash", kind: "money", defaultVisible: false, value: (r) => r.cash, tip: { title: "Cash", body: "Pagos cobrados en el período (menos reembolsos) de ventas de este anuncio, en USD." } },
  { id: "ufCash", group: "crm", label: "UF cash", kind: "money", defaultVisible: false, value: (r) => r.ufCash, tip: { title: "UF cash", body: "Cash del primer pago: el primer pago cobrado de cada venta de este anuncio, si se cobró en el período, en USD. Mide cuánta plata entra de entrada." } },
  { id: "roas", group: "crm", label: "ROAS", kind: "decimal", defaultVisible: true, value: (r) => r.roas, tip: { title: "ROAS", body: "Revenue ÷ Gasto. Cuántos dólares de venta por cada dólar invertido. «—» si no hubo gasto." } },
  { id: "roasCash", group: "crm", label: "ROAS cash", kind: "decimal", defaultVisible: false, value: (r) => r.roasCash, tip: { title: "ROAS cash", body: "Cash ÷ Gasto. Lo mismo, pero con la plata que ya entró." } },
  { id: "ufRoas", group: "crm", label: "UF ROAS", kind: "decimal", defaultVisible: false, value: (r) => r.ufRoas, tip: { title: "UF ROAS", body: "UF cash ÷ Gasto. Cuánto volvió de entrada, con el primer pago de cada venta, por cada dólar invertido." } },
  { id: "costPerNewDeal", group: "crm", label: "Costo por nuevo deal", kind: "money", defaultVisible: false, value: (r) => r.costPerNewDeal, tip: { title: "Costo por nuevo deal", body: "Gasto ÷ Ventas (no canceladas ni reembolsadas). Lo que cuesta cada venta nueva. Reemplaza a «CAC» y «Costo por cierre», que eran lo mismo. «—» si no hubo ventas." } },
];

export const COLUMN_BY_ID: Record<ColumnId, ColumnDef> = Object.fromEntries(COLUMNS.map((c) => [c.id, c])) as Record<ColumnId, ColumnDef>;

export const ALL_COLUMN_IDS: ColumnId[] = COLUMNS.map((c) => c.id);

/** ¿La columna aparece en esta pestaña? */
export const columnAppliesTo = (def: ColumnDef, level: CrmLevel): boolean => !def.levels || def.levels.includes(level);

/** Las columnas de un grupo, en su orden por defecto. */
export const columnsOfGroup = (group: ColumnGroup): ColumnDef[] => COLUMNS.filter((c) => c.group === group);

/** Una celda, formateada. «—» cuando no se puede calcular. */
export function formatCell(def: ColumnDef, row: CrmRow, currency: string | null): string {
  if (def.kind === "text" || def.kind === "status" || def.kind === "link") return def.text?.(row) ?? "—";
  const value = def.value(row);
  if (value === null) return "—";
  switch (def.kind) {
    case "money":
      return money(value, currency, { narrow: true });
    case "percent":
      return percent(value);
    case "decimal":
      return value.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "seconds":
      return `${value.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
    default:
      return count(value);
  }
}

/** Una celda para el CSV: el numero tal cual (punto decimal, sin simbolo) o el texto, y vacio si no se puede calcular. */
export function csvCell(def: ColumnDef, row: CrmRow): string {
  if (def.kind === "text" || def.kind === "status" || def.kind === "link") {
    // Un enlace se exporta como la direccion, no como «Ver».
    if (def.kind === "link") return def.href?.(row) ?? "";
    return def.text?.(row) ?? "";
  }
  const value = def.value(row);
  return value === null ? "" : String(value);
}
