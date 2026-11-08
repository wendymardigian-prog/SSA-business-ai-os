/**
 * El job `design_render` (F6): convierte un diseño o una generación en PNG y PDF
 * con el servicio de render y los guarda en `design-renders`.
 *
 * - `publish`: el juego vigente de un diseño propio (PNG por página + PDF).
 * - `generation`: el de una generación de plantilla; al terminar queda `ready`
 *   y avisa a los módulos suscriptos (`onDesignGenerated`).
 * - `export`: una exportación suelta (PDF, ZIP de PNG o una página) en
 *   `<ws>/<diseño>/exports/<marca>/`, que la limpieza diaria borra a los 7 días.
 *
 * NUNCA lanza sin anotar: el error queda en la fila (`error`, `attempts`,
 * `next_attempt_at`). Si el servicio falla de forma pasajera, se reagenda a 1,
 * 5 y 15 minutos (la cola reintentaría a los 10 s encima de esa espera si el
 * job lanzara); al cuarto fallo queda `failed` con el motivo. Sin el servicio
 * configurado, queda `failed` con "Falta conectar el servicio de render" y se
 * reintenta a mano.
 *
 * Solo servidor.
 */

import { zipSync } from "fflate";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { scheduleJob } from "@/lib/scheduler";
import { parseDesignDoc, type DesignDoc } from "../doc/schema";
import { emitDesignGenerated, type SubjectRef } from "../extensions";
import { FORMATS } from "../formats";
import { renderPageHTML } from "../render/page-html";
import { renderDesign, RenderFailed, renderErrorMessage, RenderNotConfigured, type RenderRequest, type RenderResult } from "../render-client";
import { parseDesignSettings } from "../settings-schema";
import { sampleValues, type CustomVar } from "../variables/catalog";
import { assetUrlFrom, collectAssetPaths, DESIGN_RENDERS_BUCKET, exportFolder, pageFileName, pathBelongsTo, renderFolder, signAssetUrls } from "../storage";
import { releasePreviousRenders } from "./render-replace";

export const DESIGN_RENDER_JOB = "design_render";
/** Esperas entre intentos cuando el servicio falla de forma pasajera: 1, 5 y 15 minutos. */
export const DESIGN_RENDER_RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

type Db = SupabaseClient<Database>;

export type RenderPurpose = "publish" | "generation" | "export";
export type ExportKind = "pdf" | "zip" | "png";

export interface DesignRenderPayload {
  /** El diseño o la generación. Una prueba de plantilla trae `templateId` en su lugar. */
  designId?: string;
  purpose: RenderPurpose;
  /** Solo `export`. */
  exportKind?: ExportKind;
  /** Solo `export` con `png`: la página (0 = la primera). */
  page?: number;
  /** Solo `export`: la carpeta de esta exportación (la arma quien la pide, así sabe dónde buscarla). */
  stamp?: string;
  /** "Exportar prueba" de una plantilla con datos de ejemplo (no hay fila en `designs`): solo con `purpose: "export"`. */
  templateId?: string;
  values?: Record<string, string>;
  /** Reintentos de una exportación (no se anotan en la fila del diseño). */
  retry?: number;
}

/** Lo que guarda `designs.renders` (el juego vigente). */
export interface RenderSet {
  version: string;
  pdf_path: string | null;
  pages: string[];
  rendered_at: string;
}

export interface RenderDeps {
  render?: (req: RenderRequest) => Promise<RenderResult>;
  now?: () => Date;
  schedule?: typeof scheduleJob;
}

export type RenderOutcome =
  | { status: "rendered"; set: RenderSet }
  | { status: "exported"; paths: string[] }
  | { status: "skipped"; reason: string }
  | { status: "retry"; attempt: number; at: string; error: string }
  | { status: "failed"; error: string };

interface DesignRow {
  id: string;
  workspace_id: string;
  doc: unknown;
  format: string;
  code: string;
  rev: number;
  values: unknown;
  template_id: string | null;
  subject_contact_id: string | null;
  subject_ref: unknown;
  renders: unknown;
  attempts: number;
}

