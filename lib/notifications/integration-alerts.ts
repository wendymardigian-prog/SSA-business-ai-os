/**
 * Avisos de las integraciones (F15).
 *
 * Una conexion que vence, se revoca o llega a su tope no avisa sola: el dia
 * que se descubre es el dia que una publicacion falla. Esto lo adelanta.
 *
 * La regla importante es la de repeticion. Un token que vence en 7 dias
 * cumple la condicion durante 7 dias seguidos, y un cron diario mandaria 7
 * avisos iguales. Cada causa tiene su ventana: la de vencimiento es larga
 * (una vez por dia no, una vez cada tres), la de cuota es diaria porque el
 * contador se reinicia cada mes y avisar tarde no sirve.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createNotificationOnce } from "./create";

/** Por que una integracion necesita atencion. */
export type IntegrationAlertCause =
  | "expiring"
  | "revoked"
  | "missing_scope"
  | "quota";

/** Cada cuanto se puede repetir el aviso de cada causa, en minutos. */
export const ALERT_WINDOW_MINUTES: Record<IntegrationAlertCause, number> = {
  // El token vence en dias: repetirlo cada 3 dias alcanza para que no se pase.
  expiring: 3 * 24 * 60,
  // Revocado es lo mas urgente y no se arregla solo: se recuerda cada dia.
  revoked: 24 * 60,
  missing_scope: 3 * 24 * 60,
  // La cuota se reinicia cada mes; avisar una vez por dia es suficiente.
  quota: 24 * 60,
};

export interface IntegrationAlertInput {
  supabase: SupabaseClient;
  workspaceId: string;
  /** Id del catalogo ("google", "postproxy"). */
  providerId: string;
  /** Como se llama en pantalla. */
  providerLabel: string;
  cause: IntegrationAlertCause;
  /** El detalle que hace util el aviso ("vence en 3 dias"). */
  detail: string;
  /** Para probar la ventana sin esperar. */
  withinMinutes?: number;
}

/**
 * Un uuid estable para "este proveedor, por este motivo".
 *
 * `notifications.entity_id` es una columna uuid, asi que no se puede guardar
 * ahi un texto como "google:expiring". Pero la deduplicacion necesita
 * distinguir causas: si todos los avisos de integraciones compartieran el
 * mismo id (o ninguno), el aviso de que a Google le falta un permiso taparia
 * el de que Postproxy llego a su tope.
 *
 * Se deriva un uuid v5 del texto: mismo proveedor y misma causa dan siempre el
 * mismo uuid, y distinta causa da otro. No apunta a ninguna fila —las
 * integraciones sin conectar no tienen fila— y por eso `entity_type` es
 * "integration", que la campana sabe llevar a la pantalla.
 */
const ALERT_NAMESPACE = "6f1b7a1e-0f3a-4c2b-9d5e-8a7c1b2d3e4f";

export function alertEntityId(providerId: string, cause: IntegrationAlertCause): string {
  const namespace = Buffer.from(ALERT_NAMESPACE.replace(/-/g, ""), "hex");
  const hash = createHash("sha1")
    .update(Buffer.concat([namespace, Buffer.from(`${providerId}:${cause}`, "utf8")]))
    .digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20),
  ].join("-");
}

export function alertTitle(label: string, cause: IntegrationAlertCause): string {
  switch (cause) {
    case "expiring":
      return `La conexion con ${label} esta por vencer`;
    case "revoked":
      return `Se corto el acceso a ${label}`;
    case "missing_scope":
      return `A ${label} le falta un permiso`;
    case "quota":
      return `${label} esta llegando a su tope`;
  }
}

/**
 * Deja el aviso, si no hay uno igual sin leer en su ventana.
 *
 * La entidad es el proveedor y no el workspace: asi dos integraciones con el
 * mismo problema avisan las dos, y la misma no avisa dos veces.
 */
export async function notifyIntegrationAttention(
  input: IntegrationAlertInput,
): Promise<boolean> {
  return createNotificationOnce({
    supabase: input.supabase,
    workspaceId: input.workspaceId,
    type: "integration_attention",
    title: alertTitle(input.providerLabel, input.cause),
    body: input.detail,
    entityType: "integration",
    // Un uuid derivado del proveedor y la causa: "Google vence" y "Google sin
    // permiso" son dos avisos distintos y los dos tienen que llegar.
    entityId: alertEntityId(input.providerId, input.cause),
    metadata: { provider: input.providerId, cause: input.cause },
    withinMinutes: input.withinMinutes ?? ALERT_WINDOW_MINUTES[input.cause],
  });
}
