"use server";

/**
 * Cargar un archivo HTML (DS4, F39–F42): primero se lee y se limpia (`inspectHtmlUpload`), la persona
 * confirma o corrige lo detectado, y recién ahí se crea el diseño (`importHtml`).
 *
 * Las dos acciones piden `designer.edit` ADENTRO y escriben con el cliente de servicio, siempre con el
 * negocio de la SESIÓN (nunca uno que mande el navegador). El archivo se valida por sus bytes, se
 * descomprime sin confiar en el zip, se limpia todo el HTML y el CSS y recién ahí se sube nada.
 *
 * Qué queda guardado entre las dos: `design-assets/<ws>/imports/<uploadId>/` con los recursos y un
 * `import.json` con el HTML ya limpio y lo detectado. `importHtml` no vuelve a leer el archivo de la persona.
 */

import { randomUUID } from "node:crypto";
import { getPermissionAction } from "@/lib/auth/guards";
import { getOrCreateDesignerThread, appendMessage } from "@/lib/ai-threads/store";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types/database";
import { type ActionResult, type DesignKind, type HtmlImportKind, type HtmlInspection } from "@/lib/designer/contracts";
import { DESIGN_ASSETS_BUCKET, importAssetPath } from "@/lib/designer/storage";
import { buildImportedDoc } from "@/lib/designer/import/build-doc";
import { sanitizeDocHtml } from "@/lib/designer/import/edit";
import { buildImportRecord, type PlannedAsset } from "@/lib/designer/import/pipeline";
import { IMPORT_RECORD_FILE, parseImportRecord, type ImportRecord } from "@/lib/designer/import/record";
import { MAX_ZIP_BYTES, readUpload } from "@/lib/designer/import/zip";
import { parseDesignDoc } from "@/lib/designer/doc/schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Cuántas cargas por persona y por hora (cada una guarda hasta 50 MB). */
const UPLOADS_PER_HOUR = 30;
const UPLOAD_CONCURRENCY = 6;

const NO_PERMISSION = "No tenés permiso para cargar archivos en el Diseñador IA.";

function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f\u007f]+/g, "").trim().slice(0, 200) || "archivo";
}

/** Sube los archivos de a pocos. Si uno falla, devuelve cuáles ya se subieron para poder deshacerlo. */
async function uploadPlan(
  service: Awaited<ReturnType<typeof createServiceClient>>,
  plan: readonly PlannedAsset[],
): Promise<{ ok: true } | { ok: false; uploaded: string[] }> {
  const uploaded: string[] = [];
  for (let i = 0; i < plan.length; i += UPLOAD_CONCURRENCY) {
    const chunk = plan.slice(i, i + UPLOAD_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (asset) => {
        const { error } = await service.storage.from(DESIGN_ASSETS_BUCKET).upload(asset.path, asset.bytes, { contentType: asset.mime, upsert: false });
        if (error) console.error("[designer] no pude subir un recurso de un archivo cargado:", error.message);
        return error ? null : asset.path;
      }),
    );
    for (const path of results) if (path) uploaded.push(path);
    if (results.some((r) => r === null)) return { ok: false, uploaded };
  }
  return { ok: true };
}

