import { z } from "zod";
import { todayInputValue } from "@/lib/dates";
import { createTaskFromAutomation, resolveConversationResponsible } from "@/lib/tasks/create-from-automation";
import { addDays, isDateOnly } from "@/lib/tasks/dates";
import { foldText } from "@/lib/tasks/text";
import type { AgentToolDefinition } from "./types";

/**
 * crear_tarea (Extra A, F23): el agente deja una tarea para el equipo («que me llame un asesor mañana»).
 *
 * No toca `programar_seguimiento` ni `contacts.next_followup_date`: el seguimiento es el «volver a escribirle» del lead; esto
 * es trabajo de una persona. Limites: un maximo de tareas abiertas del agente por conversacion y ninguna repetida (una
 * abierta de la misma conversacion con el mismo titulo, o uno contenido en el otro, ya cubre el pedido).
 *
 * Responsable: la persona asignada a la conversacion, si no el setter del contacto, si no su vendedor, si no nadie (y
 * entonces se avisa a cada Owner/Admin). Origen `agent`, con el `run_id` como referencia.
 */

const inputSchema = z
  .object({
    titulo: z.string().min(3).max(200).describe("Que hay que hacer, en una frase corta y concreta."),
    descripcion: z.string().max(1000).optional().describe("Contexto para quien la tome: que pidio el lead y que ya se hablo."),
    dias: z.number().int().min(0).max(365).optional().describe("En cuantos dias vence (0 = hoy)."),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("O una fecha concreta, AAAA-MM-DD."),
    motivo: z.string().min(3).max(300).describe("Por que hace falta esta tarea."),
  })
  .refine((v) => v.dias === undefined || v.fecha === undefined, { message: "Indica dias o fecha, no las dos." });

const configSchema = z.object({
  maxPerConversation: z.number().int().min(1).max(20).default(3),
  defaultDueDays: z.number().int().min(0).max(60).default(2),
});

/** ¿Es la misma tarea? Mismo titulo sin acentos ni mayusculas, o uno contenido en el otro (si es lo bastante largo). Puro. */
export function isSimilarTitle(a: string, b: string): boolean {
  const x = foldText(a).replace(/\s+/g, " ").trim();
  const y = foldText(b).replace(/\s+/g, " ").trim();
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 12 && long.includes(short);
}

export const createTaskTool: AgentToolDefinition<z.infer<typeof inputSchema>, z.infer<typeof configSchema>> = {
  name: "crear_tarea",
  label: "Crear tarea",
  description:
    "Deja una tarea para una persona del equipo cuando el lead pide algo que el agente no puede resolver solo (una llamada, una propuesta, una revision). Indica que hay que hacer, para cuando (dias o fecha) y por que. No le prometas al lead que alguien lo va a llamar a una hora exacta. No uses esto para volver a escribirle (para eso esta programar_seguimiento).",
  inputSchema,
  configSchema,
  configFields: [
    { key: "maxPerConversation", label: "Maximo de tareas abiertas por conversacion", hint: "Pasado el tope no crea mas: evita llenar la lista si el lead insiste.", kind: "number", min: 1, max: 20 },
    { key: "defaultDueDays", label: "Dias para vencer si no indica ninguno", kind: "number", min: 0, max: 60 },
  ],
  auditAction: "task.created",
  async execute({ input, config, ctx }) {
    if (!ctx.conversationId) return { ok: false, forModel: "No hay una conversacion donde crear la tarea." };

    // Las tareas abiertas de esta conversacion: para el tope y para no repetir.
    const { data: open, error } = await ctx.supabase
      .from("tasks")
      .select("id, title, source")
      .eq("workspace_id", ctx.workspaceId)
      .eq("conversation_id", ctx.conversationId)
      .is("deleted_at", null)
      .neq("status", "completed");
    if (error) {
      console.error("[tareas] no pude leer las tareas de la conversacion:", error.message);
      return { ok: false, forModel: "No pude revisar las tareas de esta conversacion. No insistas." };
    }
    const existing = (open ?? []) as Array<{ id: string; title: string; source: string }>;

    const similar = existing.find((t) => isSimilarTitle(t.title, input.titulo));
    if (similar) {
      return { ok: true, forModel: `Ya existe una tarea abierta parecida («${similar.title}»). No hace falta crear otra.`, detail: { duplicate: similar.id } };
    }
    const mine = existing.filter((t) => t.source === "agent").length;
    if (mine >= config.maxPerConversation) {
      return { ok: false, forModel: `Ya hay ${mine} tareas abiertas creadas por el agente en esta conversacion (el maximo es ${config.maxPerConversation}). No se crean mas.` };
    }

    const { data: workspace } = await ctx.supabase.from("workspaces").select("timezone").eq("id", ctx.workspaceId).maybeSingle();
    const today = todayInputValue(new Date(), workspace?.timezone || "UTC");
    const dueDate = input.fecha && isDateOnly(input.fecha) ? input.fecha : addDays(today, input.dias ?? config.defaultDueDays);

    const ownerId = await resolveConversationResponsible(ctx.supabase, { workspaceId: ctx.workspaceId, conversationId: ctx.conversationId, contactId: ctx.contactId });

    const result = await createTaskFromAutomation(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      title: input.titulo,
      description: input.descripcion ?? null,
      dueDate,
      ownerId,
      contactId: ctx.contactId,
      conversationId: ctx.conversationId,
      source: "agent",
      // Sin un run registrado (no deberia pasar), la referencia sale de la conversacion y el titulo: igual no se repite.
      sourceRef: ctx.run.runId ?? `${ctx.conversationId}:${foldText(input.titulo).replace(/\s+/g, " ").trim()}`.slice(0, 200),
      actor: { kind: "agent", label: "Agente de IA", agentId: ctx.agent.id, runId: ctx.run.runId, origin: "tool" },
      notifyIfUnassigned: true,
      reason: input.motivo,
    });

    if (!result.ok) return { ok: false, forModel: "No pude crear la tarea. No insistas." };
    if (result.duplicate) return { ok: true, forModel: "En este turno ya se creo una tarea. No hace falta otra." };

    const who = result.task.owner_id ? "Quedo a cargo de una persona del equipo." : "Quedo sin responsable: se aviso a los administradores para que la asignen.";
    return { ok: true, forModel: `Tarea creada: «${result.task.title}», para el ${dueDate}. ${who} No le avises al lead que la creaste.`, detail: { task_id: result.task.id } };
  },
};
