/**
 * Pedir y seguir una exportación (F46). Solo servidor.
 *
 * - `requestExportCore` revisa el diseño (o la plantilla) del negocio de la SESIÓN, arma el plan con `exportPlan`
 *   y encola un `design_render` con `purpose: "export"` y una marca (`stamp`) que sabe quien pide, así después
 *   sabe en qué carpeta mirar: `design-renders/<negocio>/<pieza>/exports/<marca>/`.
 * - `exportStatusCore` mira esa carpeta: si el archivo está, devuelve un link firmado de corta duración para
 *   bajarlo; si el job dejó `error.json`, devuelve el motivo (nunca queda «preparando» para siempre); si ya
 *   pasó mucho tiempo sin nada, también corta.
 * - Plantillas: «Exportar prueba» con datos de ejemplo (`sampleValues`, los arma el job): no crea una
 *   generación ni un link.
 * - Sin el servicio de render: «Falta conectar el servicio de render».
 *
 * Todo recibe el cliente de servicio y lo demás por parámetro: se prueba sin red.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { DesignTarget, ExportResult } from "./contracts";
import { parseDesignDoc } from "./doc/schema";
import {
  EXPORT_GIVE_UP_MS,
  exportDownloadName,
  exportPlan,
  exportStampAgeMs,
  isExportKind,
  isValidExportStamp,
  newExportStamp,
  storedExportFile,
  type ExportKind,
} from "./export";
import { EXPORT_ERROR_FILE, enqueueDesignRender, type DesignRenderPayload } from "./jobs/render";
import { isRenderConfigured, RENDER_NOT_CONFIGURED_MESSAGE } from "./render-client";
import { DESIGN_RENDERS_BUCKET, exportFolder } from "./storage";

type Db = SupabaseClient<Database>;

export interface ExportActor {
  workspaceId: string;
}

export interface ExportDeps {
  enqueue?: typeof enqueueDesignRender;
  now?: () => Date;
  random?: () => number;
  renderConfigured?: () => boolean;
}

export const EXPORT_LINK_SECONDS = 120;
export const EXPORT_FAILED = "No se pudo armar el archivo. Probá de nuevo.";

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

interface PieceRow {
  id: string;
  name: string;
  doc: unknown;
}

/** El diseño o la plantilla del negocio de la sesión. Un id de otro negocio es «no existe». */
async function readPiece(db: Db, workspaceId: string, target: DesignTarget): Promise<{ ok: true; row: PieceRow } | { ok: false; error: string }> {
  const table = target.kind === "template" ? "design_templates" : "designs";
  const { data, error } = await db.from(table).select("id, name, doc").eq("id", target.id).eq("workspace_id", workspaceId).maybeSingle();
  if (error) {
    console.error("[disenos] no pude leer la pieza para exportar:", error.message);
    return fail("No se pudo leer el diseño. Probá de nuevo.");
  }
  if (!data) return fail("No encontramos ese diseño.");
  return { ok: true, row: data as unknown as PieceRow };
}

export async function requestExportCore(db: Db, actor: ExportActor, input: DesignTarget & { exportKind: ExportKind; page?: number }, depsIn: ExportDeps = {}): Promise<ExportResult> {
  const enqueue = depsIn.enqueue ?? enqueueDesignRender;
  const now = depsIn.now ?? (() => new Date());
  const configured = depsIn.renderConfigured ?? (() => isRenderConfigured());
  if (!isExportKind(input.exportKind)) return fail("Ese tipo de archivo no existe.");

  const found = await readPiece(db, actor.workspaceId, input);
  if (!found.ok) return found;
  const parsed = parseDesignDoc(found.row.doc);
  if (!parsed.ok) return fail("El documento del diseño no es válido. Abrilo y guardalo de nuevo.");
  const plan = exportPlan(parsed.doc, input.exportKind, input.page);
  if (!plan.ok) return fail(plan.error);
  if (!configured()) return fail(RENDER_NOT_CONFIGURED_MESSAGE);

  const stamp = newExportStamp(now(), depsIn.random);
  const common = { purpose: "export" as const, exportKind: input.exportKind, stamp, ...(input.exportKind === "png" ? { page: plan.pages[0] } : {}) };
  const payload: DesignRenderPayload = input.kind === "template" ? { ...common, templateId: found.row.id } : { ...common, designId: found.row.id };
  try {
    await enqueue(db, payload, now());
  } catch (error) {
    console.error("[disenos] no pude encolar la exportación:", error instanceof Error ? error.message : "error");
    return fail("No se pudo preparar el archivo. Probá de nuevo.");
  }
  return { ok: true, data: { status: "preparing", stamp } };
}

export async function exportStatusCore(db: Db, actor: ExportActor, input: DesignTarget & { exportKind: ExportKind; stamp: string; page?: number }, depsIn: ExportDeps = {}): Promise<ExportResult> {
  const now = depsIn.now ?? (() => new Date());
  if (!isExportKind(input.exportKind) || !isValidExportStamp(input.stamp)) return fail("El pedido no es válido.");
  if (input.page !== undefined && (!Number.isInteger(input.page) || input.page < 0)) return fail("El pedido no es válido.");

  const found = await readPiece(db, actor.workspaceId, input);
  if (!found.ok) return found;

  const folder = exportFolder(actor.workspaceId, found.row.id, input.stamp);
  const stored = storedExportFile(input.exportKind, input.page ?? 0);
  const bucket = db.storage.from(DESIGN_RENDERS_BUCKET);

  const { data: listed, error: listError } = await bucket.list(folder, { limit: 20 });
  if (listError) console.error("[disenos] no pude mirar la carpeta de la exportación:", listError.message);
  const names = new Set((listed ?? []).map((item) => item.name));

  if (names.has(stored.file)) {
    const fileName = exportDownloadName(found.row.name, input.exportKind, input.exportKind === "png" ? input.page : undefined);
    const { data, error } = await bucket.createSignedUrl(`${folder}/${stored.file}`, EXPORT_LINK_SECONDS, { download: fileName });
    if (error || !data?.signedUrl) {
      console.error("[disenos] no pude firmar la descarga:", error?.message ?? "sin link");
      return fail("No se pudo preparar la descarga. Probá de nuevo.");
    }
    return { ok: true, data: { status: "ready", url: data.signedUrl, fileName } };
  }

  // El job dejó el motivo: se lo decimos a la persona en vez de dejarla esperando.
  if (names.has(EXPORT_ERROR_FILE)) return fail(await readExportError(bucket, `${folder}/${EXPORT_ERROR_FILE}`));

  // Pasado todo lo que reintenta el job (1, 5 y 15 minutos) sin archivo ni motivo, no hay nada más que esperar.
  const age = exportStampAgeMs(input.stamp, now());
  if (age !== null && age > EXPORT_GIVE_UP_MS) return fail(EXPORT_FAILED);
  return { ok: true, data: { status: "preparing", stamp: input.stamp } };
}

/** El motivo que dejó el job (`{ error }`), o un mensaje general si no se puede leer. */
async function readExportError(bucket: ReturnType<Db["storage"]["from"]>, path: string): Promise<string> {
  try {
    const { data, error } = await bucket.download(path);
    if (error || !data) return EXPORT_FAILED;
    const parsed = JSON.parse(await data.text()) as { error?: unknown };
    const message = typeof parsed.error === "string" ? parsed.error.trim() : "";
    return message ? message.slice(0, 300) : EXPORT_FAILED;
  } catch {
    return EXPORT_FAILED;
  }
}