/** `.html` (≤ 5 MB) o `.zip` (≤ 50 MB): descomprime, limpia, sube los recursos y detecta el formato. */
export async function inspectHtmlUpload(form: FormData): Promise<ActionResult<HtmlInspection>> {
  const ctx = await getPermissionAction("designer.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Elegí un archivo .html o un .zip." };
  if (file.size > MAX_ZIP_BYTES) return { ok: false, error: "El archivo pesa más de 50 MB." };

  const workspaceId = ctx.workspace.id;
  const service = await createServiceClient();

  // Un tope por persona y por hora: cada carga guarda archivos en el negocio.
  const hourStart = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
  const { data: bumped } = await service.rpc("bump_rate_limit", { p_key: `designer-import:${ctx.user.id}`, p_window_start: hourStart });
  if (typeof bumped === "number" && bumped > UPLOADS_PER_HOUR) return { ok: false, error: "Cargaste muchos archivos en esta hora. Probá de nuevo más tarde." };

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, error: "No se pudo leer el archivo. Probá de nuevo." };
  }
  const read = readUpload(bytes);
  if (!read.ok) return { ok: false, error: read.error };

  const uploadId = randomUUID();
  const fileName = cleanFileName(file.name);
  const built = buildImportRecord({ site: read.site, fileName, workspaceId, uploadId });
  if (!built.ok) return { ok: false, error: built.error };

  const uploaded = await uploadPlan(service, built.plan);
  if (!uploaded.ok) {
    if (uploaded.uploaded.length > 0) await service.storage.from(DESIGN_ASSETS_BUCKET).remove(uploaded.uploaded);
    return { ok: false, error: "No se pudieron guardar las imágenes del archivo. Probá de nuevo." };
  }

  const recordPath = importAssetPath(workspaceId, uploadId, IMPORT_RECORD_FILE);
  const { error: recordError } = await service.storage
    .from(DESIGN_ASSETS_BUCKET)
    .upload(recordPath, new TextEncoder().encode(JSON.stringify(built.record)), { contentType: "application/json", upsert: false });
  if (recordError) {
    console.error("[designer] no pude guardar el archivo cargado:", recordError.message);
    await service.storage.from(DESIGN_ASSETS_BUCKET).remove(built.plan.map((p) => p.path));
    return { ok: false, error: "No se pudo guardar el archivo. Probá de nuevo." };
  }

  const { record } = built;
  return {
    ok: true,
    data: {
      uploadId,
      fileName: record.fileName,
      detected: { as: record.detected.as, format: record.detected.format, pages: record.detected.pages, label: record.detected.label },
      removed: record.removed,
      assets: { images: record.assets.images, fonts: record.assets.fonts },
    },
  };
}

async function readRecord(service: Awaited<ReturnType<typeof createServiceClient>>, workspaceId: string, uploadId: string): Promise<ImportRecord | null> {
  const { data, error } = await service.storage.from(DESIGN_ASSETS_BUCKET).download(importAssetPath(workspaceId, uploadId, IMPORT_RECORD_FILE));
  if (error || !data) return null;
  try {
    return parseImportRecord(JSON.parse(await data.text()));
  } catch {
    return null;
  }
}

function defaultName(record: ImportRecord): string {
  return record.fileName.replace(/\.(html?|zip)$/i, "").trim() || "Diseño cargado";
}

/** El primer mensaje del chat del diseño, como en el prototipo. Nunca frena la carga. */
async function leaveGreeting(
  service: Awaited<ReturnType<typeof createServiceClient>>,
  input: { workspaceId: string; userId: string; kind: DesignKind; id: string; name: string; record: ImportRecord; as: HtmlImportKind; pages: number },
): Promise<void> {
  try {
    const thread = await getOrCreateDesignerThread(service, { workspaceId: input.workspaceId, kind: input.kind === "template" ? "template" : "design", subjectId: input.id, userId: input.userId, title: input.name });
    const what = input.as === "web" ? "una página web" : `una presentación de ${input.pages} ${input.pages === 1 ? "diapositiva" : "diapositivas"}`;
    const removed = input.record.removed.scripts > 0 ? " y quité los scripts" : "";
    const variables = input.kind === "template" ? " o ponerle variables" : "";
    await appendMessage(service, thread, {
      role: "assistant",
      content: `Cargué ${input.record.fileName}: ${what}. Guardé las imágenes y las fuentes${removed}. Tocá un texto y hacé doble clic para editarlo${variables} (también los encontrás en la pestaña Capas), o pedime cambios en los textos acá.`,
      context: { scope: {} },
      result: { changed_pages: [], summary: "Cargó el archivo" },
    });
  } catch (error) {
    console.error("[designer] no pude dejar el primer mensaje del archivo cargado:", error instanceof Error ? error.message : "error");
  }
}

