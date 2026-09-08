/**
 * Escritura en el audit log (tabla audit_log, migracion 00023).
 *
 * Que se registra: quien cambio que, cuando, y de que valor a que valor.
 * La ficha del contacto lo muestra como "Historial de cambios" y es la unica
 * forma de reconstruir por que un lead termino asignado a alguien.
 *
 * Dos decisiones a tener presentes:
 *
 * 1. Fallar al auditar NO hace fallar la operacion. Si el contacto se guardo
 *    pero el registro no, el usuario no tiene por que ver un error ni perder
 *    su edicion: se loguea en el servidor y sigue. El audit log es evidencia,
 *    no una precondicion.
 * 2. La RLS exige performed_by = auth.uid(), asi que un usuario no puede
 *    escribir entradas a nombre de otro. Los procesos del sistema (webhooks,
 *    crons) escriben con la service key, que saltea RLS, y ahi performed_by
 *    queda en null.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditAction, AuditEntityType, Json } from "@/lib/types/database";

export interface AuditChange {
  old: Json;
  new: Json;
}

export type AuditChanges = Record<string, AuditChange>;

export async function logAudit({
  supabase,
  workspaceId,
  entityType,
  entityId,
  action,
  changes,
  metadata,
  performedBy = null,
}: {
  supabase: SupabaseClient;
  workspaceId: string;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  changes?: AuditChanges | null;
  metadata?: Record<string, Json> | null;
  /** null = lo hizo el sistema. */
  performedBy?: string | null;
}): Promise<void> {
  const { error } = await supabase.from("audit_log").insert({
    workspace_id: workspaceId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    changes: (changes ?? null) as Json,
    metadata: (metadata ?? null) as Json,
    performed_by: performedBy,
  });

  if (error) {
    console.error(`[audit] no pude registrar ${action} en ${entityType}:`, error.message);
  }
}

/**
 * Arma el { campo: { old, new } } de un update, quedandose solo con lo que
 * cambio de verdad. Sin esto el historial se llena de entradas que dicen que
 * alguien apreto "Guardar" sin tocar nada.
 *
 * null y "" cuentan como lo mismo: un input vacio y un campo sin cargar son el
 * mismo estado para quien lee el historial.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AuditChanges | null {
  const changes: AuditChanges = {};

  for (const [key, nextRaw] of Object.entries(after)) {
    const prev = normalize(before[key]);
    const next = normalize(nextRaw);
    if (prev === next) continue;
    changes[key] = { old: prev, new: next };
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

function normalize(value: unknown): Json {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return String(value);
}
