/**
 * Publicar, despublicar, opciones públicas y anular (F45, F47). Solo servidor.
 *
 * La lógica vive acá y recibe el cliente de servicio, a quien actúa y lo que necesita por parámetro: las
 * Server Actions (`lib/actions/designer/publish.ts`) validan el permiso y la forma de lo que manda el navegador
 * y llaman a estas funciones con el negocio de la SESIÓN (nunca el que mande el navegador). Así se prueban sin
 * red con un cliente en memoria y las usa `verify-designer --bloque ds5` contra la base.
 *
 * Reglas:
 * - **Publicar** deja el diseño `published` con `status: "ready"` (un diseño propio), guarda una versión de motivo
 *   `publish` y encola el render de todas las páginas (`purpose: "publish"`). Una página web no se renderiza: se
 *   muestra desde su documento. Publicar de nuevo algo ya publicado vuelve a guardar la versión y a renderizar
 *   (es "publicar los cambios"). Una generación se publica sin tocar su estado ni su render: los maneja quien la
 *   emitió.
 * - **Despublicar**: el link deja de funcionar en el siguiente pedido (la función pública ya no lo devuelve) y el
 *   código se conserva.
 * - **Anular** (solo una generación lista): motivo obligatorio, nunca se borra; el link pasa a mostrar «anulado».
 * - Todo lo que cambia el estado público queda en `audit_log` (`entityType: "design"`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit, type AuditChanges } from "@/lib/audit";
import type { Database, Json, AuditAction } from "@/lib/types/database";
import type { ActionResult, PublicOptions } from "./contracts";
import { enqueueDesignRender } from "./jobs/render";
import { loadDesignLinks } from "./public-links";
import { MAX_VOID_REASON } from "./publishing-limits";

type Db = SupabaseClient<Database>;

export interface Actor {
  workspaceId: string;
  /** Quien lo pidió; null cuando lo hace el sistema (una automatización que publica una generación). */
  userId: string | null;
}

export interface PublishingDeps {
  audit?: typeof logAudit;
  enqueue?: typeof enqueueDesignRender;
  loadLinks?: typeof loadDesignLinks;
  now?: () => Date;
}


const DESIGN_COLUMNS = "id, workspace_id, name, format, doc, template_id, code, published, allow_download, allow_indexing, published_at, status, archived_at";