export async function importHtml(input: { uploadId: string; kind: DesignKind; as: HtmlImportKind; name?: string }): Promise<ActionResult<{ id: string; kind: DesignKind; href: string }>> {
  const ctx = await getPermissionAction("designer.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  if (typeof input?.uploadId !== "string" || !UUID_RE.test(input.uploadId)) return { ok: false, error: "La carga no es válida. Volvé a subir el archivo." };
  if (input.kind !== "design" && input.kind !== "template") return { ok: false, error: "Elegí si es un diseño o una plantilla." };
  if (input.as !== "web" && input.as !== "slides") return { ok: false, error: "Elegí si es una página web o una presentación." };

  const workspaceId = ctx.workspace.id;
  const service = await createServiceClient();

  // El archivo se busca SOLO en la carpeta del negocio de la sesión: la carga de otro negocio no existe para esta persona.
  const record = await readRecord(service, workspaceId, input.uploadId);
  if (!record) return { ok: false, error: "No encontramos el archivo cargado (puede haber vencido). Volvé a subirlo." };

  const built = buildImportedDoc(record, input.as, input.kind);
  if (!built.ok) return { ok: false, error: built.error };

  // Una vez más por la limpieza, aunque ya salió limpio: lo que se guarda nunca depende de lo que había en el archivo.
  const sanitized = sanitizeDocHtml(built.doc, workspaceId);
  const parsed = parseDesignDoc(sanitized.doc);
  if (!parsed.ok) return { ok: false, error: `El archivo no se pudo convertir en un diseño: ${parsed.problems[0] ?? "formato inválido"}.` };
  const doc = parsed.doc;

  const name = (typeof input.name === "string" ? input.name.trim() : "").slice(0, 200) || defaultName(record);
  const pages = doc.pages.length;

  if (input.kind === "design") {
    const { data, error } = await service
      .from("designs")
      .insert({ workspace_id: workspaceId, name, format: doc.format, doc: doc as unknown as Json, origin: "html", status: "draft", allow_download: input.as !== "web", created_by: ctx.user.id })
      .select("id")
      .single();
    if (error || !data) {
      console.error("[designer] no pude crear el diseño cargado:", error?.message);
      return { ok: false, error: "No se pudo crear el diseño. Probá de nuevo." };
    }
    const { error: versionError } = await service
      .from("design_versions")
      .insert({ workspace_id: workspaceId, design_id: data.id, doc: doc as unknown as Json, reason: "import", author_kind: "user", author_id: ctx.user.id, created_by: ctx.user.id });
    if (versionError) {
      console.error("[designer] no pude guardar la versión del diseño cargado:", versionError.message);
      await service.from("designs").delete().eq("id", data.id).eq("workspace_id", workspaceId);
      return { ok: false, error: "No se pudo crear el diseño. Probá de nuevo." };
    }
    await leaveGreeting(service, { workspaceId, userId: ctx.user.id, kind: "design", id: data.id, name, record, as: input.as, pages });
    return { ok: true, data: { id: data.id, kind: "design", href: `/dashboard/disenos/d/${data.id}` } };
  }

  const { data, error } = await service
    .from("design_templates")
    .insert({ workspace_id: workspaceId, name, format: doc.format, doc: doc as unknown as Json, origin: "html", created_by: ctx.user.id })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[designer] no pude crear la plantilla cargada:", error?.message);
    return { ok: false, error: "No se pudo crear la plantilla. Probá de nuevo." };
  }
  const { error: versionError } = await service
    .from("design_versions")
    .insert({ workspace_id: workspaceId, template_id: data.id, doc: doc as unknown as Json, reason: "import", author_kind: "user", author_id: ctx.user.id, created_by: ctx.user.id });
  if (versionError) {
    console.error("[designer] no pude guardar la versión de la plantilla cargada:", versionError.message);
    await service.from("design_templates").delete().eq("id", data.id).eq("workspace_id", workspaceId);
    return { ok: false, error: "No se pudo crear la plantilla. Probá de nuevo." };
  }
  await leaveGreeting(service, { workspaceId, userId: ctx.user.id, kind: "template", id: data.id, name, record, as: input.as, pages });
  return { ok: true, data: { id: data.id, kind: "template", href: `/dashboard/disenos/t/${data.id}` } };
}
