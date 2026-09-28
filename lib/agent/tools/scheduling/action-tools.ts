/**
 * Las herramientas que cambian algo (F55).
 *
 * Las tres pasan por las MISMAS funciones que la página pública y la pantalla
 * del equipo: crear, reagendar y cancelar. Lo que agregan es el rastro con
 * `performed_by_agent_id`, que es lo que hace que la pestaña Acciones pueda
 * mostrar lo que hizo el agente y revertirlo.
 *
 * En modo borrador NO se ofrecen (`hideInDraft`). Agendar es un efecto sobre
 * el mundo y un borrador todavía no salió; dejarlas disponibles haría que el
 * agente agende al redactar algo que quizá nadie aprueba. Las que solo leen sí
 * se ofrecen: el borrador necesita los horarios para proponerlos.
 */

import { z } from "zod";
import type { AgentToolContext, AgentToolDefinition } from "../types";
import { schedulingConfigOf, schedulingUsable, type SchedulingSkillConfig } from "./config";
import { createBooking } from "@/lib/scheduling/booking/create";
import { cancelBooking } from "@/lib/scheduling/booking/cancel";
import { rescheduleBooking } from "@/lib/scheduling/booking/reschedule";
import { logBookingEffect } from "../effects";
import { formatDateTimeWithZone } from "@/lib/scheduling/booker/format";
import { eventPublicUrl, publicBaseUrl } from "@/lib/scheduling/public-url";
import { inferTimezone } from "./timezone";

const noConfig = z.object({}).default({});

function configOf(ctx: AgentToolContext): SchedulingSkillConfig {
  return schedulingConfigOf(ctx.agent.toolsConfig as Record<string, unknown> | undefined);
}

function usable(agent: { toolsConfig?: unknown }): boolean {
  return schedulingUsable(schedulingConfigOf(agent.toolsConfig as Record<string, unknown> | undefined));
}

function effectContext(ctx: AgentToolContext) {
  return {
    supabase: ctx.supabase,
    workspaceId: ctx.workspaceId,
    agentId: ctx.agent.id,
    runId: ctx.run?.runId ?? null,
    conversationId: ctx.conversationId,
    contactId: ctx.contactId,
    channelId: ctx.channelId,
    origin: "tool" as const,
  };
}

