"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import type { CrmLevel, DistinctLeads } from "@/lib/dashboards/ads-crm";
import { PAGE_SIZE, isCellMetric, isCivilDate, mapDetailRows, type DetailPage, type DetailRpcRow } from "@/lib/dashboards/ads-crm-detail";

/**
 * Lo que la tabla «Meta vs CRM» pide DESPUÉS de cargarse (Tirón 2, B2–B3): el detalle de una celda y las personas distintas
 * de los objetos que se ven. Con la sesión de QUIEN MIRA: las funciones son SECURITY INVOKER y la RLS decide qué contactos,
 * agendas y ventas cuenta cada persona. El workspace sale de la sesión, nunca del pedido. Se piden solo al abrir el panel o
 * al filtrar por estado: nunca por adelantado.
 *
 * Todo lo exportado es una función asincrónica (regla de los archivos "use server").
 */

const LEVELS: readonly CrmLevel[] = ["campaign", "adset", "ad"];
const MAX_OBJECT_IDS = 500;
const GENERIC_ERROR = "No pude leer el detalle. Probá de nuevo en un rato.";

export type CellDetailResult = { ok: true; page: DetailPage } | { ok: false; error: string };
export type DistinctResult = { ok: true; distinct: DistinctLeads } | { ok: false; error: string };

interface Range {
  level: CrmLevel;
  since: string;
  until: string;
  adAccountId: string;
  /** Una lista de objetos (los que se ven con un filtro de estado). Null = todos los de la cuenta. */
  objectIds: string[] | null;
}

function validRange(input: unknown): Range | null {
  const r = input as Partial<Range> | null;
  if (!r || !LEVELS.includes(r.level as CrmLevel) || !isCivilDate(r.since) || !isCivilDate(r.until) || r.until < r.since) return null;
  if (typeof r.adAccountId !== "string" || !r.adAccountId.trim() || r.adAccountId.length > 64) return null;
  let objectIds: string[] | null = null;
  if (r.objectIds !== null && r.objectIds !== undefined) {
    if (!Array.isArray(r.objectIds) || r.objectIds.length > MAX_OBJECT_IDS || !r.objectIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 64)) return null;
    objectIds = r.objectIds;
  }
  return { level: r.level as CrmLevel, since: r.since, until: r.until, adAccountId: r.adAccountId, objectIds };
}

/** Las personas o registros que forman el número de UNA celda (un objeto, o el total de lo que se ve), de a 50. */
export async function loadCrmCellDetail(input: Range & { metric: string; objectId: string | null; offset: number }): Promise<CellDetailResult> {
  const range = validRange(input);
  if (!range || !isCellMetric(input.metric)) return { ok: false, error: "El pedido no es válido." };
  const ctx = await getPermissionAction("dashboards.ads.view");
  if (!ctx) return { ok: false, error: "No tenés permiso para ver este dashboard." };

  const offset = Number.isInteger(input.offset) && input.offset > 0 ? input.offset : 0;
  const objectId = typeof input.objectId === "string" && input.objectId.length > 0 && input.objectId.length <= 64 ? input.objectId : null;

  try {
    const { data, error } = await ctx.supabase.rpc("ads_crm_cell_detail", {
      p_level: range.level,
      p_metric: input.metric,
      p_since: range.since,
      p_until: range.until,
      p_ad_account_id: range.adAccountId,
      p_workspace_id: ctx.workspace.id,
      p_object_id: objectId,
      p_object_ids: objectId ? null : range.objectIds,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });
    if (error) {
      console.error("[ads] no pude leer el detalle de una celda:", error.message);
      return { ok: false, error: GENERIC_ERROR };
    }
    return { ok: true, page: mapDetailRows(data as unknown as DetailRpcRow[]) };
  } catch (err) {
    console.error("[ads] no pude leer el detalle de una celda:", err instanceof Error ? err.message : err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

/** Las personas DISTINTAS de los objetos que se ven (cuando la tabla está filtrada por estado y el total de la cuenta ya no sirve). */
export async function loadCrmDistinctTotals(input: Range): Promise<DistinctResult> {
  const range = validRange(input);
  if (!range) return { ok: false, error: "El pedido no es válido." };
  const ctx = await getPermissionAction("dashboards.ads.view");
  if (!ctx) return { ok: false, error: "No tenés permiso para ver este dashboard." };

  try {
    const { data, error } = await ctx.supabase.rpc("ads_crm_metrics_v2", {
      p_level: range.level,
      p_since: range.since,
      p_until: range.until,
      p_ad_account_id: range.adAccountId,
      p_workspace_id: ctx.workspace.id,
      p_object_ids: range.objectIds,
    });
    if (error) {
      console.error("[ads] no pude calcular las personas distintas:", error.message);
      return { ok: false, error: GENERIC_ERROR };
    }
    const total = ((data ?? []) as Array<{ is_total?: boolean; leads_total: number | null; leads_with_booking: number | null }>).find((r) => r.is_total);
    return { ok: true, distinct: { leadsTotal: Number(total?.leads_total ?? 0), leadsWithBooking: Number(total?.leads_with_booking ?? 0) } };
  } catch (err) {
    console.error("[ads] no pude calcular las personas distintas:", err instanceof Error ? err.message : err);
    return { ok: false, error: GENERIC_ERROR };
  }
}
