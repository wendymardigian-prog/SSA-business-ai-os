import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { sendChannelMessage, recordSend } from "@/lib/flow-engine/send";
import { interpolateVariables } from "@/lib/flow-engine/interpolate";
import { generateAiReply } from "@/lib/ai/generate-reply";
import { buildSequenceSendContext } from "./send";
import {
  attemptsExhausted,
  computeNextStepAt,
  nextAttemptAt,
  parseSteps,
  stepVariables,
} from "./steps";
import type { Database, SequenceStep } from "@/lib/types/database";

/**
 * El procesador de secuencias. Lo llama el cron cada minuto.
 *
 * Cuatro cosas cambiaron respecto de la version del fork, y las cuatro eran
 * bugs con consecuencias visibles para el lead:
 *
 * 1. Las inscripciones se reclaman con claim_sequence_enrollments (migracion
 *    00042). Antes era un select suelto: dos corridas solapadas leian las
 *    mismas filas y el mismo DM salia dos veces.
 * 2. Se manda por sendChannelMessage, la misma puerta que el motor de flows.
 *    Antes era Zernio hardcodeado: sin tope horario, sin WhatsApp y con los
 *    errores crudos.
 * 3. Un envio fallido ya no avanza el paso. Se reintenta con espera creciente
 *    y recien al tercer intento se saltea, para que la secuencia siga viva.
 * 4. Una secuencia pausada pausa sus inscripciones; antes las cancelaba para
 *    siempre, y con el UNIQUE viejo tampoco se podia re-inscribir al contacto.
 */

type Db = SupabaseClient<Database>;
type Enrollment = Database["public"]["Tables"]["sequence_enrollments"]["Row"];

const BATCH_SIZE = 25;

export interface ProcessResult {
  processed: number;
  failed: number;
  paused: number;
  skipped: number;
  total: number;
}

export async function processSequenceSteps(): Promise<ProcessResult> {
  const supabase = (await createServiceClient()) as Db;

  const { data: claimed, error } = await supabase.rpc("claim_sequence_enrollments", {
    p_limit: BATCH_SIZE,
  });

  if (error) {
    console.error("[sequences] no pude reclamar inscripciones:", error.message);
    return { processed: 0, failed: 0, paused: 0, skipped: 0, total: 0 };
  }

  const enrollments = (claimed ?? []) as Enrollment[];
  if (enrollments.length === 0) {
    return { processed: 0, failed: 0, paused: 0, skipped: 0, total: 0 };
  }

  const blocked = await loadBlockedContacts(supabase, enrollments);

  const result: ProcessResult = {
    processed: 0,
    failed: 0,
    paused: 0,
    skipped: 0,
    total: enrollments.length,
  };

  /**
   * Un contacto no recibe dos mensajes de dos secuencias distintas en el mismo
   * minuto (F12).
   *
   * Varias secuencias simultaneas son deliberadas, pero que coincidan en el
   * mismo tick es casualidad del cronograma, no una decision de nadie: la
   * segunda espera al proximo tick. La colision de fondo se avisa aparte (F13).
   */
  const alreadySentTo = new Set<string>();

  for (const enrollment of enrollments) {
    try {
      if (blocked.has(enrollment.contact_id)) {
        await pause(supabase, enrollment.id, "opt_out");
        result.paused++;
        continue;
      }

      const lane = `${enrollment.contact_id}:${enrollment.channel_id}`;
      if (alreadySentTo.has(lane)) {
        await reschedule(supabase, enrollment.id, nextAttemptAt(1));
        result.skipped++;
        continue;
      }

      const outcome = await processEnrollment(supabase, enrollment);

      if (outcome === "sent") alreadySentTo.add(lane);
      if (outcome === "paused") result.paused++;
      else if (outcome === "retry") result.failed++;
      else result.processed++;
    } catch (err) {
      console.error(
        `[sequences] error procesando la inscripcion ${enrollment.id}:`,
        err instanceof Error ? err.message : "error desconocido"
      );
      await release(supabase, enrollment.id);
      result.failed++;
    }
  }

  return result;
}

