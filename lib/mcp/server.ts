import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ALL_PERMISSION_KEYS, permissionLabel } from "@/lib/auth/permissions";
import type { PermissionContext } from "@/lib/auth/guards";
import { brandName } from "@/lib/brand";
import { actionModule, allActions, findAction, searchActions, visibleFor } from "./catalog";
import { executeCatalogAction, type McpActor } from "./execute";
import { fail, ok } from "./result";
import { findTable, loadTables } from "./schema";
import { planQuery, queryInputShape, runQuery } from "./query";
import { registerGuidedTools } from "./tools/guided";
import { addTool } from "./register";
import { switchConnectionWorkspace } from "./connections";

/**
 * El servidor MCP del sistema (docs/mcp.md). Uno nuevo por pedido (sin estado): cada herramienta corre dentro de
 * `runWithIdentity`, con la persona y el negocio de su conexión.
 *
 * Las herramientas son de tres tipos:
 *  - generales: el negocio, los permisos, las tablas, la consulta guiada, el SQL del Owner;
 *  - el catálogo: listar, describir y ejecutar CUALQUIER acción de la app (las mismas de los botones, con sus guards);
 *  - guiadas: atajos con buenos parámetros para lo más usado (subir a Conocimiento, mandar WhatsApp, agendar…).
 */

export interface McpEnv {
  ctx: PermissionContext;
  actor: McpActor;
  connectionId: string;
  clientName: string | null;
}

export const MCP_INSTRUCTIONS = `Este conector da acceso al sistema del negocio: CRM, bandeja de WhatsApp/Instagram/email, agenda, automatizaciones, contenido, broadcasts, la base de Conocimiento y los demás módulos que tenga este sistema.

Todo corre con los permisos de la persona conectada: si algo no aparece o da «no tenés acceso», es su rol.

Cómo trabajar:
1. Empezá por negocio_actual (y mis_permisos si dudás de lo que puede hacer).
2. Para leer datos: listar_tablas → describir_tabla → consultar (con columnas explícitas). Para análisis, agrupar_por y metricas. El Owner tiene además sql_owner (solo lectura).
3. Para hacer algo: primero fijate si hay una herramienta guiada; si no, listar_acciones (buscá por palabras) → describir_accion → ejecutar_accion.
4. Las acciones delicadas (borrar, enviar, invitar, permisos, publicar) devuelven primero un resumen y un token: mostrale el resumen a la persona y, solo si está de acuerdo, repetí la llamada con el token en «confirmacion».
5. Respondé en español rioplatense (vos). Las fechas de la base están en UTC; la persona las ve en su zona horaria.`;

function text(lines: (string | null | undefined)[]): CallToolResult {
  return { content: [{ type: "text", text: lines.filter((l) => l !== null && l !== undefined).join("\n") }] };
}

