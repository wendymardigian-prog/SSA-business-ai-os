import { z } from "zod";
import { createTaskCore } from "@/lib/tasks/core"; // @plantilla-quitar(tareas)
import { searchKnowledgeForPerson } from "@/lib/knowledge/person-search";
import { NO_ACCESS_MESSAGE, type PersonToolContext, type PersonToolDefinition } from "./types";

/**
 * Las herramientas del asistente del equipo (traído de RER, adaptado a SSA). Decisión de Wendy (18/11/2026):
 * lee contactos, conversaciones, tareas, agenda, servicios y Conocimiento con lo que esa persona ya ve; crear una
 * tarea o una nota queda como propuesta que la persona aprueba en el mismo panel. Cuáles ofrece el asistente se elige
 * en su pantalla (Agentes IA → Asistente del equipo → Configuración), sin tocar código.
 *
 * Todas LEEN con la sesión de la persona: si la base no le deja ver algo, la respuesta es «No tenés acceso a eso», sin
 * datos. Las de escritura usan los núcleos de siempre con esa misma sesión.
 */

const uuid = z.string().uuid();
const search = z.string().trim().max(80).optional();
const LIMIT = 10;

function like(term: string | undefined): string | null {
  const clean = (term ?? "").replace(/[%_,()]/g, " ").trim();
  return clean ? `%${clean}%` : null;
}

function rowsOrNoAccess(rows: unknown[] | null, error: { message?: string } | null, what: string) {
  if (error) {
    console.error(`[ai-tools] no pude leer ${what}:`, error.message);
    return { ok: false as const, code: "failed" as const, message: "No pude leerlo ahora. Probá de nuevo en un rato." };
  }
  if (!rows || rows.length === 0) return { ok: false as const, code: "no_access" as const, message: NO_ACCESS_MESSAGE };
  return { ok: true as const, data: rows, message: `${rows.length} resultado(s).` };
}

const readContacts: PersonToolDefinition<{ busqueda?: string }> = {
  key: "ver_contactos",
  label: "Ver contactos",
  description: "Busca contactos (leads y clientes) por nombre, teléfono o email. Devuelve solo los que la persona puede ver.",
  access: "read",
  permission: "contacts.view",
  params: z.object({ busqueda: search }),
  fields: [],
  summarize: (i) => (i.busqueda ? `Buscar contactos «${i.busqueda}»` : "Ver contactos"),
  async run(ctx, input) {
    let q = ctx.supabase
    .from("contacts")
    .select("id, display_name, phone, email, lead_temperature, created_at")
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(LIMIT);
    const pattern = like(input.busqueda);
    if (pattern) q = q.or(`display_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`);
    const { data, error } = await q;
    return rowsOrNoAccess(data, error, "los contactos");
  },
};

