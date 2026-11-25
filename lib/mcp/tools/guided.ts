import "server-only";
import { NextRequest } from "next/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { appUrl } from "@/lib/app-url";
import { isAdminRole } from "@/lib/auth/roles";
import { confirmGate, executeCatalogAction } from "../execute";
import { fileFromInput } from "../files";
import { fail, nextNavigationMessage, ok } from "../result";
import type { McpEnv } from "../server";
import { addTool } from "../register";

/**
 * Herramientas guiadas del MCP (docs/mcp.md): atajos con parámetros claros para lo más usado. Por dentro llaman a las
 * MISMAS acciones o rutas que usa la app (`executeCatalogAction` o el handler de la ruta), así que los permisos, las
 * validaciones y la confirmación de lo delicado son los de siempre.
 */

const uuid = z.string().uuid();
const fileShape = z
  .object({ nombre: z.string().max(200).optional(), tipo: z.string().max(120).optional(), base64: z.string().optional(), url: z.string().url().optional() })
  .describe("El archivo: { nombre, tipo, base64 } o { url } (una dirección pública).");

/** Llama a un handler de `app/api/v1` en el mismo proceso, con la misma identidad (sin pasar por la red). */
async function callRoute(
  handler: (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>,
  path: string,
  body: unknown,
  params: Record<string, string> = {},
): Promise<{ status: number; data: unknown }> {
  const req = new NextRequest(new URL(path, appUrl()), { method: "POST", body: JSON.stringify(body ?? {}), headers: { "Content-Type": "application/json" } });
  const res = await handler(req, { params: Promise.resolve(params) });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

function routeResult(r: { status: number; data: unknown }, okNote?: string): CallToolResult {
  if (r.status >= 200 && r.status < 300) return ok(r.data, okNote);
  const msg = (r.data as { error?: string } | null)?.error ?? `La app respondió ${r.status}.`;
  return fail(msg, r.data && typeof r.data === "object" ? (r.data as Record<string, unknown>) : undefined);
}

export function registerGuidedTools(server: McpServer, env: McpEnv): void {
  const { ctx } = env;

  // ─── Conocimiento ───────────────────────────────────────────────────────────────────────────────────────────
  addTool(
    server,
    "subir_documento_conocimiento",
    {
      title: "Subir un documento a Conocimiento",
      description:
        "Sube un documento (PDF, Word, texto, Markdown…) a la base de Conocimiento. Se vectoriza solo; si Voyage no está conectado queda «pendiente» hasta conectarlo. Para un texto que tenés en la conversación, mandalo como archivo .md en base64.",
      inputSchema: { archivo: fileShape, titulo: z.string().max(200).optional() },
    },
    async ({ archivo, titulo }) => {
      let file: File;
      try {
        file = await fileFromInput(archivo);
      } catch (err) {
        return fail(err instanceof Error ? err.message : "No pude leer el archivo.");
      }
      const form = { file: { nombre: file.name, tipo: file.type, base64: Buffer.from(await file.arrayBuffer()).toString("base64") }, ...(titulo ? { title: titulo } : {}) };
      return executeCatalogAction(env.actor, "knowledge#uploadDocument", [form], undefined);
    },
  );

  addTool(
    server,
    "estado_documentos",
    {
      title: "Estado de los documentos de Conocimiento",
      description: "Los últimos documentos de Conocimiento con su estado de indexación (processing, pending, ready, error).",
      inputSchema: { buscar: z.string().max(120).optional(), limite: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ buscar, limite }) => {
      let q = ctx.supabase.from("knowledge_base").select("id, title, status, error_detail, chunk_count, indexed_at, created_at").eq("workspace_id", ctx.workspace.id).is("deleted_at", null).order("created_at", { ascending: false }).limit(limite ?? 20);
      const clean = (buscar ?? "").replace(/[%_,()]/g, " ").trim();
      if (clean) q = q.ilike("title", `%${clean}%`);
      const { data, error } = await q;
      return error ? fail(`La base respondió: ${error.message}`) : ok(data);
    },
  );

  // @plantilla-desde(llamadas)
  // ─── Reuniones grabadas ─────────────────────────────────────────────────────────────────────────────────────
  addTool(
    server,
    "reuniones_sin_analizar",
    {
      title: "Reuniones sin analizar",
      description: "Grabaciones sin analizar (pendientes, por revisar la clasificación, clasificándose o con error), las más nuevas primero (solo las que la persona ve).",
      inputSchema: { limite: z.number().int().min(1).max(200).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ limite }) => {
      const { data, error } = await ctx.supabase
        .from("calls")
        .select("id, title, recorded_at, analysis_status, analysis_status_reason, contact_id")
        .eq("workspace_id", ctx.workspace.id)
        .in("analysis_status", ["pending", "needs_review", "error", "classifying"])
        .order("recorded_at", { ascending: false })
        .limit(limite ?? 50);
      return error ? fail(`La base respondió: ${error.message}`) : ok({ reuniones: data, cantidad: (data ?? []).length });
    },
  );

  addTool(
    server,
    "analizar_reuniones",
    {
      title: "Analizar reuniones",
      description: "Pone a analizar las reuniones indicadas (o todas las pendientes si no se indica ninguna). El análisis corre en segundo plano y gasta IA.",
      inputSchema: { reunion_ids: z.array(uuid).max(200).optional() },
    },
    async ({ reunion_ids }) =>
      reunion_ids && reunion_ids.length > 0
        ? executeCatalogAction(env.actor, "calls-edit#analyzeSelectedCalls", [{ callIds: reunion_ids }], undefined)
        : executeCatalogAction(env.actor, "calls-edit#analyzePendingCalls", [], undefined),
  );

  // @plantilla-hasta(llamadas)

  // ─── Agenda ─────────────────────────────────────────────────────────────────────────────────────────────────
  addTool(
    server,
    "agendar_reunion",
    {
      title: "Agendar una reunión",
      description:
        "Agenda una reunión a mano (como «Agendar» en la Agenda). Con evento (event_type_id) o con título libre. Fecha YYYY-MM-DD y hora HH:mm en «zona» (por defecto la del negocio). El contacto por contacto_id o por nombre + email/teléfono.",
      inputSchema: {
        evento_id: uuid.optional(),
        titulo: z.string().max(200).optional(),
        fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hora: z.string().regex(/^\d{2}:\d{2}$/),
        duracion_minutos: z.number().int().min(5).max(600).optional(),
        zona: z.string().max(60).optional(),
        contacto_id: uuid.optional(),
        nombre: z.string().max(200).optional(),
        email: z.string().email().optional(),
        telefono: z.string().max(40).optional(),
        notas: z.string().max(5000).optional(),
        google_meet: z.boolean().optional(),
        anfitrion_id: uuid.optional(),
      },
    },
    async (i) =>
      executeCatalogAction(
        env.actor,
        "scheduling/bookings#bookManuallyQuick",
        [
          {
            eventTypeId: i.evento_id ?? null,
            title: i.titulo,
            hostUserId: i.anfitrion_id ?? null,
            date: i.fecha,
            time: i.hora,
            durationMinutes: i.duracion_minutos,
            timezone: i.zona ?? ctx.workspace.timezone ?? "UTC",
            contactId: i.contacto_id ?? null,
            name: i.nombre,
            email: i.email,
            phone: i.telefono,
            notes: i.notas,
            location: i.google_meet ? { kind: "google_meet" } : null,
          },
        ],
        undefined,
      ),
  );

  addTool(
    server,
    "mover_reunion",
    {
      title: "Mover una reunión",
      description: "Cambia la hora de una reunión (inicio en UTC, ISO 8601). Avisa a los invitados como desde la Agenda.",
      inputSchema: { reunion_id: uuid, inicio_utc: z.string().datetime(), duracion_minutos: z.number().int().min(5).max(600).optional(), motivo: z.string().max(500).optional(), ignorar_disponibilidad: z.boolean().optional() },
    },
    async (i) =>
      executeCatalogAction(env.actor, "scheduling/bookings#rescheduleAsHost", [{ bookingId: i.reunion_id, startUtc: i.inicio_utc, durationMinutes: i.duracion_minutos, reason: i.motivo ?? null, ignoreAvailability: i.ignorar_disponibilidad }], undefined),
  );

  // ─── Mensajes ───────────────────────────────────────────────────────────────────────────────────────────────
  addTool(
    server,
    "enviar_whatsapp",
    {
      title: "Enviar un mensaje (WhatsApp u otro canal)",
      description:
        "Manda un texto a una o varias conversaciones (o contactos: se usa su conversación de WhatsApp más reciente), como desde la bandeja: respeta los permisos por cuenta, «no contactar» y el tope del número. Delicada: pide confirmación.",
      inputSchema: {
        destinatarios: z.array(z.object({ conversacion_id: uuid.optional(), contacto_id: uuid.optional() })).min(1).max(100),
        texto: z.string().min(1).max(4000),
        confirmacion: z.string().max(200).optional(),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ destinatarios, texto, confirmacion }) => {
      const gate = await confirmGate(env.actor, { id: "mensajes#enviar", description: `Mandar este texto a ${destinatarios.length} conversación(es).` }, [{ destinatarios, texto }], confirmacion);
      if (gate) return gate;
      const { POST } = await import("@/app/api/v1/messages/route");
      const results: { destinatario: unknown; ok: boolean; detalle: unknown }[] = [];
      for (const d of destinatarios) {
        let conversationId = d.conversacion_id ?? null;
        if (!conversationId && d.contacto_id) {
          const { data } = await ctx.supabase
            .from("conversations")
            .select("id, channels!inner(provider)")
            .eq("workspace_id", ctx.workspace.id)
            .eq("contact_id", d.contacto_id)
            .eq("channels.provider", "evolution")
            .order("last_message_at", { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();
          conversationId = (data as { id: string } | null)?.id ?? null;
        }
        if (!conversationId) {
          results.push({ destinatario: d, ok: false, detalle: "No encontré una conversación de WhatsApp de ese contacto que puedas ver." });
          continue;
        }
        try {
          const r = await callRoute(POST as never, "/api/v1/messages", { conversationId, text: texto });
          results.push({ destinatario: d, ok: r.status >= 200 && r.status < 300, detalle: r.status >= 200 && r.status < 300 ? "enviado" : r.data });
        } catch (err) {
          results.push({ destinatario: d, ok: false, detalle: nextNavigationMessage(err) ?? "falló" });
        }
      }
      const sent = results.filter((r) => r.ok).length;
      return ok({ enviados: sent, fallidos: results.length - sent, resultados: results });
    },
  );

  addTool(
    server,
    "enviar_a_grupo",
    {
      title: "Enviar a un grupo de WhatsApp",
      description: "Manda un texto a un grupo de WhatsApp de la bandeja (id de whatsapp_groups). Delicada: pide confirmación.",
      inputSchema: { grupo_id: uuid, texto: z.string().min(1).max(4000), confirmacion: z.string().max(200).optional() },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ grupo_id, texto, confirmacion }) => executeCatalogAction(env.actor, "whatsapp-group-inbox#sendGroupMessage", [grupo_id, { text: texto }], confirmacion),
  );

  // ─── Automatizaciones ───────────────────────────────────────────────────────────────────────────────────────
  addTool(
    server,
    "crear_automatizacion",
    {
      title: "Crear una automatización",
      description:
        "Crea una automatización nueva (queda en borrador, no corre hasta publicarla). Sin nodos, nace con el disparador por elegir; con nodos y aristas, con ese grafo (mismo formato que el lienzo: mira una existente con consultar sobre «flows»).",
      inputSchema: {
        nombre: z.string().min(1).max(120),
        descripcion: z.string().max(1000).optional(),
        categorias: z.array(z.string().max(40)).max(10).optional(),
        nodos: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
        aristas: z.array(z.record(z.string(), z.unknown())).max(400).optional(),
      },
    },
    async (i) => {
      const { POST } = await import("@/app/api/v1/flows/route");
      return routeResult(await callRoute(POST as never, "/api/v1/flows", { name: i.nombre, description: i.descripcion, categories: i.categorias, nodes: i.nodos, edges: i.aristas }), "Automatización creada (en borrador). Para editarla: flows#saveFlowDraft; para que corra: publicar_automatizacion.");
    },
  );

  addTool(
    server,
    "publicar_automatizacion",
    {
      title: "Publicar una automatización",
      description: "Publica una automatización: desde ese momento corre sola con clientes reales. Comprueba lo mismo que el botón Publicar. Delicada: pide confirmación.",
      inputSchema: { automatizacion_id: uuid, nota: z.string().max(280).optional(), confirmacion: z.string().max(200).optional() },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ automatizacion_id, nota, confirmacion }) => {
      const gate = await confirmGate(env.actor, { id: "flows#publicar", description: "Publicar la automatización: empieza a correr con clientes reales." }, [{ automatizacion_id, nota: nota ?? null }], confirmacion);
      if (gate) return gate;
      const { POST } = await import("@/app/api/v1/flows/[flowId]/publish/route");
      return routeResult(await callRoute(POST as never, `/api/v1/flows/${automatizacion_id}/publish`, { note: nota }, { flowId: automatizacion_id }), "Publicada.");
    },
  );

  // ─── Equipo y permisos ──────────────────────────────────────────────────────────────────────────────────────
  addTool(
    server,
    "ver_roles",
    {
      title: "Ver roles y sus permisos",
      description: "Los roles del negocio con sus permisos y alcances (los de sistema Owner/Admin/Member salen del código).",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { data, error } = await ctx.supabase.from("workspace_roles").select("id, name, description, system_role, permissions, updated_at").eq("workspace_id", ctx.workspace.id).order("name");
      return error ? fail(`La base respondió: ${error.message}`) : ok(data);
    },
  );

  addTool(
    server,
    "cambiar_permisos_rol",
    {
      title: "Cambiar los permisos de un rol",
      description: "Suma o quita claves de permiso a un rol personalizado (mira mis_permisos / ver_roles para las claves). Nadie da lo que no tiene. Delicada: pide confirmación.",
      inputSchema: { rol_id: uuid, agregar: z.array(z.string().max(80)).max(150).optional(), quitar: z.array(z.string().max(80)).max(150).optional(), confirmacion: z.string().max(200).optional() },
      annotations: { destructiveHint: true },
    },
    async ({ rol_id, agregar, quitar, confirmacion }) => executeCatalogAction(env.actor, "roles#patchRole", [rol_id, { addKeys: agregar ?? [], removeKeys: quitar ?? [] }], confirmacion),
  );

  addTool(
    server,
    "invitar_persona",
    {
      title: "Invitar a alguien al equipo",
      description: "Invita a una persona con un rol (rol_id de ver_roles). «email» manda la invitación por correo; «link» solo devuelve el link. Delicada: pide confirmación.",
      inputSchema: { email: z.string().email(), rol_id: uuid, envio: z.enum(["email", "link"]).optional(), confirmacion: z.string().max(200).optional() },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ email, rol_id, envio, confirmacion }) => executeCatalogAction(env.actor, "team#inviteTeamMember", [{ email, roleId: rol_id, delivery: envio ?? "email" }], confirmacion),
  );

  // ─── Errores del sistema ────────────────────────────────────────────────────────────────────────────────────
  addTool(
    server,
    "errores_del_sistema",
    {
      title: "Errores del sistema",
      description: "Solo Owner y Admin. Lo que falló en las últimas horas: mensajes que no salieron, pasos de automatizaciones, corridas de IA y emails.",
      inputSchema: { horas: z.number().int().min(1).max(24 * 30).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ horas }) => {
      if (!isAdminRole(ctx.role)) return fail("Solo Owner y Admin ven los errores del sistema.");
      const since = new Date(Date.now() - (horas ?? 24) * 3_600_000).toISOString();
      const ws = ctx.workspace.id;
      const db = ctx.supabase;
      const flowIds = ((await db.from("flows").select("id, name").eq("workspace_id", ws)).data ?? []) as { id: string; name: string }[];
      const flowName = new Map(flowIds.map((f) => [f.id, f.name]));
      const [messages, steps, runs, emails] = await Promise.all([
        db.from("messages").select("id, conversation_id, send_error, created_at").eq("workspace_id", ws).eq("status", "failed").gte("created_at", since).order("created_at", { ascending: false }).limit(50),
        flowIds.length
          ? db.from("flow_session_steps").select("flow_id, node_type, reason, error_kind, finished_at").in("flow_id", flowIds.map((f) => f.id)).eq("status", "failed").gte("finished_at", since).order("finished_at", { ascending: false }).limit(50)
          : Promise.resolve({ data: [], error: null }),
        db.from("agent_runs").select("source, status, error, created_at").eq("workspace_id", ws).not("error", "is", null).gte("created_at", since).order("created_at", { ascending: false }).limit(50),
        db.from("email_log").select("kind, status, last_error, created_at").eq("workspace_id", ws).eq("status", "failed").gte("created_at", since).order("created_at", { ascending: false }).limit(50),
      ]);
      return ok({
        desde: since,
        mensajes_fallidos: messages.error ? { error: messages.error.message } : messages.data,
        pasos_de_automatizaciones_fallidos: steps.error ? { error: steps.error.message } : ((steps.data ?? []) as { flow_id: string }[]).map((s) => ({ ...s, automatizacion: flowName.get(s.flow_id) ?? null })),
        corridas_de_ia_con_error: runs.error ? { error: runs.error.message } : runs.data,
        emails_fallidos: emails.error ? { error: emails.error.message } : emails.data,
      });
    },
  );
}