export function buildMcpServer(env: McpEnv): McpServer {
  const server = new McpServer({ name: brandName(), version: "1.0.0" }, { instructions: MCP_INSTRUCTIONS });
  const { ctx } = env;

  // ─── Negocio y permisos ─────────────────────────────────────────────────────────────────────────────────────
  addTool(
    server,
    "negocio_actual",
    {
      title: "Negocio actual",
      description: "El negocio en el que trabaja esta conexión, quién es la persona, su rol y su zona horaria.",
      annotations: { readOnlyHint: true },
    },
    async () =>
      ok({
        negocio: { id: ctx.workspace.id, nombre: ctx.workspace.name, zona_horaria_del_negocio: ctx.workspace.timezone ?? "UTC" },
        persona: { id: ctx.user.id, email: ctx.user.email ?? null, nombre: (ctx.user.user_metadata?.full_name as string | undefined) ?? null },
        rol: ctx.role,
        rol_personalizado: ctx.roleId,
        app_conectada: env.clientName,
      }),
  );

  addTool(
    server,
    "cambiar_negocio",
    {
      title: "Cambiar de negocio",
      description: "Pasa esta conexión a otro negocio donde la persona es miembro y tiene «Usar el MCP». Sin negocio_id, lista los disponibles. Vale desde el próximo pedido.",
      inputSchema: { negocio_id: z.string().uuid().optional() },
    },
    async ({ negocio_id }) => {
      const r = await switchConnectionWorkspace(env, negocio_id ?? null);
      return r.ok ? ok(r.data, r.message) : fail(r.message);
    },
  );

  addTool(
    server,
    "mis_permisos",
    {
      title: "Mis permisos",
      description: "Lo que el rol de la persona le deja hacer (claves y nombres) y sus alcances (todo / lo suyo).",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const keys = ALL_PERMISSION_KEYS.filter((k) => ctx.can(k));
      return ok({
        rol: ctx.role,
        permisos: keys.map((k) => ({ clave: k, nombre: permissionLabel(k) })),
        alcances: ctx.permissions.scopes,
      });
    },
  );

  // ─── Datos ──────────────────────────────────────────────────────────────────────────────────────────────────
  addTool(
    server,
    "listar_tablas",
    {
      title: "Listar tablas",
      description: "Las tablas que se pueden consultar (con su esquema). Filtrá con «buscar».",
      inputSchema: { buscar: z.string().max(80).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ buscar }) => {
      const tables = await loadTables();
      const q = (buscar ?? "").toLowerCase();
      const list = tables.filter((t) => !q || t.ref.includes(q) || (t.description ?? "").toLowerCase().includes(q));
      return ok(list.map((t) => ({ tabla: t.ref, columnas: t.columns.length, descripcion: t.description?.slice(0, 160) ?? null })));
    },
  );

  addTool(
    server,
    "describir_tabla",
    {
      title: "Describir una tabla",
      description: "Las columnas de una tabla, con su tipo. Usalo antes de consultar.",
      inputSchema: { tabla: z.string().min(1).max(120) },
      annotations: { readOnlyHint: true },
    },
    async ({ tabla }) => {
      const table = findTable(await loadTables(), tabla);
      if (!table) return fail(`No encuentro la tabla «${tabla}». Mirá listar_tablas.`);
      return ok({ tabla: table.ref, descripcion: table.description, columnas: table.columns });
    },
  );

  addTool(
    server,
    "consultar",
    {
      title: "Consultar datos",
      description:
        "Lee filas de una tabla con los permisos de la persona (la RLS decide qué ve). Columnas explícitas, filtros, orden y paginación; o agrupar_por + metricas para análisis (cuenta, suma, promedio…). Por defecto filtra por el negocio activo.",
      inputSchema: queryInputShape,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const table = findTable(await loadTables(), input.tabla);
      if (!table) return fail(`No encuentro la tabla «${input.tabla}». Mirá listar_tablas.`);
      const planned = planQuery(input, table);
      if (!planned.ok) return fail(planned.error);
      const r = await runQuery(ctx.supabase, planned.plan, ctx.workspace.id);
      if (!r.ok) return fail(r.error);
      const note = r.truncated
        ? planned.plan.groupBy.length > 0 || planned.plan.metrics.length > 0
          ? `Ojo: se analizaron las primeras ${r.scanned?.toLocaleString("es-ES")} filas; hay más. Filtrá para que el resultado sea exacto.`
          : `Hay más filas: seguí con desde = ${planned.plan.offset + planned.plan.limit}.`
        : undefined;
      return ok({ filas: r.rows, cantidad: r.rows.length }, note);
    },
  );

  addTool(
    server,
    "sql_owner",
    {
      title: "SQL de solo lectura (Owner)",
      description:
        "Solo el Owner del negocio. Una consulta SELECT o WITH, de solo lectura, con sus permisos (la RLS sigue mandando; no ve claves). Máximo 1.000 filas y 15 segundos. Filtrá por workspace_id si querés solo este negocio.",
      inputSchema: { consulta: z.string().min(1).max(20000) },
      annotations: { readOnlyHint: true },
    },
    async ({ consulta }) => {
      if (ctx.role !== "owner") return fail("Solo el Owner del negocio puede usar SQL. Usá consultar.");
      const { data, error } = await ctx.supabase.rpc("mcp_readonly_sql" as never, { p_workspace_id: ctx.workspace.id, p_query: consulta } as never);
      if (error) return fail(`La base respondió: ${error.message.replace(/^MCP_SQL_[A-Z]+:\s*/, "")}`);
      const rows = (data ?? []) as unknown[];
      return ok({ filas: rows, cantidad: rows.length }, rows.length === 1000 ? "Se devolvieron 1.000 filas (el máximo): puede haber más." : undefined);
    },
  );

  // ─── Catálogo de acciones ───────────────────────────────────────────────────────────────────────────────────
  addTool(
    server,
    "listar_acciones",
    {
      title: "Listar acciones",
      description: `Buscá entre las ${allActions().length} acciones de la app (todo lo que hacen los botones) las que la persona puede usar. Buscá por palabras en inglés del nombre (contact, booking, flow, role, knowledge…) o filtra por módulo.`,
      inputSchema: {
        buscar: z.string().max(120).optional(),
        modulo: z.string().max(60).optional().describe("Por ejemplo: contacts, scheduling, flows, knowledge, roles."),
        tipo: z.enum(["read", "write", "sensitive"]).optional(),
        limite: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ buscar, modulo, tipo, limite }) => {
      const found = searchActions(visibleFor(ctx.can), buscar, modulo).filter((a) => !tipo || a.kind === tipo);
      const max = limite ?? 60;
      const modules = [...new Set(visibleFor(ctx.can).map(actionModule))].sort();
      return ok(
        {
          total: found.length,
          acciones: found.slice(0, max).map((a) => ({ id: a.id, tipo: a.kind, permisos: a.permissions, descripcion: a.description.slice(0, 160) || null })),
          ...(buscar || modulo ? {} : { modulos: modules }),
        },
        found.length > max ? `Se muestran ${max} de ${found.length}: afiná la búsqueda o subí el límite.` : undefined,
      );
    },
  );

  addTool(
    server,
    "describir_accion",
    {
      title: "Describir una acción",
      description: "Qué hace una acción, qué argumentos recibe (en orden, con su forma completa), qué devuelve y si es delicada.",
      inputSchema: { accion: z.string().min(1).max(200) },
      annotations: { readOnlyHint: true },
    },
    async ({ accion }) => {
      const a = findAction(accion);
      if (!a) return fail(`No existe la acción «${accion}». Mirá listar_acciones.`);
      return ok({
        id: a.id,
        tipo: a.kind,
        delicada: a.kind === "sensitive",
        permisos: a.permissions,
        descripcion: a.description || null,
        argumentos: a.params.map((p, i) => ({ posicion: i, nombre: p.name, opcional: p.optional, forma: p.type })),
        devuelve: a.returns,
        como_llamarla: `ejecutar_accion { accion: "${a.id}", argumentos: [${a.params.map((p) => `<${p.name}>`).join(", ")}] }`,
        archivos: a.params.some((p) => p.type === "FormData")
          ? "Un parámetro FormData se manda como objeto { campo: valor }; un archivo como { nombre, tipo, base64 } o { url }."
          : undefined,
      });
    },
  );

  addTool(
    server,
    "ejecutar_accion",
    {
      title: "Ejecutar una acción",
      description:
        "Ejecuta una acción de la app como si la persona tocara el botón (mismos permisos y validaciones). Los argumentos van en una lista, en el orden de describir_accion. Si es delicada, la primera llamada devuelve un resumen y un token: repetí con el token en «confirmacion» solo si la persona está de acuerdo.",
      inputSchema: {
        accion: z.string().min(1).max(200),
        argumentos: z.array(z.unknown()).max(10).optional(),
        confirmacion: z.string().max(200).optional(),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ accion, argumentos, confirmacion }) => executeCatalogAction(env.actor, accion, argumentos ?? [], confirmacion),
  );

  registerGuidedTools(server, env);

  return server;
}

export { text as mcpText };
