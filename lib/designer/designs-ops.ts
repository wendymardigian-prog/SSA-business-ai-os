/**
 * Las operaciones del editor sobre un diseño o una plantilla ya creados (DS2): guardar con `rev`, renombrar, duplicar,
 * archivar, borrar, versiones, restaurar y la configuración de una plantilla.
 *
 * Mismas reglas que `designs-core.ts`: recibe el cliente de SERVICIO y la persona y el negocio de la SESIÓN, escribe
 * siempre filtrando por ese negocio y devuelve un resultado (nunca lanza hacia la pantalla). El permiso lo chequea la
 * acción ANTES de llamar acá. Nada de esto encola un render (F48).
 *
 * Solo servidor.
 */

import { logAudit } from "@/lib/audit";
import type { Json } from "@/lib/types/database";
import type { ActionResult, DesignKind, SaveDocResult, TemplateSettingsInput, VersionSummary } from "./contracts";
import { asJson, cleanName, hrefFor, insertVersion, maxNameLength, tableFor, type CoreEnv, type Db } from "./designs-core";
import { parseDesignDoc, type DesignDoc } from "./doc/schema";
import { isFormatKey } from "./formats";
import { archiveDecision, deleteBlockers, formatChangeOutcome } from "./screens/config";
import { convertDocFormat } from "./screens/format-change";
import { validateCustomVars } from "./screens/variables";
import { DOC_TYPES, validateTemplateVerification } from "./verification";
import { shouldSnapshotManual } from "./versions";

type Target = { kind: DesignKind; id: string };

function entityOf(kind: DesignKind): "design" | "design_template" {
  return kind === "template" ? "design_template" : "design";
}

/** Una consulta sobre la fila de ESTE negocio: el negocio sale de la sesión, nunca del navegador. */
type Eqable = { eq(column: string, value: string): Eqable };
function mine<Q>(query: Q, env: CoreEnv, id: string): Q {
  return (query as unknown as Eqable).eq("id", id).eq("workspace_id", env.actor.workspaceId) as unknown as Q;
}

const nowOf = (env: CoreEnv) => (env.now ?? (() => new Date()))();

// ─── Guardar con `rev` (F27) ─────────────────────────────────────────────────

export interface SaveInput extends Target {
  doc: unknown;
  rev: number;
  /** Plantillas: las variables propias, guardadas junto con el documento (se validan acá: la base no lo hace). */
  customVars?: unknown;
}

/**
 * Guarda el documento con control de versión: `UPDATE … WHERE rev = $rev`. Si no actualiza nada, otra persona (u otra
 * pestaña) guardó antes: responde `conflict` con lo vigente y la pantalla ofrece «Recargar»; nunca pisa en silencio.
 *
 * Después de guardar deja una versión SOLO si pasaron 10 minutos desde la última de edición manual. No encola nada.
 */
export async function saveDocCore(env: CoreEnv, input: SaveInput): Promise<SaveDocResult> {
  if (!Number.isInteger(input.rev) || input.rev < 0) return { ok: false, error: "No sabemos con qué versión estabas trabajando. Recargá la página." };
  const parsed = parseDesignDoc(input.doc);
  if (!parsed.ok) return { ok: false, error: `El diseño no se pudo guardar: ${parsed.problems.slice(0, 3).join(" · ")}` };
  const table = tableFor(input.kind);

  const { data: row, error: readError } = await mine(env.service.from(table).select("format"), env, input.id).maybeSingle();
  if (readError) {
    console.error("[designer] no pude leer para guardar:", readError.code ?? "error");
    return { ok: false, error: "No pudimos guardar. Probá de nuevo." };
  }
  if (!row) return { ok: false, error: "No encontramos este diseño." };

  if (input.kind === "template" && parsed.doc.format !== (row as { format: string }).format) return { ok: false, error: "El formato de una plantilla se cambia desde Configuración." };
  const update: Record<string, unknown> = { doc: asJson(parsed.doc), format: parsed.doc.format, rev: input.rev + 1 };
  if (input.customVars !== undefined) {
    if (input.kind !== "template") return { ok: false, error: "Solo una plantilla tiene variables propias." };
    const vars = validateCustomVars(input.customVars);
    if (!vars.ok) return { ok: false, error: vars.error };
    update.custom_vars = asJson(vars.list);
  }

  const { data: saved, error } = await mine(env.service.from(table).update(update as never), env, input.id).eq("rev", input.rev).select("rev").maybeSingle();
  if (error) {
    console.error("[designer] no pude guardar el documento:", error.code ?? "error");
    return { ok: false, error: error.code === "22023" ? "El diseño no tiene la forma esperada." : "No pudimos guardar. Probá de nuevo." };
  }
  if (!saved) {
    // Nadie actualizó: la `rev` estaba vieja. Se devuelve lo vigente para que la pantalla ofrezca «Recargar».
    const { data: live } = await mine(env.service.from(table).select("rev, doc"), env, input.id).maybeSingle();
    const latest = live as { rev: number; doc: Json } | null;
    const doc = latest ? parseDesignDoc(latest.doc) : null;
    if (latest && doc?.ok) return { ok: false, conflict: true, current: { doc: doc.doc, rev: latest.rev } };
    return { ok: false, error: "Alguien más cambió este diseño. Recargá la página para ver lo último." };
  }

  await snapshotManualIfDue(env, input, parsed.doc);
  return { ok: true, rev: (saved as { rev: number }).rev };
}

