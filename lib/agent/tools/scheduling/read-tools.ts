/**
 * Las herramientas de consulta de la habilidad de agendamiento (F54).
 *
 * Las tres leen y ninguna escribe, así que no dejan rastro en `audit_log`: lo
 * que se registra son los efectos, y mirar horarios no es uno.
 *
 * `scheduling_get_slots` llama a la MISMA función que la página pública
 * (`getPublicSlots`). Si usara otra, el agente podría ofrecer un horario que
 * el link no muestra, y la reunión se caería al confirmarla.
 */

import { z } from "zod";
import type { AgentToolContext, AgentToolDefinition } from "../types";
import { schedulingConfigOf, schedulingSkillSchema, schedulingUsable, type SchedulingSkillConfig } from "./config";
import { getPublicSlots } from "@/lib/scheduling/slots-service";
import { formatDateTimeWithZone } from "@/lib/scheduling/booker/format";
import { categoryLabel } from "@/lib/scheduling/categories";
import { listCategories, toCategoryRow } from "@/lib/scheduling/data/event-types";
import { inferTimezone, shouldAskTimezone } from "./timezone";
import { publicBaseUrl, eventPublicUrl } from "@/lib/scheduling/public-url";

/** Las herramientas de la habilidad comparten config: nada propio que fijar. */
const noConfig = z.object({}).default({});

function configOf(ctx: AgentToolContext): SchedulingSkillConfig {
  return schedulingConfigOf(ctx.agent.toolsConfig as Record<string, unknown> | undefined);
}

/** La habilidad tiene que estar encendida y con al menos un evento. */
function available(agent: { toolsConfig?: unknown }): boolean {
  return schedulingUsable(schedulingConfigOf(agent.toolsConfig as Record<string, unknown> | undefined));
}

/** Los eventos que este agente puede ofrecer, ya filtrados por la config. */
async function allowedEvents(ctx: AgentToolContext, config: SchedulingSkillConfig) {
  const { data } = await ctx.supabase
    .from("event_types")
    .select("id, title, slug, duration_minutes, category_id, owner_user_id, status")
    .eq("workspace_id", ctx.workspaceId)
    .in("id", config.event_type_ids)
    .is("deleted_at", null)
    .neq("status", "inactive");
  return data ?? [];
}

// ---------------------------------------------------------------------------
// 1. Qué puede ofrecer
// ---------------------------------------------------------------------------

export const schedulingListEventsTool: AgentToolDefinition<Record<string, never>, Record<string, never>> = {
  name: "scheduling_list_events",
  label: "Ver qué reuniones puede ofrecer",
  description: "Devuelve los tipos de reunión que podés ofrecer, con su duración. Usala antes de proponer nada si no sabés cuál corresponde.",
  inputSchema: z.object({}).strict(),
  configSchema: noConfig,
  configFields: [],
  isAvailable: available,
  async execute({ ctx }) {
    const config = configOf(ctx);
    const [events, categories] = await Promise.all([allowedEvents(ctx, config), listCategories(ctx.supabase, ctx.workspaceId)]);
    if (events.length === 0) {
      return { ok: false, forModel: "No hay reuniones para ofrecer. No propongas ninguna y seguí la conversación." };
    }
    const rows = events.map((e) => {
      const label = categoryLabel(e.category_id, categories.map(toCategoryRow));
      return `- ${e.title} (${e.duration_minutes} min${label ? `, ${label}` : ""}) · id: ${e.id}`;
    });
    return { ok: true, forModel: `Podés ofrecer:\n${rows.join("\n")}`, detail: { count: events.length } };
  },
};

// ---------------------------------------------------------------------------
// 2. Horarios libres
// ---------------------------------------------------------------------------

const slotsInput = z
  .object({
    event_type_id: z.string().uuid().describe("El id del tipo de reunión, de scheduling_list_events."),
    timezone: z.string().max(64).optional().describe("La zona horaria del lead, si la sabés (ej: America/Mexico_City)."),
    desde: z.string().max(40).optional().describe("Fecha YYYY-MM-DD desde la que buscar. Por defecto, hoy."),
  })
  .strict();