/** Arma el HTML de cada página con los archivos firmados y los valores. */
async function pagesHtml(db: Db, row: { workspace_id: string }, doc: DesignDoc, values: Record<string, string>): Promise<string[]> {
  const { data: ws } = await db.from("workspaces").select("design_settings").eq("id", row.workspace_id).maybeSingle();
  const settings = parseDesignSettings((ws as { design_settings?: unknown } | null)?.design_settings ?? {}, row.workspace_id);
  const uploadedFonts = settings.ok ? (settings.settings.fonts?.uploaded ?? []) : [];
  const paths = collectAssetPaths(doc, uploadedFonts);
  const signed = await signAssetUrls(db, row.workspace_id, paths);
  // Un archivo del negocio sin su link firmado saldría vacío en el PDF: no se da por bueno, se reintenta.
  const missing = paths.filter((p) => pathBelongsTo(p, row.workspace_id) && !signed.has(p));
  if (missing.length > 0) {
    throw new RenderFailed("No se pudieron firmar los links de las imágenes", {
      retryable: true,
      userMessage: "No se pudieron preparar las imágenes del diseño. Se vuelve a intentar solo.",
    });
  }
  const assetUrl = assetUrlFrom(signed);
  return doc.pages.map((_p, i) => renderPageHTML(doc, i, { mode: "export", values, assetUrl, uploadedFonts }));
}

