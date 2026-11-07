/**
 * El núcleo de las Server Actions del editor (DS2): crear, guardar con `rev`, renombrar, duplicar, archivar,
 * borrar, versiones y la configuración de una plantilla.
 *
 * Recibe el cliente de SERVICIO ya creado (y el negocio y la persona que salen de la SESIÓN, nunca del navegador) y
 * escribe filtrando siempre por ese negocio: las tablas no tienen políticas de escritura. El permiso lo chequea la
 * acción (`getPermissionAction`) ANTES de llamar acá. Todo devuelve un resultado y nunca lanza hacia la pantalla.
 *
 * Nada de esto encola un render: guardar una versión no pide nada al servicio de render (F48).
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";
import type { Database, Json } from "@/lib/types/database";
import type { ActionResult, CreateDesignInput, DesignKind } from "./contracts";
import { parseDesignDoc, type DesignDoc } from "./doc/schema";
import { formatsForNew, isFormatKey, type FormatKey } from "./formats";
import { pathBelongsTo } from "./storage";
import { aiStartDoc, blankDoc, defaultName, imageDoc } from "./screens/starter-docs";
import { findStyle, type DesignStyle } from "./styles";

export type Db = SupabaseClient<Database>;

export interface Actor {
  workspaceId: string;
  userId: string;
}

export interface CoreEnv {
  service: Db;
  actor: Actor;
  now?: () => Date;
}

export const MAX_DESIGN_NAME = 200;
export const MAX_TEMPLATE_NAME = 120;

export function hrefFor(kind: DesignKind, id: string): string {
  return kind === "template" ? `/dashboard/disenos/t/${id}` : `/dashboard/disenos/d/${id}`;
}

export function tableFor(kind: DesignKind): "design_templates" | "designs" {
  return kind === "template" ? "design_templates" : "designs";
}

/** El largo máximo del nombre según el tipo (lo mismo que los CHECK de la base). */
export function maxNameLength(kind: DesignKind): number {
  return kind === "template" ? MAX_TEMPLATE_NAME : MAX_DESIGN_NAME;
}

/** Valida y limpia un nombre. `null` = el texto está vacío o es demasiado largo. */
export function cleanName(raw: unknown, kind: DesignKind): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  return name.length >= 1 && name.length <= maxNameLength(kind) ? name : null;
}

/** Las imágenes que sube el editor van siempre a `<ws>/images/…`: una ruta de otra carpeta (o de otro negocio) no sirve. */
export function isOwnImagePath(path: unknown, workspaceId: string): path is string {
  return typeof path === "string" && pathBelongsTo(path, workspaceId) && path.startsWith(`${workspaceId}/images/`) && path.length <= 500;
}

function asJson(value: unknown): Json {
  return value as Json;
}

/** Guarda una versión (solo el documento). Nunca hace fallar a quien la pide: si no se pudo, se loguea. */
export async function insertVersion(
  env: CoreEnv,
  target: { kind: DesignKind; id: string },
  doc: DesignDoc,
  reason: "ai" | "manual" | "publish" | "restore" | "generate" | "import",
): Promise<boolean> {
  const { error } = await env.service.from("design_versions").insert({
    workspace_id: env.actor.workspaceId,
    template_id: target.kind === "template" ? target.id : null,
    design_id: target.kind === "design" ? target.id : null,
    doc: asJson(doc),
    reason,
    author_kind: "user",
    author_id: env.actor.userId,
    created_by: env.actor.userId,
  });
  if (error) {
    console.error("[designer] no pude guardar la versión:", error.code ?? "error");
    return false;
  }
  return true;
}

export interface CreateContext {
  /** El color de la marca del negocio (#rrggbb). */
  brandColor: string | null;
  /** Los estilos propios del negocio (de `design_settings`). */
  customStyles: readonly DesignStyle[];
}

export type CreateCoreResult = { ok: true; data: { id: string; kind: DesignKind; href: string; doc: DesignDoc } } | { ok: false; error: string };

/**
 * Crea un diseño o una plantilla (F16). «Con IA», «Desde una imagen» y «En blanco» crean acá; «Cargar HTML» lo
 * hace `importHtml` (DS4) y por eso no entra. «Con IA» deja una página vacía con el color de la marca: el pedido
 * lo hace la acción con `startAiDesign` (DS3), así el diseño queda creado aunque la IA no responda.
 */
export async function createDesignCore(env: CoreEnv, input: CreateDesignInput, ctx: CreateContext): Promise<CreateCoreResult> {
  if (input.kind !== "design" && input.kind !== "template") return { ok: false, error: "Elegí si es un diseño o una plantilla." };
  if (input.origin === "html") return { ok: false, error: "Un archivo HTML se carga con «Cargar un archivo HTML»." };
  if (input.origin !== "ai" && input.origin !== "image" && input.origin !== "blank") return { ok: false, error: "Elegí cómo empezás." };
  if (!isFormatKey(input.format)) return { ok: false, error: "Elegí un formato." };
  const multiPage = input.multiPage === true;
  if (!formatsForNew({ multiPage, template: input.kind === "template" }).includes(input.format)) {
    return { ok: false, error: input.kind === "template" ? "Una plantilla no puede ser una página web." : "Una página web tiene una sola página." };
  }

  let name = defaultName(input.kind);
  if (input.name !== undefined && input.name !== "") {
    const cleaned = cleanName(input.name, input.kind);
    if (!cleaned) return { ok: false, error: `El nombre va de 1 a ${maxNameLength(input.kind)} caracteres.` };
    name = cleaned;
  }

  let style: string | null = null;
  if (input.style) {
    if (!findStyle(input.style, ctx.customStyles)) return { ok: false, error: "Ese estilo no existe." };
    style = input.style;
  }

  const opts = { brandColor: ctx.brandColor, multiPage, style };
  let doc: DesignDoc;
  if (input.origin === "ai") {
    doc = aiStartDoc(input.format as FormatKey, opts);
  } else if (input.origin === "image") {
    if (!isOwnImagePath(input.baseImagePath, env.actor.workspaceId)) return { ok: false, error: "Subí la imagen base para seguir." };
    doc = imageDoc(input.format as FormatKey, input.baseImagePath, opts);
  } else {
    doc = blankDoc(input.format as FormatKey, opts);
  }
  const parsed = parseDesignDoc(doc);
  if (!parsed.ok) {
    console.error("[designer] el documento de arranque no valida:", parsed.problems.join(" | "));
    return { ok: false, error: "No pudimos armar el diseño. Probá de nuevo." };
  }

  const table = tableFor(input.kind);
  const row = { workspace_id: env.actor.workspaceId, name, format: input.format, doc: asJson(parsed.doc), origin: input.origin, style, created_by: env.actor.userId };
  const { data, error } = await env.service.from(table).insert(row as never).select("id").single();
  if (error || !data) {
    console.error("[designer] no pude crear el diseño:", error?.code ?? "sin fila");
    return { ok: false, error: "No pudimos crear el diseño. Probá de nuevo." };
  }
  const id = (data as { id: string }).id;
  await insertVersion(env, { kind: input.kind, id }, parsed.doc, "manual");
  await logAudit({
    supabase: env.service,
    workspaceId: env.actor.workspaceId,
    entityType: input.kind === "template" ? "design_template" : "design",
    entityId: id,
    action: "create",
    metadata: { origin: input.origin, format: input.format },
    performedBy: env.actor.userId,
  });
  return { ok: true, data: { id, kind: input.kind, href: hrefFor(input.kind, id), doc: parsed.doc } };
}

export type { ActionResult };