/** Deja una versión manual si pasaron 10 minutos desde la última. Nunca hace fallar el guardado. */
async function snapshotManualIfDue(env: CoreEnv, target: Target, doc: DesignDoc): Promise<void> {
  try {
    const column = target.kind === "template" ? "template_id" : "design_id";
    const { data } = await env.service
      .from("design_versions")
      .select("created_at")
      .eq("workspace_id", env.actor.workspaceId)
      .eq(column, target.id)
      .eq("reason", "manual")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const last = (data as { created_at: string } | null)?.created_at ?? null;
    if (shouldSnapshotManual(last, nowOf(env))) await insertVersion(env, target, doc, "manual");
  } catch (error) {
    console.error("[designer] no pude revisar las versiones:", error instanceof Error ? error.message : "error");
  }
}

// ─── Renombrar y duplicar ────────────────────────────────────────────────────

export async function renameCore(env: CoreEnv, target: Target, rawName: unknown): Promise<ActionResult> {
  const name = cleanName(rawName, target.kind);
  if (!name) return { ok: false, error: `El nombre va de 1 a ${maxNameLength(target.kind)} caracteres.` };
  const table = tableFor(target.kind);
  const { data: row } = await mine(env.service.from(table).select("name"), env, target.id).maybeSingle();
  if (!row) return { ok: false, error: "No encontramos este diseño." };
  const before = (row as { name: string }).name;
  if (before === name) return { ok: true, data: undefined };
  const { error } = await mine(env.service.from(table).update({ name } as never), env, target.id);
  if (error) {
    console.error("[designer] no pude renombrar:", error.code ?? "error");
    return { ok: false, error: "No pudimos cambiar el nombre. Probá de nuevo." };
  }
  await logAudit({ supabase: env.service, workspaceId: env.actor.workspaceId, entityType: entityOf(target.kind), entityId: target.id, action: "update", changes: { name: { old: before, new: name } }, performedBy: env.actor.userId });
  return { ok: true, data: undefined };
}

/** «Nombre (copia)», sin pasarse del largo que admite la base. */
export function copyName(name: string, kind: DesignKind): string {
  const suffix = " (copia)";
  const max = maxNameLength(kind);
  return `${name.length + suffix.length > max ? name.slice(0, max - suffix.length).trimEnd() : name}${suffix}`;
}

/** Duplica: una copia propia, sin publicar, sin código, sin vínculos ni historial. Una pieza emitida se duplica como diseño propio. */
export async function duplicateCore(env: CoreEnv, target: Target): Promise<ActionResult<{ id: string; href: string }>> {
  const table = tableFor(target.kind);
  const columns = target.kind === "template" ? "name, format, doc, origin, style, custom_vars, date_format, verify, doc_type, doc_type_label, allow_download" : "name, format, doc, origin, style, allow_download, template_id";
  const { data } = await mine(env.service.from(table).select(columns), env, target.id).maybeSingle();
  if (!data) return { ok: false, error: "No encontramos este diseño." };
  const row = data as unknown as Record<string, unknown> & { name: string; format: string; doc: Json };
  const doc = parseDesignDoc(row.doc);
  if (!doc.ok) return { ok: false, error: "El diseño guardado no se pudo leer: no se puede duplicar." };
  const name = copyName(row.name, target.kind);
  const insert: Record<string, unknown> =
    target.kind === "template"
      ? {
          workspace_id: env.actor.workspaceId,
          name,
          format: row.format,
          doc: asJson(doc.doc),
          origin: row.origin,
          style: row.style,
          custom_vars: row.custom_vars,
          date_format: row.date_format,
          verify: row.verify,
          doc_type: row.doc_type,
          doc_type_label: row.doc_type_label,
          allow_download: row.allow_download,
          created_by: env.actor.userId,
        }
      : {
          workspace_id: env.actor.workspaceId,
          name,
          format: row.format,
          doc: asJson(doc.doc),
          // Una pieza emitida (origen `template`) pasa a ser un diseño propio hecho a mano.
          origin: row.origin === "template" ? "blank" : row.origin,
          style: row.style,
          allow_download: row.allow_download,
          created_by: env.actor.userId,
        };
  const { data: created, error } = await env.service.from(table).insert(insert as never).select("id").single();
  if (error || !created) {
    console.error("[designer] no pude duplicar:", error?.code ?? "sin fila");
    return { ok: false, error: "No pudimos duplicar. Probá de nuevo." };
  }
  const id = (created as { id: string }).id;
  await insertVersion(env, { kind: target.kind, id }, doc.doc, "manual");
  await logAudit({ supabase: env.service, workspaceId: env.actor.workspaceId, entityType: entityOf(target.kind), entityId: id, action: "create", metadata: { duplicated_from: target.id }, performedBy: env.actor.userId });
  return { ok: true, data: { id, href: hrefFor(target.kind, id) } };
}

