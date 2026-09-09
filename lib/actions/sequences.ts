"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import { getAdminContext } from "@/lib/auth/guards";
import { logAudit, diffFields } from "@/lib/audit";
import {
  canActivate,
  validateSequenceName,
  validateSequenceSteps,
} from "@/lib/sequences/validate";
import type {
  SequenceStatus,
  SequenceStep,
  SequenceEnrollmentStatus,
} from "@/lib/types/database";

/**
 * Mutaciones de secuencias.
 *
 * Tres cosas que antes no estaban y son parte de F9:
 *   1. Crear, editar y borrar es de Owner/Admin. La barrera real es la RLS de
 *      la migracion 00041; esto evita el viaje a la base y da un mensaje claro.
 *   2. Los pasos se validan aca, no solo en el editor.
 *   3. Todo deja su entrada en el audit log. Si el registro falla, la operacion
 *      no falla: el historial es evidencia, no una precondicion.
 */

const LIST_PATH = "/dashboard/sequences";

export type SequenceActionResult =
  | { ok: true; sequenceId?: string }
  | { ok: false; error: string };

function detailPath(sequenceId: string) {
  return `${LIST_PATH}/${sequenceId}`;
}

export async function createSequence(name: string): Promise<SequenceActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden crear secuencias" };
  const { workspace, supabase, user } = ctx;

  const validated = validateSequenceName(name);
  if (!validated.ok) return validated;

  const { data, error } = await supabase
    .from("sequences")
    .insert({ workspace_id: workspace.id, name: validated.value })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[sequences] alta fallida:", error?.message);
    return {
      ok: false,
      error: `No pude crear la secuencia: ${error?.message ?? "error desconocido"}`,
    };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "sequence",
    entityId: data.id,
    action: "create",
    metadata: { name: validated.value },
    performedBy: user.id,
  });

  revalidatePath(LIST_PATH);
  return { ok: true, sequenceId: data.id };
}

export interface SequenceUpdate {
  name?: string;
  description?: string | null;
  steps?: SequenceStep[];
  status?: SequenceStatus;
}

export async function updateSequence(
  sequenceId: string,
  updates: SequenceUpdate
): Promise<SequenceActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden editar secuencias" };
  const { workspace, supabase, user } = ctx;

  const { data: before } = await supabase
    .from("sequences")
    .select("id, name, description, status, steps")
    .eq("id", sequenceId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!before) return { ok: false, error: "No encontré esa secuencia" };

  const patch: Record<string, unknown> = {};

  if (updates.name !== undefined) {
    const validated = validateSequenceName(updates.name);
    if (!validated.ok) return validated;
    patch.name = validated.value;
  }

  if (updates.description !== undefined) {
    patch.description = updates.description?.trim() || null;
  }

  let steps = (before.steps as unknown as SequenceStep[]) ?? [];
  if (updates.steps !== undefined) {
    const validated = validateSequenceSteps(updates.steps);
    if (!validated.ok) return validated;
    steps = validated.value;
    patch.steps = JSON.parse(JSON.stringify(steps));
  }

  if (updates.status !== undefined) {
    if (!["draft", "active", "paused"].includes(updates.status)) {
      return { ok: false, error: "Ese estado de secuencia no existe" };
    }
    // La misma regla que el editor mostraba solo del lado del cliente.
    if (updates.status === "active") {
      const allowed = canActivate(steps);
      if (!allowed.ok) return allowed;
    }
    patch.status = updates.status;
  }

  if (Object.keys(patch).length === 0) return { ok: true, sequenceId };

  patch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("sequences")
    .update(patch)
    .eq("id", sequenceId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[sequences] edicion fallida:", error.message);
    return { ok: false, error: `No pude guardar los cambios: ${error.message}` };
  }

  // Pausar la secuencia pausa sus inscripciones; activarla no las reanuda
  // sola. Reanudar es una decision de una persona, inscripcion por
  // inscripcion, porque en el medio pudo haber pasado cualquier cosa.
  if (updates.status === "paused" && before.status === "active") {
    await pauseEnrollmentsOfSequence(supabase, sequenceId, workspace.id, user.id);
  }

  // El jsonb de los pasos no entra en el diff: es ruido ilegible en el
  // historial. Que cambiaron se anota aparte.
  const changes = diffFields(
    {
      name: before.name,
      description: before.description,
      status: before.status,
    },
    {
      name: patch.name ?? before.name,
      description: patch.description !== undefined ? patch.description : before.description,
      status: patch.status ?? before.status,
    }
  );

  if (changes || patch.steps !== undefined) {
    await logAudit({
      supabase,
      workspaceId: workspace.id,
      entityType: "sequence",
      entityId: sequenceId,
      action: "update",
      changes,
      metadata: patch.steps !== undefined ? { steps: steps.length } : null,
      performedBy: user.id,
    });
  }

  revalidatePath(LIST_PATH);
  revalidatePath(detailPath(sequenceId));
  return { ok: true, sequenceId };
}

/**
 * Al pausar la secuencia, sus inscripciones quedan pausadas y reanudables.
 *
 * Antes el procesador las pasaba a `cancelled` en cuanto veia la secuencia
 * fuera de `active`: tocar el boton de pausa mataba para siempre a todos los
 * que estaban en el medio, y con el UNIQUE viejo no se los podia volver a
 * inscribir.
 */