interface DesignRow {
  id: string;
  workspace_id: string;
  name: string;
  format: string;
  doc: Json;
  template_id: string | null;
  code: string;
  published: boolean;
  allow_download: boolean;
  allow_indexing: boolean;
  published_at: string | null;
  status: "draft" | "queued" | "rendering" | "ready" | "failed" | "void";
  archived_at: string | null;
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Lee el diseño del negocio de la SESIÓN. Un id de otro negocio es «no existe». */
async function readDesign(db: Db, workspaceId: string, designId: string): Promise<{ ok: true; row: DesignRow } | { ok: false; error: string }> {
  const { data, error } = await db.from("designs").select(DESIGN_COLUMNS).eq("id", designId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) {
    console.error("[disenos] no pude leer el diseño:", error.message);
    return fail("No se pudo leer el diseño. Probá de nuevo.");
  }
  if (!data) return fail("No encontramos ese diseño.");
  return { ok: true, row: data as unknown as DesignRow };
}

/** La acción del historial de cada evento (volver a publicar es «publicó», con el evento en `metadata`). */
const EVENT_ACTIONS: Record<string, AuditAction> = {
  "design.published": "design.published",
  "design.republished": "design.published",
  "design.unpublished": "design.unpublished",
  "design.options_changed": "design.public_options_changed",
  "design.voided": "design.voided",
};

async function audit(deps: Required<PublishingDeps>, db: Db, actor: Actor, row: DesignRow, event: string, changes: AuditChanges, extra: Record<string, Json> = {}): Promise<void> {
  try {
    await deps.audit({
      supabase: db,
      workspaceId: actor.workspaceId,
      entityType: "design",
      entityId: row.id,
      action: EVENT_ACTIONS[event] ?? "update",
      changes,
      metadata: { event, format: row.format, kind: row.template_id ? "generation" : "design", ...extra },
      performedBy: actor.userId,
    });
  } catch (error) {
    console.error("[disenos] no pude anotar el cambio en el historial:", error instanceof Error ? error.message : "error");
  }
}

function withDefaults(deps: PublishingDeps): Required<PublishingDeps> {
  return { audit: deps.audit ?? logAudit, enqueue: deps.enqueue ?? enqueueDesignRender, loadLinks: deps.loadLinks ?? loadDesignLinks, now: deps.now ?? (() => new Date()) };
}

// ─── Publicar ───────────────────────────────────────────────────────────────

export async function publishDesignCore(db: Db, actor: Actor, input: { designId: string } & PublicOptions, depsIn: PublishingDeps = {}): Promise<ActionResult<{ link: string }>> {
  const deps = withDefaults(depsIn);
  const found = await readDesign(db, actor.workspaceId, input.designId);
  if (!found.ok) return found;
  const row = found.row;
  if (row.archived_at) return fail("Un diseño archivado no se puede publicar. Restauralo primero.");
  if (row.status === "void") return fail("Una pieza anulada no se puede publicar.");

  const web = row.format === "web";
  if (input.allowIndexing && !web) return fail("Solo una página web puede aparecer en buscadores.");
  const generation = row.template_id !== null;
  const allowDownload = input.allowDownload ?? row.allow_download;
  const allowIndexing = web ? (input.allowIndexing ?? row.allow_indexing) : false;

  const values = {
    published: true,
    allow_download: allowDownload,
    allow_indexing: allowIndexing,
    ...(row.published ? {} : { published_at: deps.now().toISOString() }),
    // Un diseño propio queda `ready` al publicarse; el estado de una generación lo lleva su render.
    ...(generation ? {} : { status: "ready" as const }),
  };
  const { error } = await db.from("designs").update(values).eq("id", row.id).eq("workspace_id", actor.workspaceId);
  if (error) {
    console.error("[disenos] no pude publicar:", error.message);
    return fail("No se pudo publicar. Probá de nuevo.");
  }

  if (!generation) {
    // La versión de «publicar»: el documento tal como salió (sin imágenes). No frena la publicación si falla.
    const { error: versionError } = await db.from("design_versions").insert({
      workspace_id: actor.workspaceId,
      design_id: row.id,
      doc: row.doc,
      reason: "publish",
      author_kind: "user",
      author_id: actor.userId,
      created_by: actor.userId,
    });
    if (versionError) console.error("[disenos] no pude guardar la versión de publicar:", versionError.message);

    // Una página web no se renderiza: se muestra desde su documento.
    if (!web) {
      try {
        await deps.enqueue(db, { designId: row.id, purpose: "publish" });
      } catch (enqueueError) {
        // El link ya funciona («Se está preparando»); pedir la descarga vuelve a encolar el render.
        console.error("[disenos] no pude encolar el render de publicar:", enqueueError instanceof Error ? enqueueError.message : "error");
      }
    }
  }

  const changes: AuditChanges = {};
  if (!row.published) changes.published = { old: false, new: true };
  if (row.allow_download !== allowDownload) changes.allow_download = { old: row.allow_download, new: allowDownload };
  if (row.allow_indexing !== allowIndexing) changes.allow_indexing = { old: row.allow_indexing, new: allowIndexing };
  await audit(deps, db, actor, row, row.published ? "design.republished" : "design.published", changes);

  const links = await deps.loadLinks(db, actor.workspaceId, row.code);
  return { ok: true, data: { link: links.link } };
}

// ─── Despublicar ────────────────────────────────────────────────────────────

export async function unpublishDesignCore(db: Db, actor: Actor, input: { designId: string }, depsIn: PublishingDeps = {}): Promise<ActionResult> {
  const deps = withDefaults(depsIn);
  const found = await readDesign(db, actor.workspaceId, input.designId);
  if (!found.ok) return found;
  const row = found.row;
  if (!row.published) return { ok: true, data: undefined };

  const values = { published: false, ...(row.template_id ? {} : { status: "draft" as const }) };
  const { error } = await db.from("designs").update(values).eq("id", row.id).eq("workspace_id", actor.workspaceId);
  if (error) {
    console.error("[disenos] no pude despublicar:", error.message);
    return fail("No se pudo despublicar. Probá de nuevo.");
  }
  await audit(deps, db, actor, row, "design.unpublished", { published: { old: true, new: false } });
  return { ok: true, data: undefined };
}

// ─── Opciones del link ──────────────────────────────────────────────────────

export async function setPublicOptionsCore(db: Db, actor: Actor, input: { designId: string } & PublicOptions, depsIn: PublishingDeps = {}): Promise<ActionResult> {
  const deps = withDefaults(depsIn);
  const found = await readDesign(db, actor.workspaceId, input.designId);
  if (!found.ok) return found;
  const row = found.row;
  if (input.allowIndexing === true && row.format !== "web") return fail("Solo una página web puede aparecer en buscadores.");

  const values: { allow_download?: boolean; allow_indexing?: boolean } = {};
  const changes: AuditChanges = {};
  if (input.allowDownload !== undefined && input.allowDownload !== row.allow_download) {
    values.allow_download = input.allowDownload;
    changes.allow_download = { old: row.allow_download, new: input.allowDownload };
  }
  if (input.allowIndexing !== undefined && input.allowIndexing !== row.allow_indexing) {
    values.allow_indexing = input.allowIndexing;
    changes.allow_indexing = { old: row.allow_indexing, new: input.allowIndexing };
  }
  if (Object.keys(values).length === 0) return { ok: true, data: undefined };

  const { error } = await db.from("designs").update(values).eq("id", row.id).eq("workspace_id", actor.workspaceId);
  if (error) {
    console.error("[disenos] no pude cambiar las opciones del link:", error.message);
    return fail("No se pudo guardar el cambio. Probá de nuevo.");
  }
  await audit(deps, db, actor, row, "design.options_changed", changes);
  return { ok: true, data: undefined };
}

// ─── Anular ─────────────────────────────────────────────────────────────────

/** Anular una generación lista (F47): motivo obligatorio y nunca se borra. */
export async function voidDesignCore(db: Db, actor: Actor, input: { designId: string; reason: string }, depsIn: PublishingDeps = {}): Promise<ActionResult> {
  const deps = withDefaults(depsIn);
  const reason = (input.reason ?? "").trim();
  if (!reason) return fail("Escribí el motivo de la anulación.");
  if (reason.length > MAX_VOID_REASON) return fail(`El motivo es demasiado largo (hasta ${MAX_VOID_REASON} caracteres).`);

  const found = await readDesign(db, actor.workspaceId, input.designId);
  if (!found.ok) return found;
  const row = found.row;
  if (!row.template_id) return fail("Solo se puede anular una pieza generada desde una plantilla.");
  if (row.status === "void") return fail("Esa pieza ya está anulada.");
  if (row.status !== "ready") return fail("Solo se puede anular una pieza que ya está lista.");

  const at = deps.now().toISOString();
  // Condicional: si otra persona la anuló (o cambió de estado) mientras tanto, no se pisa.
  const { data, error } = await db
    .from("designs")
    .update({ status: "void", void_reason: reason, voided_at: at, voided_by: actor.userId })
    .eq("id", row.id)
    .eq("workspace_id", actor.workspaceId)
    .eq("status", "ready")
    .select("id");
  if (error) {
    console.error("[disenos] no pude anular:", error.message);
    return fail("No se pudo anular. Probá de nuevo.");
  }
  if (!data || data.length === 0) return fail("La pieza cambió mientras tanto. Recargá y probá de nuevo.");

  await audit(deps, db, actor, row, "design.voided", { status: { old: "ready", new: "void" }, void_reason: { old: null, new: reason } });
  return { ok: true, data: undefined };
}