// ─── Archivar y borrar ───────────────────────────────────────────────────────

export interface ArchiveOptions {
  confirmUnpublish?: boolean;
  /** Sacarlo de archivados. */
  restore?: boolean;
}

/**
 * Archivar (F28): un diseño publicado pide confirmación y se despublica antes. Una pieza emitida no se archiva. Nunca
 * borra. Con `restore`, lo vuelve a la lista.
 */
export async function archiveCore(env: CoreEnv, target: Target, options: ArchiveOptions = {}): Promise<ActionResult<{ needsConfirm?: boolean }>> {
  const table = tableFor(target.kind);
  const columns = target.kind === "template" ? "archived_at" : "archived_at, published, status, template_id";
  const { data } = await mine(env.service.from(table).select(columns), env, target.id).maybeSingle();
  if (!data) return { ok: false, error: "No encontramos este diseño." };
  const row = data as unknown as { archived_at: string | null; published?: boolean; status?: string; template_id?: string | null };
  const audit = (metadata: Record<string, Json>) => logAudit({ supabase: env.service, workspaceId: env.actor.workspaceId, entityType: entityOf(target.kind), entityId: target.id, action: "update", metadata, performedBy: env.actor.userId });

  if (options.restore) {
    if (!row.archived_at) return { ok: true, data: {} };
    const { error } = await mine(env.service.from(table).update({ archived_at: null } as never), env, target.id);
    if (error) return { ok: false, error: "No pudimos restaurarlo. Probá de nuevo." };
    await audit({ archived: false });
    return { ok: true, data: {} };
  }

  const decision = archiveDecision({ kind: target.kind, published: !!row.published, isGeneration: !!row.template_id, archived: !!row.archived_at }, options.confirmUnpublish === true);
  if (decision.action === "already") return { ok: true, data: {} };
  if (decision.action === "blocked") return { ok: false, error: decision.reason };
  if (decision.action === "confirm") return { ok: true, data: { needsConfirm: true } };

  // Se despublica y se archiva en la MISMA escritura: nunca queda archivado y publicado.
  const patch: Record<string, unknown> = { archived_at: nowOf(env).toISOString() };
  if (decision.unpublish) {
    patch.published = false;
    if (row.status === "ready") patch.status = "draft";
  }
  const { error } = await mine(env.service.from(table).update(patch as never), env, target.id);
  if (error) {
    console.error("[designer] no pude archivar:", error.code ?? "error");
    return { ok: false, error: "No pudimos archivarlo. Probá de nuevo." };
  }
  await audit({ archived: true, unpublished: decision.unpublish });
  return { ok: true, data: {} };
}