async function pauseEnrollmentsOfSequence(
  supabase: Awaited<ReturnType<typeof getWorkspace>>["supabase"],
  sequenceId: string,
  workspaceId: string,
  userId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("sequence_enrollments")
    .update({
      status: "paused",
      paused_reason: "sequence_paused",
      paused_at: new Date().toISOString(),
      locked_at: null,
    })
    .eq("sequence_id", sequenceId)
    .eq("status", "active")
    .select("id");

  if (error) {
    console.error("[sequences] no pude pausar las inscripciones:", error.message);
    return;
  }
  if (!data?.length) return;

  await logAudit({
    supabase,
    workspaceId,
    entityType: "sequence",
    entityId: sequenceId,
    action: "sequence_paused",
    metadata: { reason: "sequence_paused", count: data.length },
    performedBy: userId,
  });
}

export async function deleteSequence(sequenceId: string): Promise<SequenceActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden eliminar secuencias" };
  const { workspace, supabase, user } = ctx;

  const { data: before } = await supabase
    .from("sequences")
    .select("id, name")
    .eq("id", sequenceId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!before) return { ok: false, error: "No encontré esa secuencia" };

  const { error } = await supabase
    .from("sequences")
    .delete()
    .eq("id", sequenceId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[sequences] baja fallida:", error.message);
    return { ok: false, error: `No pude eliminar la secuencia: ${error.message}` };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "sequence",
    entityId: sequenceId,
    action: "delete",
    metadata: { name: before.name },
    performedBy: user.id,
  });

  revalidatePath(LIST_PATH);
  return { ok: true };
}

/**
 * Las secuencias del workspace, para los selectores.
 *
 * Las usa el panel del nodo Condition (F14) y el dialogo de inscripcion. Solo
 * id, nombre y estado: nada que no se pueda mostrar.
 */
export async function listSequenceOptions(): Promise<
  Array<{ id: string; name: string; status: SequenceStatus }>
> {
  const { workspace, supabase } = await getWorkspace();

  const { data, error } = await supabase
    .from("sequences")
    .select("id, name, status")
    .eq("workspace_id", workspace.id)
    .order("name");

  if (error) {
    console.error("[sequences] no pude listar las secuencias:", error.message);
    return [];
  }
  return data ?? [];
}

/**
 * Reanuda una inscripcion pausada.
 *
 * El opt-out no se reanuda: volver a escribirle a alguien que pidio que no lo
 * contacten tiene que ser una decision explicita, y se hace re-inscribiendolo,
 * no destrabando lo que ya estaba.
 */
export async function resumeEnrollment(enrollmentId: string): Promise<SequenceActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden reanudar inscripciones" };
  const { workspace, supabase, user } = ctx;

  const { data: enrollment } = await supabase
    .from("sequence_enrollments")
    .select("id, sequence_id, contact_id, status, paused_reason, sequences!inner(workspace_id, status)")
    .eq("id", enrollmentId)
    .maybeSingle();

  if (!enrollment) return { ok: false, error: "No encontré esa inscripción" };

  const sequence = enrollment.sequences as unknown as {
    workspace_id: string;
    status: SequenceStatus;
  };
  if (sequence.workspace_id !== workspace.id) {
    return { ok: false, error: "No encontré esa inscripción" };
  }
  if (enrollment.status !== "paused") {
    return { ok: false, error: "Esa inscripción no está pausada" };
  }
  if (enrollment.paused_reason === "opt_out") {
    return {
      ok: false,
      error: "El contacto pidió no ser contactado. Para reanudarla hay que sacarle la marca e inscribirlo de nuevo.",
    };
  }
  if (sequence.status !== "active") {
    return {
      ok: false,
      error: "La secuencia está pausada. Activala primero y después reanudá la inscripción.",
    };
  }

  const { error } = await supabase
    .from("sequence_enrollments")
    .update({
      status: "active",
      paused_reason: null,
      paused_at: null,
      attempt_count: 0,
      last_error: null,
      // Retoma en el proximo tick del cron, desde el paso donde quedo.
      next_step_at: new Date().toISOString(),
    })
    .eq("id", enrollmentId);

  if (error) {
    console.error("[sequences] no pude reanudar:", error.message);
    return { ok: false, error: `No pude reanudar la inscripción: ${error.message}` };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "sequence_enrollment",
    entityId: enrollmentId,
    action: "sequence_resumed",
    metadata: { sequence_id: enrollment.sequence_id, contact_id: enrollment.contact_id },
    performedBy: user.id,
  });

  revalidatePath(detailPath(enrollment.sequence_id));
  return { ok: true };
}

export async function cancelEnrollment(enrollmentId: string): Promise<SequenceActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden cancelar inscripciones" };
  const { workspace, supabase, user } = ctx;

  const { data: enrollment } = await supabase
    .from("sequence_enrollments")
    .select("id, sequence_id, contact_id, status, sequences!inner(workspace_id)")
    .eq("id", enrollmentId)
    .maybeSingle();

  if (!enrollment) return { ok: false, error: "No encontré esa inscripción" };

  const sequence = enrollment.sequences as unknown as { workspace_id: string };
  if (sequence.workspace_id !== workspace.id) {
    return { ok: false, error: "No encontré esa inscripción" };
  }

  const terminal: SequenceEnrollmentStatus[] = ["completed", "cancelled"];
  if (terminal.includes(enrollment.status)) {
    return { ok: false, error: "Esa inscripción ya está terminada" };
  }

  const { error } = await supabase
    .from("sequence_enrollments")
    .update({ status: "cancelled", next_step_at: null, locked_at: null })
    .eq("id", enrollmentId);

  if (error) {
    console.error("[sequences] no pude cancelar:", error.message);
    return { ok: false, error: `No pude cancelar la inscripción: ${error.message}` };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "sequence_enrollment",
    entityId: enrollmentId,
    action: "delete",
    metadata: { sequence_id: enrollment.sequence_id, contact_id: enrollment.contact_id },
    performedBy: user.id,
  });

  revalidatePath(detailPath(enrollment.sequence_id));
  return { ok: true };
}