async function upload(db: Db, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await db.storage.from(DESIGN_RENDERS_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new RenderFailed(`No se pudo guardar el archivo (${error.message}).`, { retryable: true });
}

function valuesOf(row: DesignRow): Record<string, string> {
  const values: Record<string, string> = {};
  if (row.values && typeof row.values === "object") for (const [k, v] of Object.entries(row.values as Record<string, unknown>)) if (typeof v === "string") values[k] = v;
  if (row.template_id) values["design.code"] ??= row.code;
  return values;
}

/** Anota un fallo: reagenda (pasajero, hasta 3 veces) o deja `failed`. Nunca lanza. */
async function noteFailure(db: Db, row: DesignRow, payload: DesignRenderPayload, error: unknown, deps: Required<RenderDeps>): Promise<RenderOutcome> {
  const message = renderErrorMessage(error);
  const isGeneration = !!row.template_id && payload.purpose !== "export";
  const attempts = row.attempts + 1;
  const retryable = error instanceof RenderFailed && error.retryable && !(error instanceof RenderNotConfigured);
  try {
    if (retryable && attempts <= DESIGN_RENDER_RETRY_MS.length) {
      const at = new Date(deps.now().getTime() + DESIGN_RENDER_RETRY_MS[attempts - 1]);
      await db.from("designs").update({ attempts, next_attempt_at: at.toISOString(), error: message, ...(isGeneration ? { status: "rendering" as const } : {}) }).eq("id", row.id);
      await deps.schedule(db, DESIGN_RENDER_JOB, { ...payload }, at);
      return { status: "retry", attempt: attempts, at: at.toISOString(), error: message };
    }
    await db.from("designs").update({ attempts, next_attempt_at: null, error: message, ...(isGeneration ? { status: "failed" as const } : {}) }).eq("id", row.id);
  } catch (writeError) {
    console.error("[design_render] no pude anotar el fallo:", writeError instanceof Error ? writeError.message : "error");
  }
  return { status: "failed", error: message };
}

type RenderBase = { width: number; height: number; scale: 0.5 | 1 | 2 };

/** Una exportación suelta: PDF, ZIP de PNG o una página, en `<ws>/<pieza>/exports/<marca>/`. */
async function exportFiles(db: Db, deps: Required<RenderDeps>, input: { workspaceId: string; pieceId: string; html: string[]; base: RenderBase; payload: DesignRenderPayload & { stamp: string } }): Promise<RenderOutcome> {
  const { payload, html, base } = input;
  const folder = exportFolder(input.workspaceId, input.pieceId, payload.stamp);
  const kind = payload.exportKind ?? "pdf";
  const paths: string[] = [];
  if (kind === "pdf") {
    const res = await deps.render({ ...base, pages: html.map((h) => ({ html: h })), format: "pdf" });
    const path = `${folder}/document.pdf`;
    await upload(db, path, res.files[0].bytes, "application/pdf");
    paths.push(path);
  } else if (kind === "png") {
    const index = Math.min(Math.max(payload.page ?? 0, 0), html.length - 1);
    const res = await deps.render({ ...base, html: html[index], format: "png" });
    const path = `${folder}/${pageFileName(index)}`;
    await upload(db, path, res.files[0].bytes, "image/png");
    paths.push(path);
  } else {
    const res = await deps.render({ ...base, pages: html.map((h) => ({ html: h })), format: "png" });
    const entries: Record<string, Uint8Array> = {};
    res.files.forEach((f, i) => (entries[`${String(i + 1).padStart(2, "0")}.png`] = f.bytes));
    const path = `${folder}/imagenes.zip`;
    await upload(db, path, zipSync(entries, { level: 0 }), "application/zip");
    paths.push(path);
  }
  return { status: "exported", paths };
}

/** El archivo que deja una exportación que falló del todo, para que quien la pidió deje de mostrar "Preparando". */
export const EXPORT_ERROR_FILE = "error.json";

/**
 * Un fallo de una EXPORTACIÓN: no toca la fila del diseño (los intentos de publicar y generar son otra
 * cosa); se reagenda a 1, 5 y 15 minutos con su propio contador en el pedido (y la MISMA carpeta). Si ya no
 * se reintenta, deja `error.json` con el motivo en la carpeta de la exportación. Nunca lanza.
 */
async function exportFailure(db: Db, payload: DesignRenderPayload & { stamp: string }, folder: string, error: unknown, deps: Required<RenderDeps>): Promise<RenderOutcome> {
  const message = renderErrorMessage(error);
  const retry = (payload.retry ?? 0) + 1;
  const retryable = error instanceof RenderFailed && error.retryable && !(error instanceof RenderNotConfigured);
  if (retryable && retry <= DESIGN_RENDER_RETRY_MS.length) {
    const at = new Date(deps.now().getTime() + DESIGN_RENDER_RETRY_MS[retry - 1]);
    try {
      await deps.schedule(db, DESIGN_RENDER_JOB, { ...payload, retry }, at);
      return { status: "retry", attempt: retry, at: at.toISOString(), error: message };
    } catch (scheduleError) {
      console.error("[design_render] no pude reagendar la exportación:", scheduleError instanceof Error ? scheduleError.message : "error");
    }
  }
  try {
    const body = new TextEncoder().encode(JSON.stringify({ error: message, at: deps.now().toISOString() }));
    await db.storage.from(DESIGN_RENDERS_BUCKET).upload(`${folder}/${EXPORT_ERROR_FILE}`, body, { contentType: "application/json", upsert: true });
  } catch (markError) {
    console.error("[design_render] no pude anotar el fallo de la exportación:", markError instanceof Error ? markError.message : "error");
  }
  return { status: "failed", error: message };
}

/** "Exportar prueba" de una plantilla: con los valores de muestra, sin crear generación ni link (F46). */
async function runTemplateExport(db: Db, payload: DesignRenderPayload, deps: Required<RenderDeps>): Promise<RenderOutcome> {
  const { data, error } = await db.from("design_templates").select("id, workspace_id, doc, custom_vars").eq("id", payload.templateId as string).maybeSingle();
  if (error) {
    console.error("[design_render] no pude leer la plantilla:", error.message);
    return { status: "skipped", reason: "read_failed" };
  }
  if (!data) return { status: "skipped", reason: "not_found" };
  const parsed = parseDesignDoc(data.doc);
  if (!parsed.ok) return { status: "failed", error: "El documento de la plantilla no es válido." };
  const format = FORMATS[parsed.doc.format];
  if (format.primaryExport === "none") return { status: "skipped", reason: "web_no_export" };
  const exportPayload = { ...payload, stamp: payload.stamp ?? String(deps.now().getTime()) };
  const folder = exportFolder(data.workspace_id, data.id, exportPayload.stamp);
  try {
    const { data: ws } = await db.from("workspaces").select("name, brand_name").eq("id", data.workspace_id).maybeSingle();
    const workspaceName = (ws as { brand_name?: string | null; name?: string } | null)?.brand_name || (ws as { name?: string } | null)?.name || undefined;
    const customVars = Array.isArray(data.custom_vars) ? (data.custom_vars as unknown as CustomVar[]) : [];
    const values = { ...sampleValues({ customVars, workspaceName }), ...(payload.values ?? {}) };
    const html = await pagesHtml(db, data, parsed.doc, values);
    return await exportFiles(db, deps, { workspaceId: data.workspace_id, pieceId: data.id, html, base: { width: format.width, height: format.height, scale: format.exportScale }, payload: exportPayload });
  } catch (err) {
    return exportFailure(db, exportPayload, folder, err, deps);
  }
}

/** El documento de la última publicación de un diseño propio; null si nunca se publicó (vale el vigente); "error" si no se pudo leer. */
async function latestPublishedDoc(db: Db, designId: string): Promise<unknown | null | "error"> {
  try {
    const { data, error } = await db
      .from("design_versions")
      .select("doc")
      .eq("design_id", designId)
      .eq("reason", "publish")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[design_render] no pude leer la última publicación:", error.message);
      return "error";
    }
    return (data as { doc?: unknown } | null)?.doc ?? null;
  } catch (error) {
    console.error("[design_render] no pude leer la última publicación:", error instanceof Error ? error.message : "error");
    return "error";
  }
}