/** Borrar definitivamente: solo borradores sin uso (sin publicar nunca, sin generaciones, sin vínculos), y con `designer.manage`. */
export async function deleteCore(env: CoreEnv, target: Target, canManage: boolean): Promise<ActionResult> {
  const table = tableFor(target.kind);
  const columns = target.kind === "template" ? "id" : "id, published, published_at, template_id, content_post_id";
  const { data } = await mine(env.service.from(table).select(columns), env, target.id).maybeSingle();
  if (!data) return { ok: false, error: "No encontramos este diseño." };
  const row = data as unknown as { published?: boolean; published_at?: string | null; template_id?: string | null; content_post_id?: string | null };
  let generationsCount = 0;
  if (target.kind === "template") {
    const { count } = await env.service.from("designs").select("id", { count: "exact", head: true }).eq("workspace_id", env.actor.workspaceId).eq("template_id", target.id);
    generationsCount = count ?? 0;
  }
  const blockers = deleteBlockers({
    kind: target.kind,
    isGeneration: !!row.template_id,
    published: !!row.published,
    everPublished: !!row.published_at,
    generationsCount,
    linkedToContent: !!row.content_post_id,
    canManage,
  });
  if (blockers.length > 0) return { ok: false, error: blockers[0] };
  const { error } = await mine(env.service.from(table).delete(), env, target.id);
  if (error) {
    console.error("[designer] no pude borrar:", error.code ?? "error");
    return { ok: false, error: "No pudimos borrarlo. Probá de nuevo." };
  }
  // La conversación con la IA de este diseño no tiene a dónde apuntar: se va con él (los mensajes, en cascada).
  await env.service.from("ai_threads").delete().eq("workspace_id", env.actor.workspaceId).eq("channel", "designer").eq("subject_id", target.id);
  await logAudit({ supabase: env.service, workspaceId: env.actor.workspaceId, entityType: entityOf(target.kind), entityId: target.id, action: "delete", performedBy: env.actor.userId });
  return { ok: true, data: undefined };
}

// ─── Versiones (F27) ─────────────────────────────────────────────────────────

const VERSION_LIMIT = 30;

/** Las versiones más nuevas primero, con su documento (para la miniatura en vivo, F48) y el nombre de quien la hizo. */
export async function listVersionsCore(db: Db, workspaceId: string, target: Target, names: ReadonlyMap<string, string>): Promise<VersionSummary[]> {
  const column = target.kind === "template" ? "template_id" : "design_id";
  const { data, error } = await db
    .from("design_versions")
    .select("id, created_at, reason, author_kind, author_id, doc")
    .eq("workspace_id", workspaceId)
    .eq(column, target.id)
    .order("created_at", { ascending: false })
    .limit(VERSION_LIMIT);
  if (error) throw new Error(`No se pudieron leer las versiones: ${error.message}`);
  return (data ?? []).flatMap((row) => {
    const doc = parseDesignDoc(row.doc);
    if (!doc.ok) return [];
    return [{ id: row.id, createdAt: row.created_at, reason: row.reason, authorKind: row.author_kind, authorName: row.author_id ? (names.get(row.author_id) ?? null) : null, doc: doc.doc }];
  });
}

/**
 * Restaurar crea una versión NUEVA y nunca borra ninguna: antes guarda lo que hay ahora (para poder volver) y después
 * deja la versión elegida como documento vigente, con una versión «Restaurada».
 */
export async function restoreVersionCore(env: CoreEnv, target: Target, versionId: string): Promise<ActionResult<{ rev: number }>> {
  const column = target.kind === "template" ? "template_id" : "design_id";
  const { data: version } = await env.service.from("design_versions").select("doc").eq("id", versionId).eq("workspace_id", env.actor.workspaceId).eq(column, target.id).maybeSingle();
  if (!version) return { ok: false, error: "No encontramos esa versión." };
  const restored = parseDesignDoc((version as { doc: Json }).doc);
  if (!restored.ok) return { ok: false, error: "Esa versión no se puede leer." };

  const table = tableFor(target.kind);
  const { data: row } = await mine(env.service.from(table).select("format, rev, doc"), env, target.id).maybeSingle();
  if (!row) return { ok: false, error: "No encontramos este diseño." };
  const current = row as { format: string; rev: number; doc: Json };
  if (target.kind === "template" && restored.doc.format !== current.format) return { ok: false, error: "Esa versión es de otro formato: cambiá el formato de la plantilla y volvé a intentar." };

  const previous = parseDesignDoc(current.doc);
  if (previous.ok) await insertVersion(env, target, previous.doc, "manual");
  const { data: saved, error } = await mine(env.service.from(table).update({ doc: asJson(restored.doc), format: restored.doc.format, rev: current.rev + 1 } as never), env, target.id)
    .eq("rev", current.rev)
    .select("rev")
    .maybeSingle();
  if (error || !saved) return { ok: false, error: "Alguien guardó mientras tanto. Probá de nuevo." };
  await insertVersion(env, target, restored.doc, "restore");
  await logAudit({ supabase: env.service, workspaceId: env.actor.workspaceId, entityType: entityOf(target.kind), entityId: target.id, action: "restore", metadata: { version_id: versionId }, performedBy: env.actor.userId });
  return { ok: true, data: { rev: (saved as { rev: number }).rev } };
}

// ─── Configuración de una plantilla (F28) ────────────────────────────────────

const DATE_FORMATS = ["long", "short", "en"] as const;