export const schedulingGetSlotsTool: AgentToolDefinition<z.infer<typeof slotsInput>, Record<string, never>> = {
  name: "scheduling_get_slots",
  label: "Buscar horarios libres",
  description:
    "Devuelve horarios libres de verdad para un tipo de reunión. Es la ÚNICA fuente de horarios: no propongas ninguno que no haya salido de acá.",
  inputSchema: slotsInput,
  configSchema: noConfig,
  configFields: [],
  isAvailable: available,
  async execute({ input, ctx }) {
    const config = configOf(ctx);
    if (!config.event_type_ids.includes(input.event_type_id)) {
      return { ok: false, forModel: "Ese tipo de reunión no está entre los que podés ofrecer. Usá scheduling_list_events." };
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

    const from = input.desde ? new Date(`${input.desde}T00:00:00.000Z`) : new Date();
    const to = new Date(from.getTime() + config.dias_a_mirar * 24 * 60 * 60 * 1000);

    const result = await getPublicSlots(ctx.supabase, {
      eventTypeId: input.event_type_id,
      from: from.toISOString(),
      to: to.toISOString(),
      timezone: inferred.timezone,
    });

    if (!result.ok) {
      return {
        ok: false,
        forModel:
          result.reason === "temporarily_unavailable"
            ? "Ahora mismo no puedo ver los horarios. Decíselo y ofrecé volver a intentarlo en un rato."
            : "No encontré ese tipo de reunión.",
      };
    }

    const flat = Object.values(result.slots).flat().slice(0, config.horarios_por_respuesta * 3);
    if (flat.length === 0) {
      return { ok: true, forModel: "No hay horarios libres en ese rango. Ofrecé buscar más adelante o derivá a una persona." };
    }

    const propuestas = flat
      .slice(0, config.horarios_por_respuesta)
      .map((s) => `- ${formatDateTimeWithZone(s.startUtc, inferred.timezone)} · start_utc: ${s.startUtc}`);

    const aviso = shouldAskTimezone(inferred)
      ? `\n\nOjo: no sé en qué zona horaria está. Estos horarios son en ${inferred.timezone}; preguntale su zona antes de proponerlos.`
      : "";

    return {
      ok: true,
      forModel: `Horarios libres (en ${inferred.timezone}):\n${propuestas.join("\n")}${aviso}`,
      detail: { timezone: inferred.timezone, source: inferred.source, total: flat.length },
    };
  },
};

// ---------------------------------------------------------------------------
// 3. Qué tiene agendado este contacto
// ---------------------------------------------------------------------------

export const schedulingGetBookingTool: AgentToolDefinition<Record<string, never>, Record<string, never>> = {
  name: "scheduling_get_booking",
  label: "Ver la reunión del contacto",
  description: "Devuelve la próxima reunión de este contacto, si tiene una. Usala antes de ofrecer otra o si te preguntan cuándo era.",
  inputSchema: z.object({}).strict(),
  configSchema: noConfig,
  configFields: [],
  isAvailable: available,
  async execute({ ctx }) {
    if (!ctx.contactId) return { ok: false, forModel: "No sé de qué contacto se trata." };

    const { data: booking } = await ctx.supabase
      .from("bookings")
      .select("uid, title, start_at, status, booker_timezone, location_type, meet_url, event_type_id")
      .eq("workspace_id", ctx.workspaceId)
      .eq("contact_id", ctx.contactId)
      .eq("status_group", "active")
      .gt("start_at", new Date().toISOString())
      .order("start_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!booking) return { ok: true, forModel: "Este contacto no tiene ninguna reunión por venir." };

    const tz = booking.booker_timezone ?? "UTC";
    // El código público NO se le pasa al modelo: con él se cancela sin sesión.
    // Las herramientas de cambiar y cancelar lo buscan solas.
    return {
      ok: true,
      forModel: `Tiene "${booking.title}" el ${formatDateTimeWithZone(booking.start_at, tz)} (${tz}).`,
      detail: { start_at: booking.start_at, event_type_id: booking.event_type_id },
    };
  },
};

export const schedulingReadTools = [schedulingListEventsTool, schedulingGetSlotsTool, schedulingGetBookingTool];

/** Para el registro de habilidades. */
export { schedulingSkillSchema, eventPublicUrl, publicBaseUrl };
