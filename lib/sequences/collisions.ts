import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SequenceEnrollmentStatus } from "@/lib/types/database";

/**
 * Deteccion de colision de secuencias (F13).
 *
 * Una colision es que un contacto quede en mas de una secuencia viva por el
 * mismo canal: dos seguimientos automaticos escribiendole en paralelo, cada uno
 * con su cronograma, sin saber del otro.
 *
 * No lleva tabla: es una consulta sobre sequence_enrollments. Lo unico que se
 * persiste es que se detecto y que alguien ya decidio que hacer, y eso es una
 * propiedad de la inscripcion en el momento en que se creo.
 *
 * Vive fuera de lib/actions/ y de lib/flow-engine/ a proposito: lo llaman el
 * nodo del flow (con service client, sin usuario) y las Server Actions (con el
 * cliente del usuario y RLS). Solo usa selects con filtros explicitos, asi que
 * funciona igual con los dos.
 */

type Db = SupabaseClient<Database>;

/**
 * Motivos de pausa que todavia pueden volver a arrancar.
 *
 * Son el "por activarse" del requerimiento: una inscripcion pausada porque el
 * contacto respondio sigue siendo una secuencia que le va a escribir en cuanto
 * un admin la reanude, asi que colisiona igual. La de opt-out no: esa no se
 * reanuda nunca.
 */
export const RESUMABLE_PAUSE_REASONS = [
  "contact_replied",
  "sequence_paused",
  "no_conversation",
  "collision",
] as const;

export interface LiveEnrollment {
  id: string;
  sequenceId: string;
  sequenceName: string;
  status: SequenceEnrollmentStatus;
  pausedReason: string | null;
  enrolledAt: string;
}

export interface CollisionSnapshotEntry {
  enrollment_id: string;
  sequence_id: string;
  sequence_name: string;
}

export interface CollisionReport {
  hasCollision: boolean;
  colliding: LiveEnrollment[];
  /** Lo que se guarda tal cual en sequence_enrollments.collision_with. */
  snapshot: CollisionSnapshotEntry[];
}

/**
 * Cuenta como colision esta inscripcion?
 *
 * Pura, para poder fijar la regla sin base: es la decision que define si el
 * aviso aparece o no, y equivocarla en cualquiera de los dos sentidos molesta
 * (avisar de una secuencia que ya termino, o callarse una que va a arrancar).
 */
export function isLiveEnrollment(row: {
  status: string;
  paused_reason?: string | null;
}): boolean {
  if (row.status === "active") return true;
  if (row.status !== "paused") return false;
  return (RESUMABLE_PAUSE_REASONS as readonly string[]).includes(row.paused_reason ?? "");
}

export async function detectSequenceCollision(
  supabase: Db,
  params: {
    workspaceId: string;
    contactId: string;
    channelId: string;
    /** La secuencia que se esta por inscribir; no colisiona consigo misma. */
    excludeSequenceId?: string;
    /** Una inscripcion puntual a ignorar, al revisar una ya creada. */
    excludeEnrollmentId?: string;
  }
): Promise<CollisionReport> {
  const empty: CollisionReport = { hasCollision: false, colliding: [], snapshot: [] };

  let query = supabase
    .from("sequence_enrollments")
    .select("id, sequence_id, status, paused_reason, enrolled_at, sequences!inner(workspace_id, name)")
    .eq("contact_id", params.contactId)
    .eq("channel_id", params.channelId)
    .eq("sequences.workspace_id", params.workspaceId)
    .in("status", ["active", "paused"]);

  if (params.excludeSequenceId) query = query.neq("sequence_id", params.excludeSequenceId);
  if (params.excludeEnrollmentId) query = query.neq("id", params.excludeEnrollmentId);

  const { data, error } = await query;

  if (error) {
    // Sin deteccion no se bloquea nada: es un aviso, no una precondicion.
    console.error("[sequences] no pude revisar colisiones:", error.message);
    return empty;
  }

  const colliding: LiveEnrollment[] = [];

  for (const row of data ?? []) {
    if (!isLiveEnrollment(row)) continue;
    const sequence = row.sequences as unknown as { name: string } | null;
    colliding.push({
      id: row.id,
      sequenceId: row.sequence_id,
      sequenceName: sequence?.name ?? "Secuencia sin nombre",
      status: row.status as SequenceEnrollmentStatus,
      pausedReason: row.paused_reason,
      enrolledAt: row.enrolled_at,
    });
  }

  if (colliding.length === 0) return empty;

  return {
    hasCollision: true,
    colliding,
    // Snapshot y no join: el aviso tiene que seguir siendo legible despues de
    // que la otra inscripcion se cancele o la secuencia se renombre.
    snapshot: colliding.map((c) => ({
      enrollment_id: c.id,
      sequence_id: c.sequenceId,
      sequence_name: c.sequenceName,
    })),
  };
}

export interface OpenCollision {
  enrollmentId: string;
  sequenceId: string;
  sequenceName: string;
  contactId: string;
  contactName: string;
  detectedAt: string;
  with: CollisionSnapshotEntry[];
}

/**
 * Las colisiones sin resolver del workspace.
 *
 * Hoy la lee el aviso de la pantalla de secuencias. Es tambien la consulta que
 * va a consumir el centro de notificaciones del Bloque 3: se escribe una vez y
 * se reusa, sin tocar nada de esto.
 */
export async function listOpenCollisions(
  supabase: Db,
  params: { workspaceId: string; sequenceId?: string; limit?: number }
): Promise<OpenCollision[]> {
  let query = supabase
    .from("sequence_enrollments")
    .select(
      "id, sequence_id, contact_id, collision_detected_at, collision_with, sequences!inner(workspace_id, name), contacts(display_name, email)"
    )
    .eq("sequences.workspace_id", params.workspaceId)
    .not("collision_detected_at", "is", null)
    .is("collision_reviewed_at", null)
    .in("status", ["active", "paused"])
    .order("collision_detected_at", { ascending: false })
    .limit(params.limit ?? 50);

  if (params.sequenceId) query = query.eq("sequence_id", params.sequenceId);

  const { data, error } = await query;

  if (error) {
    console.error("[sequences] no pude listar las colisiones:", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    const sequence = row.sequences as unknown as { name: string } | null;
    const contact = row.contacts as unknown as {
      display_name: string | null;
      email: string | null;
    } | null;

    return {
      enrollmentId: row.id,
      sequenceId: row.sequence_id,
      sequenceName: sequence?.name ?? "Secuencia sin nombre",
      contactId: row.contact_id,
      contactName: contact?.display_name || contact?.email || "Contacto sin nombre",
      detectedAt: row.collision_detected_at as string,
      with: parseSnapshot(row.collision_with),
    };
  });
}

export function parseSnapshot(raw: unknown): CollisionSnapshotEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is CollisionSnapshotEntry =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as CollisionSnapshotEntry).sequence_id === "string"
  );
}
