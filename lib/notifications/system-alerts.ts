/**
 * Fallos del sistema (25/11/2026, traído de RER): avisos SOLO para Owner y Admin, con campana, email y Slack
 * encendidos por defecto (evento `system_failures` de `preferences.ts`). Detalle en docs/fallos-del-sistema.md.
 *
 * Reglas:
 * - **Nunca lanza.** Un aviso que falla no puede tumbar lo que lo detectó (un job, un envío, un webhook).
 * - **Va sin `recipient_id`**: lo entregan a Owner y Admin `deliveryRecipients` y la campana; `can_see_notification`
 *   (00051) se lo oculta a un Member porque `entity_type` es `system`.
 * - **Solo al momento**: avisa una vez cuando algo se rompe. Si en los últimos 7 días ya hubo un aviso del mismo tipo
 *   y la misma clave, **leído o no**, no crea otro (a diferencia de `createNotificationOnce`, que solo mira los no
 *   leídos y por eso recordaría). Quien llama y tiene un estado (las conexiones personales) además avisa solo en la
 *   transición.
 * - **Sin datos sensibles**: el detalle pasa por `sanitizeRunText` (emails, teléfonos, tokens y parámetros de URL
 *   fuera) y se recorta. Nunca el payload de un job ni una clave.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { sanitizeRunText } from "@/lib/flow-engine/run-log";
import { createNotification } from "./create";
import { stableAlertUuid } from "./integration-alerts";
import type { NotificationType, SystemArea } from "./types";

type Db = SupabaseClient<Database>;

/** Los tipos que pasan por acá (todos los del evento `system_failures`). */
export type SystemFailureType = Extract<
  NotificationType,
  | "system_job_failed"
  | "meta_ads_sync_failed"
  | "meta_capi_failed"
  | "slack_connection_error"
  | "email_provider_error"
  | "zernio_key_error"
  | "google_business_token_error"
  | "render_not_configured"
  | "team_connection_lost"
>;

/** Cuánto tiempo no se repite el mismo aviso aunque se haya leído. */
export const SYSTEM_ALERT_QUIET_DAYS = 7;
const MAX_TEXT = 400;

export interface SystemFailureInput {
  supabase: unknown;
  workspaceId: string | null | undefined;
  type: SystemFailureType;
  /** Qué cosa falló, estable entre fallos iguales («job:svc_daily», «meta-ads:<cuenta>», «slack»). */
  key: string;
  title: string;
  /** Qué pasó y qué hacer. Se limpia antes de guardar. */
  body: string;
  /** Pantalla donde se arregla (la usa `linkFor`). */
  area: SystemArea;
  /** Datos sin datos personales que ayudan a entender el aviso. */
  metadata?: Record<string, unknown>;
  now?: Date;
}

export function systemAlertEntityId(type: SystemFailureType, key: string): string {
  return stableAlertUuid(`system:${type}:${key}`);
}

/** Limpia el detalle: sin emails, teléfonos, tokens ni parámetros de URL, y con tope de largo. */
export function cleanSystemAlertText(value: string): string {
  const clean = sanitizeRunText(value) ?? "";
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 1)}…` : clean;
}

/** Deja el aviso si no hubo uno igual en los últimos 7 días. Devuelve si lo creó. Nunca lanza. */
export async function notifySystemFailure(input: SystemFailureInput): Promise<boolean> {
  if (!input.workspaceId) return false;
  try {
    const supabase = input.supabase as Db;
    const entityId = systemAlertEntityId(input.type, input.key);
    const now = input.now ?? new Date();
    const since = new Date(now.getTime() - SYSTEM_ALERT_QUIET_DAYS * 24 * 3600_000).toISOString();

    const { data, error } = await supabase
      .from("notifications")
      .select("id")
      .eq("workspace_id", input.workspaceId)
      .eq("type", input.type)
      .eq("entity_id", entityId)
      .gte("created_at", since)
      .limit(1);
    // Si no se puede comprobar, se crea igual: un aviso repetido molesta menos que uno que falta.
    if (!error && data && data.length > 0) return false;

    return await createNotification({
      supabase,
      workspaceId: input.workspaceId,
      type: input.type,
      title: cleanSystemAlertText(input.title),
      body: cleanSystemAlertText(input.body),
      entityType: "system",
      entityId,
      metadata: { ...(input.metadata ?? {}), area: input.area, key: input.key },
    });
  } catch (err) {
    console.error(`[aviso:${input.type}] no pude dejar el aviso:`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** El nombre de una persona del equipo, para un aviso. Nunca el email. Sin dato, «alguien del equipo». */
async function memberName(supabase: Db, workspaceId: string, userId: string): Promise<string> {
  try {
    const { data } = await supabase.rpc("workspace_member_profiles", { p_workspace_id: workspaceId });
    const row = ((data ?? []) as Array<{ user_id: string; full_name?: string | null; meta_name?: string | null }>).find(
      (m) => m.user_id === userId,
    );
    return row?.full_name?.trim() || row?.meta_name?.trim() || "alguien del equipo";
  } catch {
    return "alguien del equipo";
  }
}

/**
 * A una persona del equipo se le cortó una conexión propia (su Google Calendar o su Fathom). El aviso a la persona ya
 * existe; esto deja una copia para Owner y Admin, para que alguien se asegure de que la reconecte. Quien llama lo
 * manda solo en la transición (de conectada a cortada). Nunca lanza.
 */
export async function notifyTeamConnectionLost(input: {
  supabase: unknown;
  workspaceId: string;
  userId: string | null;
  provider: "google_calendar" | "fathom";
  connectionId: string;
}): Promise<boolean> {
  if (!input.userId) return false;
  const label = input.provider === "google_calendar" ? "Google Calendar" : "Fathom";
  const name = await memberName(input.supabase as Db, input.workspaceId, input.userId);
  const consequence =
    input.provider === "google_calendar"
      ? "Sus eventos no ofrecen horarios y sus reuniones no se pasan al calendario hasta que lo reconecte."
      : "Sus grabaciones no entran hasta que lo reconecte (no se pierden: se traen al reconectar).";
  return notifySystemFailure({
    supabase: input.supabase,
    workspaceId: input.workspaceId,
    type: "team_connection_lost",
    key: `${input.provider}:${input.connectionId}`,
    title: `Se cortó el ${label} de ${name}`,
    body: `${consequence} Ya se le avisó; pedile que lo reconecte desde Mi cuenta.`,
    area: "team",
    metadata: { provider: input.provider, user_id: input.userId },
  });
}