/**
 * La configuración de una plantilla: formato, «Se puede verificar» y el tipo de documento, formato de fechas, descarga y
 * variables propias. Cambiar el formato reescala el documento y, si el nuevo no admite verificación, la apaga sola y lo
 * avisa («Este formato no admite verificación»). Todo lo que pasa por acá cumple los CHECK de la base antes de llegar a
 * ella (`validateTemplateVerification`), y las variables propias se validan acá porque la base no lo hace.
 */
export async function updateTemplateSettingsCore(env: CoreEnv, input: TemplateSettingsInput): Promise<ActionResult<{ notice: string | null }>> {
  const { data } = await mine(env.service.from("design_templates").select("format, rev, doc, verify, doc_type, doc_type_label"), env, input.id).maybeSingle();
  if (!data) return { ok: false, error: "No encontramos esta plantilla." };
  const row = data as unknown as { format: string; rev: number; doc: Json; verify: boolean; doc_type: string | null; doc_type_label: string | null };

  const update: Record<string, unknown> = {};
  let notice: string | null = null;
  let verify = input.verify ?? row.verify;
  let format = row.format;
  let newDoc: DesignDoc | null = null;

  if (input.format !== undefined && input.format !== row.format) {
    if (!isFormatKey(input.format) || input.format === "web") return { ok: false, error: "Elegí un formato válido para una plantilla." };
    const current = parseDesignDoc(row.doc);
    if (!current.ok) return { ok: false, error: "El documento guardado no se pudo leer: no se puede cambiar el formato." };
    const converted = convertDocFormat(current.doc, input.format);
    if (!converted.ok) return { ok: false, error: converted.error };
    newDoc = converted.doc;
    format = input.format;
    const outcome = formatChangeOutcome({ verify }, input.format);
    verify = outcome.verify;
    notice = outcome.notice;
  }

  const docType = input.doc_type !== undefined ? input.doc_type : row.doc_type;
  let docTypeLabel = input.doc_type_label !== undefined ? input.doc_type_label : row.doc_type_label;
  if (docType !== "otro") docTypeLabel = null;
  if (typeof docTypeLabel === "string") docTypeLabel = docTypeLabel.replace(/\s+/g, " ").trim() || null;
  if (docType !== null && !(DOC_TYPES as readonly string[]).includes(docType)) return { ok: false, error: "Elegí un tipo de documento válido." };
  const problems = validateTemplateVerification({ format, verify, doc_type: docType, doc_type_label: docTypeLabel });
  if (problems.length > 0) return { ok: false, error: problems[0] };

  if (input.date_format !== undefined) {
    if (!(DATE_FORMATS as readonly string[]).includes(input.date_format)) return { ok: false, error: "Elegí un formato de fecha válido." };
    update.date_format = input.date_format;
  }
  if (input.allow_download !== undefined) {
    if (typeof input.allow_download !== "boolean") return { ok: false, error: "No entendimos si se puede descargar." };
    update.allow_download = input.allow_download;
  }
  if (input.custom_vars !== undefined) {
    const vars = validateCustomVars(input.custom_vars);
    if (!vars.ok) return { ok: false, error: vars.error };
    update.custom_vars = asJson(vars.list);
  }
  if (verify !== row.verify) update.verify = verify;
  if (docType !== row.doc_type) update.doc_type = docType;
  if (docTypeLabel !== row.doc_type_label) update.doc_type_label = docTypeLabel;
  if (newDoc) {
    update.format = format;
    update.doc = asJson(newDoc);
    update.rev = row.rev + 1;
  }
  if (Object.keys(update).length === 0) return { ok: true, data: { notice } };

  if (newDoc) {
    // Antes de reescalar, queda lo anterior como versión: se puede volver atrás.
    const before = parseDesignDoc(row.doc);
    if (before.ok) await insertVersion(env, { kind: "template", id: input.id }, before.doc, "manual");
  }
  let query = mine(env.service.from("design_templates").update(update as never), env, input.id);
  if (newDoc) query = query.eq("rev", row.rev);
  const { data: saved, error } = await query.select("id").maybeSingle();
  if (error) {
    console.error("[designer] no pude guardar la configuración:", error.code ?? "error");
    return { ok: false, error: "No pudimos guardar la configuración. Probá de nuevo." };
  }
  if (!saved) return { ok: false, error: "Otra persona cambió la plantilla mientras tanto. Recargá la página." };
  await logAudit({ supabase: env.service, workspaceId: env.actor.workspaceId, entityType: "design_template", entityId: input.id, action: "update", metadata: { settings: Object.keys(update).filter((k) => k !== "doc") }, performedBy: env.actor.userId });
  return { ok: true, data: { notice } };
}
