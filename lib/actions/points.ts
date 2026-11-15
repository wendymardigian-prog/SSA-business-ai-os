"use server";
// @plantilla-quitar(servicios)

import { revalidatePath } from "next/cache";
import { getAnyPermissionAction, getPermissionAction } from "@/lib/auth/guards";
import { svcRpc, type SvcResult } from "@/lib/services/db";

/**
 * Puntos del portal (F129) desde el panel. La configuración del programa se guarda con `saveProgramSettings`
 * (clave `points`, que la base pide con `portal.points` desde la 00381). Acá: el ajuste a mano de un estudiante,
 * «Calcular lo ya hecho» y las lecturas de la ficha (00380). La base vuelve a pedir el permiso con la sesión.
 */

const NOT_ALLOWED = { ok: false as const, error: { code: "SV004", message: "No tenés permiso para hacer esto", detail: null } };

/** Sumar (positivo) o restar (negativo) puntos a mano, con motivo. Devuelve el total nuevo. */
export async function adjustPoints(serviceId: string, points: number, reason: string): Promise<SvcResult<number>> {
  const ctx = await getPermissionAction("portal.points");
  if (!ctx) return NOT_ALLOWED;
  if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 10000) {
    return { ok: false, error: { code: "SV001", message: "Elegí cuántos puntos (de -10.000 a 10.000)", detail: null } };
  }
  if (!reason.trim()) return { ok: false, error: { code: "SV001", message: "Contá el motivo", detail: null } };
  const res = await svcRpc<number>(ctx.supabase, "points_adjust", { p_service_id: serviceId, p_points: points, p_reason: reason.trim() });
  if (res.ok) revalidatePath("/dashboard/clientes");
  return res;
}

export interface BackfillResult {
  /** Filas nuevas del historial (0 si ya estaba todo calculado). */
  added: number;
}

/** «Calcular lo ya hecho»: suma lo que el estudiante hizo antes de prender los puntos. Repetirlo no duplica. */
export async function backfillPoints(productId: string): Promise<SvcResult<BackfillResult>> {
  const ctx = await getPermissionAction("portal.points");
  if (!ctx) return NOT_ALLOWED;
  const res = await svcRpc<BackfillResult>(ctx.supabase, "points_backfill", { p_product_id: productId });
  if (res.ok) revalidatePath(`/dashboard/portal/${productId}`);
  return res;
}

export interface PointsDay {
  day: string;
  active: boolean;
  groups: Record<string, number>;
  negative: number;
}
export interface PointsDaily {
  enabled: boolean;
  today: string;
  timezone: string;
  days_n: number;
  total: number;
  level: { level: number; name: string; min: number; next: number | null };
  last_active: string | null;
  last_login_at: string | null;
  days: PointsDay[];
}

/** El gráfico «Actividad en el portal» de la ficha, para cambiar entre 14, 30 y 90 días sin recargar. */
export async function loadPointsDaily(serviceId: string, days: 14 | 30 | 90): Promise<SvcResult<PointsDaily | null>> {
  const ctx = await getAnyPermissionAction(["services.view", "portal.view", "portal.points"]);
  if (!ctx) return NOT_ALLOWED;
  return svcRpc<PointsDaily | null>(ctx.supabase, "svc_points_daily", { p_service_id: serviceId, p_days: days });
}