/**
 * Quienes no pueden recibir nada.
 *
 * El opt-out ya pausa las inscripciones al llegar el mensaje, pero entre ese
 * momento y este puede haber una marcada a mano desde la ficha. Es una sola
 * consulta para toda la tanda.
 */
async function loadBlockedContacts(supabase: Db, enrollments: Enrollment[]): Promise<Set<string>> {
  const ids = [...new Set(enrollments.map((e) => e.contact_id))];
  const { data } = await supabase
    .from("contacts")
    .select("id, do_not_contact, deleted_at")
    .in("id", ids);

  return new Set(
    (data ?? []).filter((c) => c.do_not_contact || c.deleted_at).map((c) => c.id)
  );
}

type StepOutcome = "sent" | "advanced" | "paused" | "retry" | "completed";

async function processEnrollment(supabase: Db, enrollment: Enrollment): Promise<StepOutcome> {
  const { data: sequence } = await supabase
    .from("sequences")
    .select("id, workspace_id, status, steps")
    .eq("id", enrollment.sequence_id)
    .maybeSingle();

  if (!sequence) {
    // La secuencia se borro mientras corria. No hay nada que seguir.
    await cancel(supabase, enrollment.id);
    return "paused";
  }

  if (sequence.status !== "active") {
    // Pausada o vuelta a borrador: la inscripcion queda frenada y reanudable,
    // no cancelada.
    await pause(supabase, enrollment.id, "sequence_paused");
    return "paused";
  }

  const steps = parseSteps(sequence.steps);
  const index = enrollment.current_step_index;

  if (index >= steps.length) {
    await complete(supabase, enrollment.id, index);
    return "completed";
  }

  const step = steps[index];

  // Un paso de espera ya cumplio su funcion esperando hasta ahora.
  if (step.type === "delay") {
    await advance(supabase, enrollment.id, steps, index);
    return "advanced";
  }

  const delivery = await deliverStep(supabase, enrollment, sequence.workspace_id, step);

  if (delivery === "no_conversation") {
    await pause(supabase, enrollment.id, "no_conversation");
    return "paused";
  }

  if (delivery === "retry") {
    // El tope horario no es culpa del paso: se reprograma sin gastar intento.
    await reschedule(supabase, enrollment.id, nextAttemptAt(1));
    return "retry";
  }

  if (delivery === "failed") {
    const used = enrollment.attempt_count + 1;
    if (!attemptsExhausted(used)) {
      await supabase
        .from("sequence_enrollments")
        .update({
          attempt_count: used,
          last_error_at: new Date().toISOString(),
          next_step_at: nextAttemptAt(used),
          locked_at: null,
        })
        .eq("id", enrollment.id);
      return "retry";
    }
    // Se agotaron los intentos: se saltea el paso y la secuencia sigue viva.
    // Perder un paso es malo; matar el seguimiento entero es peor.
    console.error(
      `[sequences] paso ${index} salteado tras ${used} intentos en la inscripcion ${enrollment.id}`
    );
    await advance(supabase, enrollment.id, steps, index);
    return "advanced";
  }

  await advance(supabase, enrollment.id, steps, index);
  return "sent";
}

type DeliveryOutcome = "sent" | "failed" | "retry" | "no_conversation";

