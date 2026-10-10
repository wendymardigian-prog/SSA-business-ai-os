/**
 * El contexto que se le manda al modelo para analizar los anuncios (F61).
 *
 * Todo puro: armar el texto es lo que hay que poder probar, porque es donde
 * se decide que ve el modelo. La llamada vive en
 * `lib/actions/ads-analysis.ts`.
 *
 * El tope de objetos (10 campañas, 15 conjuntos, 15 anuncios) no es
 * arbitrario: una cuenta con cien anuncios llenaria el contexto de filas
 * irrelevantes y el modelo contestaria sobre las que entraron, no sobre las
 * que importan. Se mandan las de MAS GASTO, que son sobre las que hay algo
 * que decidir.
 */

import { computeTotals, money, percent, type AdsRow, type GroupedRow } from "@/lib/dashboards/ads";
import { groupByObject } from "@/lib/dashboards/ads";
import { aiLanguageStyle } from "@/lib/ai/language-style";
import { ADS_ANALYSIS_DEFAULT_INSTRUCTIONS, interpolate } from "@/lib/ai-tasks/instructions";

export const MAX_CAMPAIGNS = 10;
export const MAX_ADSETS = 15;
export const MAX_ADS = 15;

/**
 * El prompt de sistema del analisis, con las instrucciones que se le pasen
 * (las activas de la tarea, o el texto del sistema) y el estilo del cliente.
 *
 * Por cliente: forma de hablar de la IA (AI_LANGUAGE_STYLE,
 * lib/ai/language-style.ts).
 */
export function buildAnalysisSystemPrompt(instructions: string = ADS_ANALYSIS_DEFAULT_INSTRUCTIONS): string {
  return interpolate(instructions, { estilo: aiLanguageStyle() });
}

/** El prompt por defecto: lo que se usa mientras nadie edite las instrucciones. */
export function SYSTEM_PROMPT(): string {
  return buildAnalysisSystemPrompt();
}

export interface AnalysisContext {
  periodLabel: string;
  currency: string | null;
  rows: AdsRow[];
}

function describeGroup(rows: GroupedRow[], currency: string | null, limit: number): string {
  return rows
    .slice(0, limit)
    .map((row) => {
      const parts = [
        `gasto ${money(row.spend, currency)}`,
        `impresiones ${row.impressions ?? "sin dato"}`,
        `clics ${row.clicks ?? "sin dato"}`,
        `CTR ${percent(row.ctr)}`,
        `CPC ${money(row.cpc, currency)}`,
        `leads ${row.leads ?? "sin dato"}`,
        row.cpl === null ? "sin costo por lead" : `CPL ${money(row.cpl, currency)}`,
      ];
      return `- ${row.objectName || row.objectId} (${row.status ?? "estado desconocido"}): ${parts.join(", ")}`;
    })
    .join("\n");
}

/**
 * El contexto en texto.
 *
 * En texto y no en JSON a proposito: los modelos leen mejor una lista con
 * unidades que un objeto con claves, y aca lo que importa es que entienda
 * los numeros, no que los parsee.
 */
export function buildAnalysisContext(context: AnalysisContext): string {
  const accountRows = context.rows.filter((r) => r.level === "account");
  const totals = computeTotals(accountRows);

  const campaigns = groupByObject(context.rows, "campaign");
  const adsets = groupByObject(context.rows, "adset");
  const ads = groupByObject(context.rows, "ad");

  const sections = [
    `PERIODO: ${context.periodLabel}`,
    "",
    "TOTALES DE LA CUENTA:",
    `- Gasto: ${money(totals.spend, context.currency)}`,
    `- Impresiones: ${totals.impressions ?? "sin dato"}`,
    `- Alcance: ${totals.reach ?? "sin dato"}`,
    `- Frecuencia: ${totals.frequency?.toFixed(2) ?? "sin dato"}`,
    `- Clics: ${totals.clicks ?? "sin dato"} (CTR ${percent(totals.ctr)})`,
    `- CPM: ${money(totals.cpm, context.currency)}`,
    `- CPC: ${money(totals.cpc, context.currency)}`,
    `- Leads: ${totals.leads ?? "sin dato"}${totals.cpl === null ? " (sin costo por lead)" : ` (CPL ${money(totals.cpl, context.currency)})`}`,
  ];

  if (campaigns.length > 0) {
    sections.push(
      "",
      `CAMPAÑAS (las ${Math.min(campaigns.length, MAX_CAMPAIGNS)} de mas gasto, de ${campaigns.length}):`,
      describeGroup(campaigns, context.currency, MAX_CAMPAIGNS),
    );
  }

  if (adsets.length > 0) {
    sections.push(
      "",
      `CONJUNTOS (los ${Math.min(adsets.length, MAX_ADSETS)} de mas gasto, de ${adsets.length}):`,
      describeGroup(adsets, context.currency, MAX_ADSETS),
    );
  }

  if (ads.length > 0) {
    sections.push(
      "",
      `ANUNCIOS (los ${Math.min(ads.length, MAX_ADS)} de mas gasto, de ${ads.length}):`,
      describeGroup(ads, context.currency, MAX_ADS),
    );
  }

  if (campaigns.length === 0 && ads.length === 0) {
    sections.push("", "No hay campañas ni anuncios con datos en este periodo.");
  }

  return sections.join("\n");
}

/** Si hay algo que analizar. Sin gasto, el modelo no tiene nada que decir. */
export function hasSomethingToAnalyze(rows: AdsRow[]): boolean {
  return rows.some((row) => (row.spend ?? 0) > 0);
}
