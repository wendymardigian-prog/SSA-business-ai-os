import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { EnrollSequenceNodeData } from "../types";

/**
 * Inscribe al contacto en una secuencia de seguimiento.
 *
 * La deteccion de colision (avisar cuando el contacto ya tiene otra secuencia
 * activa en el mismo canal) es F13, del Bloque 2: entra aca cuando se construya.
 */
export const enrollSequenceNode: NodeDefinition<EnrollSequenceNodeData> = {
  type: "enrollSequence",
  label: "Inscribir en secuencia",
  aliases: [{ nodeType: "action", actionType: "enrollSequence" }],
  async execute({ supabase, data, context }: NodeExecutionArgs<EnrollSequenceNodeData>) {
    if (!data.sequenceId) {
      console.error("enrollSequence node missing sequenceId");
      return;
    }

    const { data: sequence } = await supabase
      .from("sequences")
      .select("id, steps, status")
      .eq("id", data.sequenceId)
      .single();

    if (!sequence || sequence.status !== "active") {
      console.error("Sequence not found or not active:", data.sequenceId);
      return;
    }

    const steps = (sequence.steps as Array<{ type: string; delayMinutes?: number }>) || [];
    if (steps.length === 0) return;

    const firstStep = steps[0];
    const nextStepAt =
      firstStep.type === "delay" && firstStep.delayMinutes
        ? new Date(Date.now() + firstStep.delayMinutes * 60 * 1000).toISOString()
        : new Date().toISOString();

    const { error } = await supabase.from("sequence_enrollments").insert({
      sequence_id: data.sequenceId,
      contact_id: context.contactId,
      channel_id: context.channelId,
      next_step_at: nextStepAt,
    });

    // 23505 es "ya estaba inscripto": no es un error que valga la pena gritar.
    if (error && error.code !== "23505") {
      console.error("Failed to enroll contact in sequence:", error);
    }
  },
};