async function deliverStep(
  supabase: Db,
  enrollment: Enrollment,
  workspaceId: string,
  step: SequenceStep
): Promise<DeliveryOutcome> {
  const built = await buildSequenceSendContext(supabase, enrollment, workspaceId);
  if (!built.ok) return "no_conversation";
  const context = built.context;

  const { data: contact } = await supabase
    .from("contacts")
    .select("display_name, email, phone, instagram_username")
    .eq("id", enrollment.contact_id)
    .maybeSingle();

  const variables = stepVariables(contact ?? {});

  let text: string;

  if (step.type === "aiMessage") {
    const reply = await generateAiReply(supabase, {
      workspaceId,
      conversationId: context.conversationId,
      contactId: enrollment.contact_id,
      provider: step.provider,
      modelId: step.model,
      systemPrompt:
        "Sos quien atiende los mensajes de este negocio. Escribi en español rioplatense, breve y natural, como una persona. No saludes de nuevo si la conversacion ya empezo.",
      userPrompt: interpolateVariables(step.prompt ?? "", variables),
      temperature: step.temperature,
      maxTokens: step.maxTokens,
      contextMessages: step.contextMessages,
      trace: {
        source: "sequence",
        sequenceId: enrollment.sequence_id,
        enrollmentId: enrollment.id,
      },
    });

    if (!reply.ok) {
      // La key falta, es invalida o el proveedor fallo. El error ya quedo en
      // analytics_events; el paso se reintenta y, si no hay caso, se saltea.
      // La secuencia no muere por un problema de configuracion.
      await supabase
        .from("sequence_enrollments")
        .update({ last_error: reply.message })
        .eq("id", enrollment.id);
      return "failed";
    }

    text = reply.text;
  } else {
    text = interpolateVariables(step.content ?? "", variables);
    if (!text.trim()) {
      // No deberia pasar: la validacion del servidor lo bloquea al guardar.
      // Si igual pasa, se saltea en vez de mandar un mensaje en blanco.
      return "sent";
    }
  }

  const outcome = await sendChannelMessage(supabase, context, { text });
  await recordSend(supabase, context, outcome.ok ? text : outcome.failure?.message ?? text, outcome);

  if (outcome.ok) return "sent";

  await supabase
    .from("sequence_enrollments")
    .update({ last_error: outcome.failure?.message ?? "No se pudo enviar el mensaje" })
    .eq("id", enrollment.id);

  return outcome.failure?.kind === "rate_limited" ? "retry" : "failed";
}

// ----------------------------------------------------------------------------
// Transiciones. Todas limpian locked_at: el paso termino, la fila queda libre.
// ----------------------------------------------------------------------------

async function advance(
  supabase: Db,
  enrollmentId: string,
  steps: SequenceStep[],
  currentIndex: number
): Promise<void> {
  const nextIndex = currentIndex + 1;
  const nextStepAt = computeNextStepAt(steps, nextIndex);

  if (nextStepAt === null) {
    await complete(supabase, enrollmentId, nextIndex);
    return;
  }

  await supabase
    .from("sequence_enrollments")
    .update({
      current_step_index: nextIndex,
      next_step_at: nextStepAt,
      attempt_count: 0,
      last_error: null,
      locked_at: null,
    })
    .eq("id", enrollmentId);
}

async function complete(supabase: Db, enrollmentId: string, index: number): Promise<void> {
  await supabase
    .from("sequence_enrollments")
    .update({
      current_step_index: index,
      status: "completed",
      completed_at: new Date().toISOString(),
      next_step_at: null,
      locked_at: null,
    })
    .eq("id", enrollmentId);
}

async function pause(supabase: Db, enrollmentId: string, reason: string): Promise<void> {
  await supabase
    .from("sequence_enrollments")
    .update({
      status: "paused",
      paused_reason: reason,
      paused_at: new Date().toISOString(),
      locked_at: null,
    })
    .eq("id", enrollmentId);
}

async function cancel(supabase: Db, enrollmentId: string): Promise<void> {
  await supabase
    .from("sequence_enrollments")
    .update({ status: "cancelled", next_step_at: null, locked_at: null })
    .eq("id", enrollmentId);
}

async function reschedule(supabase: Db, enrollmentId: string, at: string): Promise<void> {
  await supabase
    .from("sequence_enrollments")
    .update({ next_step_at: at, locked_at: null })
    .eq("id", enrollmentId);
}

/** Suelta el lock sin tocar nada mas, para que el proximo tick lo reintente. */
async function release(supabase: Db, enrollmentId: string): Promise<void> {
  await supabase.from("sequence_enrollments").update({ locked_at: null }).eq("id", enrollmentId);
}