/** La próxima reunión activa del contacto. El código público no sale de acá. */
async function upcomingBooking(ctx: AgentToolContext) {
  if (!ctx.contactId) return null;
  const { data } = await ctx.supabase
    .from("bookings")
    .select("id, uid, title, start_at, booker_timezone, event_type_id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("contact_id", ctx.contactId)
    .eq("status_group", "active")
    .gt("start_at", new Date().toISOString())
    .order("start_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

// ---------------------------------------------------------------------------
// 4. Agendar
// ---------------------------------------------------------------------------

const bookInput = z
  .object({
    event_type_id: z.string().uuid(),
    start_utc: z.string().describe("El start_utc EXACTO que devolvió scheduling_get_slots. No lo edites."),
    nombre: z.string().min(1).max(120).describe("El nombre del lead, como lo dijo."),
    email: z.string().max(254).describe("Su email. Si no lo tenés, pedíselo antes: sin email no llega la invitación."),
    timezone: z.string().max(64).optional(),
  })
  .strict();

export const schedulingBookTool: AgentToolDefinition<z.infer<typeof bookInput>, Record<string, never>> = {
  name: "scheduling_book",
  label: "Agendar la reunión",
  description: "Agenda la reunión en el horario que eligió el lead. Usá el start_utc exacto de scheduling_get_slots.",
  inputSchema: bookInput,
  configSchema: noConfig,
  configFields: [],
  auditAction: "booking.created",
  isAvailable: (agent) => usable(agent) && schedulingConfigOf((agent as { toolsConfig?: unknown }).toolsConfig as Record<string, unknown>).puede_agendar,
  hideInDraft: true,
  async execute({ input, ctx }) {
    const config = configOf(ctx);
    if (!config.event_type_ids.includes(input.event_type_id)) {
      return { ok: false, forModel: "Ese tipo de reunión no está entre los que podés ofrecer." };
    }

    const { data: contact } = ctx.contactId
      ? await ctx.supabase.from("contacts").select("timezone, phone").eq("id", ctx.contactId).maybeSingle()
      : { data: null };
    const { data: workspace } = await ctx.supabase.from("workspaces").select("timezone").eq("id", ctx.workspaceId).maybeSingle();
    const inferred = inferTimezone({
      contactTimezone: input.timezone ?? contact?.timezone,
      phone: contact?.phone,
      workspaceTimezone: (workspace as { timezone?: string } | null)?.timezone ?? "America/Costa_Rica",
    });

    // Idempotencia del turno: si el modelo llama dos veces con lo mismo, se
    // agenda una. El memo alcanza para el turno; la exclusión de la base
    // atrapa el resto.
    const memoKey = `scheduling_book:${input.event_type_id}:${input.start_utc}`;
    const already = ctx.turn?.memo.get(memoKey);
    if (already) return { ok: true, forModel: String(already) };

    const result = await createBooking(ctx.supabase, {
      eventTypeId: input.event_type_id,
      startUtc: input.start_utc,
      inviteeTz: inferred.timezone,
      responses: { name: input.nombre, email: input.email },
      contactId: ctx.contactId,
      origin: "agent",
      metadata: { agent_id: ctx.agent.id, agent_run_id: ctx.run?.runId ?? null },
    });

    if (!result.ok) {
      const message =
        result.reason === "slot_taken" || result.reason === "slot_unavailable"
          ? "Ese horario se ocupó recién. Decíselo y ofrecé otros con scheduling_get_slots."
          : result.reason === "invalid"
            ? `Faltan datos o están mal: ${result.message ?? "revisá el nombre y el email"}.`
            : "No pude agendar ahora. Decíselo y ofrecé volver a intentarlo.";
      return { ok: false, forModel: message };
    }
    if (!result.uid) return { ok: false, forModel: "No pude agendar." };

    const auditLogId = await logBookingEffect(effectContext(ctx), {
      bookingId: result.bookingId,
      action: "booking.created",
      detail: { start_at: result.startUtc, event_type_id: input.event_type_id },
    });

    const forModel = `Listo: quedó agendada para el ${formatDateTimeWithZone(result.startUtc, inferred.timezone)}. Le llega la invitación a ${input.email}.`;
    ctx.turn?.memo.set(memoKey, forModel);
    return { ok: true, forModel, auditLogId, detail: { booking_id: result.bookingId } };
  },
};

// ---------------------------------------------------------------------------
// 5. Reagendar
// ---------------------------------------------------------------------------

const rescheduleInput = z.object({ start_utc: z.string().describe("El start_utc exacto del nuevo horario.") }).strict();

export const schedulingRescheduleTool: AgentToolDefinition<z.infer<typeof rescheduleInput>, Record<string, never>> = {
  name: "scheduling_reschedule",
  label: "Cambiar la fecha de la reunión",
  description: "Mueve la próxima reunión del contacto a otro horario. Primero pedí horarios con scheduling_get_slots.",
  inputSchema: rescheduleInput,
  configSchema: noConfig,
  configFields: [],
  auditAction: "booking.rescheduled",
  isAvailable: (agent) => usable(agent) && schedulingConfigOf((agent as { toolsConfig?: unknown }).toolsConfig as Record<string, unknown>).puede_cancelar,
  hideInDraft: true,
  async execute({ input, ctx }) {
    const booking = await upcomingBooking(ctx);
    if (!booking) return { ok: false, forModel: "Este contacto no tiene ninguna reunión por venir." };

    const result = await rescheduleBooking(ctx.supabase, { bookingId: booking.id, startUtc: input.start_utc, by: "host" });
    if (!result.ok) {
      return {
        ok: false,
        forModel:
          result.reason === "slot_taken" || result.reason === "slot_unavailable"
            ? "Ese horario ya no está libre. Pedí horarios de nuevo y ofrecé otros."
            : "No pude cambiar la fecha ahora. Derivá a una persona.",
      };
    }

    const auditLogId = await logBookingEffect(effectContext(ctx), {
      bookingId: booking.id,
      action: "booking.rescheduled",
      detail: { from: booking.start_at, to: result.startUtc },
    });
    const tz = booking.booker_timezone ?? "UTC";
    return {
      ok: true,
      forModel: `Cambiada para el ${formatDateTimeWithZone(result.startUtc, tz)}. Le llega la invitación nueva por email.`,
      auditLogId,
    };
  },
};

// ---------------------------------------------------------------------------
// 6. Cancelar
// ---------------------------------------------------------------------------

const cancelInput = z.object({ motivo: z.string().max(300).optional() }).strict();

export const schedulingCancelTool: AgentToolDefinition<z.infer<typeof cancelInput>, Record<string, never>> = {
  name: "scheduling_cancel",
  label: "Cancelar la reunión",
  description: "Cancela la próxima reunión del contacto. Es definitivo: confirmá con el lead antes de usarla.",
  inputSchema: cancelInput,
  configSchema: noConfig,
  configFields: [],
  auditAction: "booking.cancelled",
  isAvailable: (agent) => usable(agent) && schedulingConfigOf((agent as { toolsConfig?: unknown }).toolsConfig as Record<string, unknown>).puede_cancelar,
  hideInDraft: true,
  async execute({ input, ctx }) {
    const booking = await upcomingBooking(ctx);
    if (!booking) return { ok: false, forModel: "Este contacto no tiene ninguna reunión por venir." };

    const result = await cancelBooking(ctx.supabase, {
      bookingId: booking.id,
      by: "system",
      reason: input.motivo ?? "Cancelada a pedido del contacto",
    });
    if (!result.ok) return { ok: false, forModel: "No pude cancelarla. Derivá a una persona." };

    const auditLogId = await logBookingEffect(effectContext(ctx), {
      bookingId: booking.id,
      action: "booking.cancelled",
      detail: { reason: input.motivo ?? null },
    });
    return { ok: true, forModel: "Cancelada. Si quiere, puede volver a agendar cuando le sirva.", auditLogId };
  },
};

// ---------------------------------------------------------------------------
// 7. Pasar el link
// ---------------------------------------------------------------------------

const linkInput = z.object({ event_type_id: z.string().uuid() }).strict();

export const schedulingSendLinkTool: AgentToolDefinition<z.infer<typeof linkInput>, Record<string, never>> = {
  name: "scheduling_send_link",
  label: "Pasar el link para agendar",
  description: "Devuelve el link público de un tipo de reunión, para que el lead elija el horario él mismo.",
  inputSchema: linkInput,
  configSchema: noConfig,
  configFields: [],
  isAvailable: usable,
  async execute({ input, ctx }) {
    const config = configOf(ctx);
    if (!config.event_type_ids.includes(input.event_type_id)) {
      return { ok: false, forModel: "Ese tipo de reunión no está entre los que podés ofrecer." };
    }

    const { data: event } = await ctx.supabase
      .from("event_types")
      .select("slug, title, owner_user_id")
      .eq("id", input.event_type_id)
      .maybeSingle();
    if (!event) return { ok: false, forModel: "No encontré ese tipo de reunión." };

    const [{ data: profile }, { data: workspace }] = await Promise.all([
      ctx.supabase.from("scheduling_profiles").select("username").eq("workspace_id", ctx.workspaceId).eq("user_id", event.owner_user_id).maybeSingle(),
      ctx.supabase.from("workspaces").select("scheduling_public_base_url").eq("id", ctx.workspaceId).maybeSingle(),
    ]);
    if (!profile?.username) return { ok: false, forModel: "Esa reunión todavía no tiene link público." };

    const url = eventPublicUrl(publicBaseUrl(workspace as { scheduling_public_base_url?: string | null } | null), profile.username, event.slug);
    return { ok: true, forModel: `El link de "${event.title}" es ${url}. Pasáselo y decile que elija el horario que le sirva.` };
  },
};

export const schedulingActionTools = [schedulingBookTool, schedulingRescheduleTool, schedulingCancelTool, schedulingSendLinkTool];