/** Corre un render. Recibe todo por parámetro: se prueba con un cliente y un servicio simulados. */
export async function runDesignRender(db: Db, payload: DesignRenderPayload, depsIn: RenderDeps = {}): Promise<RenderOutcome> {
  const deps: Required<RenderDeps> = { render: depsIn.render ?? ((r) => renderDesign(r)), now: depsIn.now ?? (() => new Date()), schedule: depsIn.schedule ?? scheduleJob };
  if (payload.templateId && !payload.designId) {
    if (payload.purpose !== "export") return { status: "skipped", reason: "template_only_exports" };
    return runTemplateExport(db, payload, deps);
  }
  if (!payload.designId) return { status: "skipped", reason: "no_target" };
  const { data, error } = await db
    .from("designs")
    .select("id, workspace_id, doc, format, code, rev, values, template_id, subject_contact_id, subject_ref, renders, attempts")
    .eq("id", payload.designId)
    .maybeSingle();
  if (error) {
    console.error("[design_render] no pude leer el diseño:", error.message);
    return { status: "skipped", reason: "read_failed" };
  }
  if (!data) return { status: "skipped", reason: "not_found" };
  const row = data as unknown as DesignRow;

  // Publicar de un diseño propio arma los archivos de lo PUBLICADO (la última versión `publish`), no del borrador:
  // lo que se edita después recién llega al link con «Publicar cambios» (auditoría de la Ola 2, igual que la 00325).
  let sourceDoc: unknown = row.doc;
  if (payload.purpose === "publish" && !row.template_id) {
    const published = await latestPublishedDoc(db, row.id);
    // Un error de lectura nunca abre: no se arma el link con el borrador, se reintenta (1, 5 y 15 minutos).
    if (published === "error") {
      return noteFailure(db, row, payload, new RenderFailed("No se pudo leer la última publicación.", { retryable: true, userMessage: "No se pudo preparar la versión publicada. Se vuelve a intentar solo." }), deps);
    }
    sourceDoc = published ?? row.doc;
  }
  const parsed = parseDesignDoc(sourceDoc);
  if (!parsed.ok) return noteFailure(db, row, payload, new RenderFailed("El documento del diseño no es válido.", { retryable: false }), deps);
  const doc = parsed.doc;
  const format = FORMATS[doc.format];
  if (format.primaryExport === "none") return { status: "skipped", reason: "web_no_export" };

  const exportPayload = { ...payload, stamp: payload.stamp ?? String(deps.now().getTime()) };
  try {
    const isGeneration = !!row.template_id && payload.purpose !== "export";
    if (isGeneration) await db.from("designs").update({ status: "rendering" }).eq("id", row.id);
    const html = await pagesHtml(db, row, doc, { ...valuesOf(row), ...(payload.values ?? {}) });
    const base = { width: format.width, height: format.height, scale: format.exportScale } as const;

    if (payload.purpose === "export") {
      try {
        return await exportFiles(db, deps, { workspaceId: row.workspace_id, pieceId: row.id, html, base, payload: exportPayload });
      } catch (err) {
        return exportFailure(db, exportPayload, exportFolder(row.workspace_id, row.id, exportPayload.stamp), err, deps);
      }
    }

    // El juego vigente: un PNG por página y un PDF con todas.
    const pngs = await deps.render({ ...base, pages: html.map((h) => ({ html: h })), format: "png" });
    const pdf = await deps.render({ ...base, pages: html.map((h) => ({ html: h })), format: "pdf" });
    const version = `${row.rev}-${deps.now().getTime()}`;
    const folder = renderFolder(row.workspace_id, row.id, version);
    const pages: string[] = [];
    for (const file of pngs.files) {
      const path = `${folder}/${pageFileName(file.page)}`;
      await upload(db, path, file.bytes, "image/png");
      pages.push(path);
    }
    const pdfPath = `${folder}/document.pdf`;
    await upload(db, pdfPath, pdf.files[0].bytes, "application/pdf");
    const set: RenderSet = { version, pdf_path: pdfPath, pages, rendered_at: deps.now().toISOString() };
    const previous = row.renders;

    const { error: updateError } = await db
      .from("designs")
      .update({ renders: set as never, error: null, attempts: 0, next_attempt_at: null, ...(isGeneration ? { status: "ready" as const } : {}) })
      .eq("id", row.id);
    if (updateError) throw new RenderFailed(`No se pudo guardar el resultado (${updateError.message}).`, { retryable: true });

    // F48b: un solo juego de archivos por diseño propio. Las generaciones nunca borran nada.
    if (!row.template_id) await releasePreviousRenders(db, previous, set);
    if (isGeneration && row.template_id) {
      await emitDesignGenerated({
        designId: row.id,
        workspaceId: row.workspace_id,
        templateId: row.template_id,
        code: row.code,
        subjectContactId: row.subject_contact_id,
        subjectRef: (row.subject_ref as SubjectRef | null) ?? null,
      });
    }
    return { status: "rendered", set };
  } catch (err) {
    if (payload.purpose === "export") return exportFailure(db, exportPayload, exportFolder(row.workspace_id, row.id, exportPayload.stamp), err, deps);
    return noteFailure(db, row, payload, err, deps);
  }
}

/** Encola un render. `dedupeKey` evita dos renders pendientes iguales (doble clic). */
export async function enqueueDesignRender(db: Db, payload: DesignRenderPayload, runAt: Date = new Date()): Promise<void> {
  const target = payload.designId ?? `t:${payload.templateId ?? ""}`;
  const key = payload.purpose === "export" ? `design_render:${target}:export:${payload.stamp ?? ""}` : `design_render:${target}:${payload.purpose}`;
  try {
    await scheduleJob(db, DESIGN_RENDER_JOB, { ...payload }, runAt, key);
  } catch (error) {
    // 23505 = ya hay uno pendiente igual: alcanza con ese.
    if ((error as { code?: string })?.code !== "23505") throw error;
  }
}
