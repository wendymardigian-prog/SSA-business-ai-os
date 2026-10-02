/**
 * Como se muestra una entrada de `audit_log` en la pestaña Actividad (G5).
 *
 * `saveIntegration`/`disconnectIntegration` (lib/actions/integrations.ts) son
 * las unicas dos acciones que hoy auditan una integracion, siempre con
 * `entity_type: "channel"` y `metadata.provider`. Conectar por OAuth, renovar
 * un token y los errores de renovacion NO se auditan todavia (tocarlo es
 * tocar el flujo de OAuth, fuera de este bloque): por eso la pestaña tambien
 * muestra el estado actual de la conexion, no solo lo que hay en la tabla.
 */

import type { AuditAction } from "@/lib/types/database";

export function activityActionLabel(action: AuditAction): string {
  switch (action) {
    case "create":
      return "Se conecto";
    case "update":
      return "Se actualizaron las credenciales";
    case "delete":
      return "Se desconecto";
    default:
      return action;
  }
}
