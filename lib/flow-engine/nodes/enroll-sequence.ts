import type { NodeDefinition } from "../registry/types";
import type { EnrollSequenceNodeData } from "../types";
import { detectSequenceCollision } from "@/lib/sequences/collisions";
import { computeNextStepAt, parseSteps } from "@/lib/sequences/steps";
import { logAudit } from "@/lib/audit";
import type { Json } from "@/lib/types/database";

/**
 * Inscribe al contacto en una secuencia desde un flow (F15).
 *
 * Antes de inscribir corre la deteccion de colision (F13), pero **inscribe
 * igual**: una automatizacion no puede frenarse a preguntarle a una persona
 * que hacer. Lo que hace es dejar la colision marcada en la inscripcion, para
 * que un admin la vea en la pantalla de la secuencia y decida despues.
 */
export const enrollSequenceNode: NodeDefinition<EnrollSequenceNodeData> = {
  type: "enrollSequence",
  label: "Inscribir en secuencia",
  aliases: [{ nodeType: "action", actionType: "enrollSequence" }],

  async execute({ supabase, data, context }) {
    if (!data.sequenceId) {
      console.error("[enrollSequence] el nodo no tiene secuencia configurada");
      return;
    }

    // El filtro por workspace no estaba: el motor corre con service client, asi
    // que un sequenceId de otro workspace habria inscripto igual.
    const { data: sequence } = await supabase
      .from("sequences")
      .select("id, name, steps, status")
      .eq("id", data.sequenceId)
      .eq("workspace_id", context.workspaceId)
      .maybeSingle();

    if (!sequence || sequence.status !== "active") {
      console.error("[enrollSequence] la secuencia no existe o no esta activa:", data.sequenceId);
      return;
    }

    const steps = parseSteps(sequence.steps);
    if (steps.length === 0) return;

    // Un contacto marcado no puede entrar. Antes se inscribia y recien en el
    // primer tick del cron se pausaba.
    const { data: contact } = await supabase
      .from("contacts")
      .select("do_not_contact")
      .eq("id", context.contactId)
      .maybeSingle();

    if (contact?.do_not_contact) return;

    const collision = await detectSequenceCollision(supabase, {
      workspaceId: context.workspaceId,
      contactId: context.contactId,
      channelId: context.channelId,
      excludeSequenceId: data.sequenceId,
    });

    const { data: created, error } = await supabase
      .from("sequence_enrollments")
      .insert({
        sequence_id: data.sequenceId,
        contact_id: context.contactId,
        channel_id: context.channelId,
        next_step_at: computeNextStepAt(steps, 0) ?? new Date().toISOString(),
        collision_detected_at: collision.hasCollision ? new Date().toISOString() : null,
        collision_with: collision.hasCollision ? (collision.snapshot as unknown as Json) : null,
      })
      .select("id")
      .single();

    if (error || !created) {
      // 23505 es "ya tiene una inscripcion viva en esta secuencia": no es un
      // error que valga la pena gritar, el flow sigue.
      if (error?.code !== "23505") {
        console.error("[enrollSequence] no pude inscribir:", error?.message);
      }
      return;
    }

    // performedBy null porque lo hizo el sistema: la RLS del audit exige que
    // performed_by sea auth.uid(), y el motor corre sin usuario.
    await logAudit({
      supabase,
      workspaceId: context.workspaceId,
      entityType: "sequence_enrollment",
      entityId: created.id,
      action: "enroll",
      metadata: {
        sequence_id: data.sequenceId,
        sequence_name: sequence.name,
        contact_id: context.contactId,
        channel_id: context.channelId,
        source: "flow",
        flow_id: context.flowId,
      },
      performedBy: null,
    });

    if (collision.hasCollision) {
      await logAudit({
        supabase,
        workspaceId: context.workspaceId,
        entityType: "sequence_enrollment",
        entityId: created.id,
        action: "collision_detected",
        metadata: {
          contact_id: context.contactId,
          channel_id: context.channelId,
          with: collision.snapshot as unknown as Json,
        },
        performedBy: null,
      });

      // La costura para el centro de notificaciones del Bloque 3: cuando
      // exista, lee de aca y no hay que tocar nada de esto.
      await supabase.from("analytics_events").insert({
        workspace_id: context.workspaceId,
        flow_id: context.flowId,
        contact_id: context.contactId,
        event_type: "sequence_collision_detected",
        metadata: {
          sequence_id: data.sequenceId,
          enrollment_id: created.id,
          channel_id: context.channelId,
          with: collision.snapshot,
        } as never,
      });
    }
  },
};
