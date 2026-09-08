import { createServiceClient } from "@/lib/supabase/server";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import type { SequenceStep } from "@/lib/types/database";

/**
 * Process all sequence enrollments that are due.
 * Called by the cron endpoint every 30-60 seconds.
 */
export async function processSequenceSteps() {
  const supabase = await createServiceClient();

  // Fetch enrollments that are due
  const { data: enrollments, error } = await supabase
    .from("sequence_enrollments")
    .select("*, sequences(*)")
    .eq("status", "active")
    .lte("next_step_at", new Date().toISOString())
    .limit(50);

  if (error || !enrollments) {
    console.error("Failed to fetch sequence enrollments:", error);
    return { processed: 0, failed: 0 };
  }

  // Quienes pidieron no ser contactados (F18). El opt-out ya pausa las
  // inscripciones al llegar el mensaje, pero entre ese momento y este puede
  // haber una inscripcion ya reclamada por esta misma tanda, o una marcada a
  // mano desde la ficha. Es una sola consulta para las 50, no una por
  // enrollment.
  const contactIds = [...new Set(enrollments.map((e) => e.contact_id))];
  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, do_not_contact, deleted_at")
    .in("id", contactIds);

  const doNotContact = new Set(
    (contacts ?? []).filter((c) => c.do_not_contact || c.deleted_at).map((c) => c.id),
  );

  let processed = 0;
  let failed = 0;
  let paused = 0;

  for (const enrollment of enrollments) {
    try {
      if (doNotContact.has(enrollment.contact_id)) {
        await supabase
          .from("sequence_enrollments")
          .update({ status: "paused" })
          .eq("id", enrollment.id);
        paused++;
        continue;
      }
      await processEnrollment(supabase, enrollment);
      processed++;
    } catch (err) {
      console.error(
        `Failed to process enrollment ${enrollment.id}:`,
        err instanceof Error ? err.message : err
      );
      failed++;
    }
  }

  return { processed, failed, paused, total: enrollments.length };
}

async function processEnrollment(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  enrollment: {
    id: string;
    sequence_id: string;
    contact_id: string;
    channel_id: string;
    current_step_index: number;
    sequences: {
      id: string;
      workspace_id: string;
      steps: unknown;
      status: string;
    } | null;
  }
) {
  const sequence = enrollment.sequences;
  if (!sequence || sequence.status !== "active") {
    // Sequence was paused/deleted, cancel enrollment
    await supabase
      .from("sequence_enrollments")
      .update({ status: "cancelled" })
      .eq("id", enrollment.id);
    return;
  }

  const steps = (sequence.steps as SequenceStep[]) || [];
  const stepIndex = enrollment.current_step_index;

  if (stepIndex >= steps.length) {
    // No more steps, complete the enrollment
    await supabase
      .from("sequence_enrollments")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", enrollment.id);
    return;
  }

  const currentStep = steps[stepIndex];

  if (currentStep.type === "message") {
    await sendSequenceMessage(
      supabase,
      sequence.workspace_id,
      enrollment.contact_id,
      enrollment.channel_id,
      currentStep.content || ""
    );
  }
  // Delay steps don't need action; they just waited until next_step_at

  // Advance to next step
  const nextIndex = stepIndex + 1;

  if (nextIndex >= steps.length) {
    // Completed
    await supabase
      .from("sequence_enrollments")
      .update({
        current_step_index: nextIndex,
        status: "completed",
        completed_at: new Date().toISOString(),
        next_step_at: null,
      })
      .eq("id", enrollment.id);
    return;
  }

  // Calculate next_step_at based on the next step
  const nextStep = steps[nextIndex];
  let nextStepAt: string;

  if (nextStep.type === "delay" && nextStep.delayMinutes) {
    nextStepAt = new Date(
      Date.now() + nextStep.delayMinutes * 60 * 1000
    ).toISOString();
  } else {
    // Next step is a message, execute it on the next cron tick
    nextStepAt = new Date().toISOString();
  }

  await supabase
    .from("sequence_enrollments")
    .update({
      current_step_index: nextIndex,
      next_step_at: nextStepAt,
    })
    .eq("id", enrollment.id);
}

async function sendSequenceMessage(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  workspaceId: string,
  contactId: string,
  channelId: string,
  text: string
) {
  const apiKey = await getZernioApiKey(workspaceId, { supabase });

  if (!apiKey) {
    console.error("No Zernio API key for workspace:", workspaceId);
    return;
  }

  const zernio = createZernioClient(apiKey);

  // Get channel's late_account_id
  const { data: channel } = await supabase
    .from("channels")
    .select("late_account_id")
    .eq("id", channelId)
    .single();

  if (!channel?.late_account_id) {
    console.error("No late_account_id for channel:", channelId);
    return;
  }

  // Get conversation for this contact + channel
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, late_conversation_id")
    .eq("contact_id", contactId)
    .eq("channel_id", channelId)
    .single();

  if (!conversation?.late_conversation_id) {
    console.error(
      "No conversation found for contact:",
      contactId,
      "channel:",
      channelId
    );
    return;
  }

  try {
    const response = await zernio.messages.sendInboxMessage({
      path: { conversationId: conversation.late_conversation_id },
      body: { accountId: channel.late_account_id, message: text },
    });

    // Store outbound message
    await supabase.from("messages").insert({
      conversation_id: conversation.id,
      direction: "outbound",
      text,
      status: "sent",
      platform_message_id: response.data?.data?.messageId || null,
    });
  } catch (err) {
    console.error("Failed to send sequence message:", err);

    // Store failed message
    await supabase.from("messages").insert({
      conversation_id: conversation.id,
      direction: "outbound",
      text,
      status: "failed",
    });
  }
}
