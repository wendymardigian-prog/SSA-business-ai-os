/**
 * Una tarea que sale de una reunión (Servicios A4, F143 y F155): `source = 'call'`, con la reunión, el servicio y el
 * contacto. La usa la propuesta `tarea` al aprobarse. Solo servidor, con el cliente de servicio DESPUÉS de mirar el
 * permiso (`calls.edit` + `tasks.edit`) y el negocio de la sesión.
 *
 * Avisa `task_assigned` al responsable si no es quien la creó (nunca a uno mismo). Nunca lanza: devuelve el motivo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { createNotification } from "@/lib/notifications/create";
import { TASK_LIMITS } from "./types";

type Db = SupabaseClient<Database>;

export type CallTaskInput = {
  workspaceId: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  ownerId: string | null;
  contactId: string | null;
  serviceId: string | null;
  callId: string;
  createdBy: string;
  actorName: string;
};

/** La fecha de vencimiento: hoy (en la zona del negocio) más N días. */
export function dueDateIn(days: number | null | undefined, today: string): string | null {
  if (days === null || days === undefined || !Number.isFinite(days)) return null;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.round(days)));
  return d.toISOString().slice(0, 10);
}

export async function createCallTask(db: Db, input: CallTaskInput): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  try {
    const title = input.title.replace(/\s+/g, " ").trim().slice(0, TASK_LIMITS.title);
    if (!title) return { ok: false, reason: "La tarea no tiene título." };
    // El responsable tiene que ser del negocio; si no, queda sin responsable.
    let ownerId = input.ownerId;
    if (ownerId) {
      const { data } = await db.from("workspace_members").select("user_id").eq("workspace_id", input.workspaceId).eq("user_id", ownerId).maybeSingle();
      if (!data) ownerId = null;
    }
    const { data, error } = await db
      .from("tasks")
      .insert({
        workspace_id: input.workspaceId,
        title,
        description: input.description?.trim().slice(0, TASK_LIMITS.description) || null,
        due_date: input.dueDate,
        owner_id: ownerId,
        contact_id: input.contactId,
        service_id: input.serviceId,
        call_id: input.callId,
        source: "call",
        source_ref: `call:${input.callId}`,
        created_by: input.createdBy,
      } as never)
      .select("id")
      .single();
    if (error || !data) {
      console.error("[tareas] no pude crear la tarea de la reunión:", error?.message);
      return { ok: false, reason: "No pude crear la tarea. Probá de nuevo." };
    }
    const id = (data as { id: string }).id;
    if (ownerId && ownerId !== input.createdBy) {
      await createNotification({
        supabase: db,
        workspaceId: input.workspaceId,
        type: "task_assigned",
        title: `${input.actorName} te asignó «${title}»`,
        entityType: "task",
        entityId: id,
        recipientId: ownerId,
        metadata: { task_id: id, call_id: input.callId },
      });
    }
    return { ok: true, id };
  } catch (error) {
    console.error("[tareas] crear la tarea de la reunión falló:", error instanceof Error ? error.message : error);
    return { ok: false, reason: "No pude crear la tarea. Probá de nuevo." };
  }
}