const readConversations: PersonToolDefinition<{ contacto_id?: string }> = {
  key: "ver_conversaciones",
  label: "Ver conversaciones",
  description: "Lista las últimas conversaciones de la bandeja (de un contacto, si se da su id) con su estado y el último mensaje.",
  access: "read",
  permission: "contacts.view",
  params: z.object({ contacto_id: uuid.optional() }),
  fields: [],
  summarize: () => "Ver conversaciones",
  async run(ctx, input) {
    let q = ctx.supabase
    .from("conversations")
    .select("id, contact_id, status, last_message_at, last_message_preview, last_message_direction, unread_count")
    .eq("workspace_id", ctx.workspaceId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(LIMIT);
    if (input.contacto_id) q = q.eq("contact_id", input.contacto_id);
    const { data, error } = await q;
    return rowsOrNoAccess(data, error, "las conversaciones");
  },
};

// @plantilla-desde(tareas)
const readTasks: PersonToolDefinition<{ busqueda?: string }> = {
  key: "ver_tareas",
  label: "Ver tareas",
  description: "Lista tareas abiertas que la persona puede ver, con su estado y su fecha.",
  access: "read",
  permission: "tasks.view",
  params: z.object({ busqueda: search }),
  fields: [],
  summarize: () => "Ver tareas",
  async run(ctx, input) {
    let q = ctx.supabase
    .from("tasks")
    .select("id, title, status, due_date, priority")
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .neq("status", "completed")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(LIMIT);
    const pattern = like(input.busqueda);
    if (pattern) q = q.ilike("title", pattern);
    const { data, error } = await q;
    return rowsOrNoAccess(data, error, "las tareas");
  },
};
// @plantilla-hasta(tareas)

const readAgenda: PersonToolDefinition<{ contacto_id?: string }> = {
  key: "ver_agenda",
  label: "Ver la agenda",
  description: "Lista las próximas reuniones agendadas (de un contacto, si se da su id) que la persona puede ver.",
  access: "read",
  permission: "bookings.view",
  params: z.object({ contacto_id: uuid.optional() }),
  fields: [],
  summarize: () => "Ver la agenda",
  async run(ctx, input) {
    let q = ctx.supabase
    .from("bookings")
    .select("id, title, start_at, status, contact_id, host_user_id")
    .eq("workspace_id", ctx.workspaceId)
    .gte("start_at", new Date(Date.now() - 24 * 3_600_000).toISOString())
    .order("start_at", { ascending: true })
    .limit(LIMIT);
    if (input.contacto_id) q = q.eq("contact_id", input.contacto_id);
    const { data, error } = await q;
    return rowsOrNoAccess(data, error, "la agenda");
  },
};

// @plantilla-desde(servicios)
const readServices: PersonToolDefinition<{ contacto_id?: string }> = {
  key: "ver_servicios",
  label: "Ver servicios",
  description: "Lista servicios de clientes (de un contacto, si se da su id) con su estado.",
  access: "read",
  permission: "services.view",
  params: z.object({ contacto_id: uuid.optional() }),
  fields: [],
  summarize: () => "Ver servicios",
  async run(ctx, input) {
    let q = ctx.supabase
    .schema("app_servicio")
    .from("services")
    .select("id, contact_id, product_id, status, created_at")
    .eq("workspace_id", ctx.workspaceId)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
    if (input.contacto_id) q = q.eq("contact_id", input.contacto_id);
    const { data, error } = await q;
    return rowsOrNoAccess(data, error, "los servicios");
  },
};
// @plantilla-hasta(servicios)

const searchKnowledge: PersonToolDefinition<{ consulta: string }> = {
  key: "buscar_conocimiento",
  label: "Buscar en Conocimiento",
  description:
    "Busca en la base de conocimiento del negocio (documentos, PDFs, enlaces). Devuelve fragmentos con el documento y la página. Citá siempre de dónde sale lo que respondas.",
  access: "read",
  permission: "knowledge.view",
  params: z.object({ consulta: z.string().trim().min(2).max(300) }),
  fields: [],
  summarize: (i) => `Buscar «${i.consulta}» en Conocimiento`,
  async run(ctx, input) {
    const result = await searchKnowledgeForPerson(ctx, input.consulta);
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    if (result.chunks.length === 0) return { ok: false, code: "no_access", message: "No encontré nada sobre eso en Conocimiento." };
    return { ok: true, data: result.chunks, message: `${result.chunks.length} fragmento(s).` };
  },
};

// @plantilla-desde(tareas)
const createTask: PersonToolDefinition<{ titulo: string; descripcion?: string; fecha?: string; contacto_id?: string }> = {
  key: "crear_tarea",
  label: "Crear una tarea",
  description: "Crea una tarea a nombre de la persona (de un contacto, si se da su id). Queda propuesta hasta que la apruebe.",
  access: "write",
  permission: "tasks.edit",
  params: z.object({
    titulo: z.string().trim().min(1).max(200),
    descripcion: z.string().trim().max(2000).optional(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    contacto_id: uuid.optional(),
  }),
  fields: [
    { key: "titulo", label: "Título", kind: "text" },
    { key: "descripcion", label: "Descripción", kind: "textarea" },
    { key: "fecha", label: "Fecha", kind: "date" },
  ],
  summarize: (i) => `Crear la tarea «${i.titulo}»`,
  async run(ctx, input) {
    const result = await createTaskCore(
      { supabase: ctx.supabase as never, service: ctx.service as never, workspaceId: ctx.workspaceId, userId: ctx.userId, timeZone: ctx.timeZone, actorName: ctx.actorName },
      { title: input.titulo, description: input.descripcion ?? null, due_date: input.fecha ?? null, contact_id: input.contacto_id ?? null },
    );
    if (!result.ok) return { ok: false, code: result.code === "forbidden" ? "no_access" : "invalid", message: result.code === "forbidden" ? NO_ACCESS_MESSAGE : result.error };
    return { ok: true, message: "Tarea creada.", entityId: (result.data as { id?: string } | undefined)?.id ?? null };
  },
};
// @plantilla-hasta(tareas)

const createNote: PersonToolDefinition<{ contacto_id: string; texto: string }> = {
  key: "crear_nota",
  label: "Crear una nota",
  description: "Deja una nota interna en la ficha de un contacto. Queda propuesta hasta que la persona la apruebe.",
  access: "write",
  permission: "contacts.edit",
  params: z.object({ contacto_id: uuid, texto: z.string().trim().min(1).max(5000) }),
  fields: [{ key: "texto", label: "Nota", kind: "textarea" }],
  summarize: () => "Dejar una nota en la ficha",
  async run(ctx, input) {
    // Con la sesión de la persona: la RLS de contactos y de notas decide (igual que la ficha).
    const { data: contact } = await ctx.supabase.from("contacts").select("id").eq("id", input.contacto_id).eq("workspace_id", ctx.workspaceId).is("deleted_at", null).maybeSingle();
    if (!contact) return { ok: false, code: "no_access", message: NO_ACCESS_MESSAGE };
    const { data, error } = await ctx.supabase
    .from("contact_notes")
    .insert({ workspace_id: ctx.workspaceId, contact_id: input.contacto_id, content: input.texto, created_by: ctx.userId })
    .select("id")
    .single();
    if (error || !data) {
      console.error("[ai-tools] no pude guardar la nota:", error?.code ?? "?");
      return { ok: false, code: "failed", message: "No pude guardar la nota." };
    }
    return { ok: true, message: "Nota guardada.", entityId: (data as { id: string }).id };
  },
};

export const PERSON_TOOLS: readonly PersonToolDefinition<never>[] = [
  readContacts,
  readConversations,
  readTasks, // @plantilla-quitar(tareas)
  readAgenda,
  readServices, // @plantilla-quitar(servicios)
  searchKnowledge,
  createTask, // @plantilla-quitar(tareas)
  createNote,
] as unknown as readonly PersonToolDefinition<never>[];

/** Las que ofrece el asistente si nadie eligió otras: todas. */
export const DEFAULT_ASSISTANT_TOOL_KEYS: readonly string[] = PERSON_TOOLS.map((t) => t.key);

export function getPersonTool(key: string): PersonToolDefinition<unknown> | null {
  return (PERSON_TOOLS.find((t) => t.key === key) as PersonToolDefinition<unknown> | undefined) ?? null;
}

export type { PersonToolContext };
