"use server";

/**
 * Server Actions del editor (DS2): crear, guardar con `rev`, renombrar, duplicar, archivar, borrar,
 * versiones, restaurar, subir imágenes y la configuración de una plantilla.
 *
 * Contrato de la Ola 1: firmas definitivas (`lib/designer/contracts.ts`). Cada acción valida su permiso adentro
 * (`getPermissionAction`) y escribe con el cliente de servicio filtrando por el negocio de la SESIÓN (nunca el que
 * mande el navegador). La lógica está en `lib/designer/designs-core.ts`, que se prueba sin la base.
 *
 * En un archivo "use server" todo lo exportado es una función asincrónica: los tipos viven en
 * `lib/designer/designs-types.ts`.
 */

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { resolveBrand } from "@/lib/brand";
import { createServiceClient } from "@/lib/supabase/server";
import type { ActionResult, CreateDesignInput, DesignTarget, SaveDocResult, TemplateSettingsInput, VersionSummary } from "@/lib/designer/contracts";
import { createDesignCore, isOwnImagePath, type CoreEnv } from "@/lib/designer/designs-core";
import { archiveCore, deleteCore, duplicateCore, listVersionsCore, renameCore, restoreVersionCore, saveDocCore, updateTemplateSettingsCore } from "@/lib/designer/designs-ops";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import type { AiNotice, CreatedDesign, UploadedFile, UploadedImage } from "@/lib/designer/designs-types";
import { MAX_IMAGE_BYTES, DESIGN_ASSETS_BUCKET, pathBelongsTo, signAssetUrls, uploadDesignImage } from "@/lib/designer/storage";
import { parseDesignSettings } from "@/lib/designer/settings-schema";
import { startAiDesign, proposeTemplateTexts } from "@/lib/actions/designer/ai";

const NO_PERMISSION = "No tenés permiso para editar diseños.";
const MAX_AI_IMAGES = 6;

/** El contexto de una acción de edición: la persona y el negocio salen de la sesión. */
async function editContext(keys: readonly string[] = ["designer.edit"]) {
  // Todas las claves tienen que estar: cada una se pregunta por separado y la sesión decide.
  let ctx: Awaited<ReturnType<typeof getPermissionAction>> = null;
  for (const key of keys) {
    ctx = await getPermissionAction(key);
    if (!ctx) return null;
  }
  if (!ctx) return null;
  const service = await createServiceClient();
  const env: CoreEnv = { service, actor: { workspaceId: ctx.workspace.id, userId: ctx.user.id } };
  return { ctx, env };
}

function aiNotice(error: string): AiNotice {
  return /todav[ií]a no est[aá] construid/i.test(error) ? "pendiente" : "error";
}

/**
 * Crear un diseño o una plantilla (F16). «Con IA» crea el diseño y le pide la primera versión a la IA; si la IA
 * todavía no está (o falla), el diseño igual queda creado y el editor muestra el aviso. «Cargar HTML» lo hace
 * `importHtml` (DS4): acá no entra.
 */
export async function createDesign(input: CreateDesignInput): Promise<ActionResult<CreatedDesign>> {
  const scope = await editContext();
  if (!scope) return { ok: false, error: NO_PERMISSION };
  const { ctx, env } = scope;
  try {
    const attachments = input.attachments ?? [];
    if (input.origin === "ai" && attachments.length > MAX_AI_IMAGES) return { ok: false, error: `Podés adjuntar hasta ${MAX_AI_IMAGES} imágenes.` };
    if (attachments.some((a) => !isOwnImagePath(a.asset_path, ctx.workspace.id))) return { ok: false, error: "Una de las imágenes no es de este negocio." };

    const settings = parseDesignSettings(ctx.workspace.design_settings, ctx.workspace.id);
    const customStyles = settings.ok ? settings.settings.styles : [];
    const created = await createDesignCore(env, input, { brandColor: resolveBrand(ctx.workspace).colorHex, customStyles });
    if (!created.ok) return { ok: false, error: created.error };
    const { id, kind, href } = created.data;

    let notice: AiNotice | null = null;
    if (input.origin === "ai") {
      const asked = await startAiDesign({ kind, id, prompt: (input.prompt ?? "").trim(), style: input.style ?? null, attachments, multiPage: input.multiPage === true, ...(input.contentContext ? { contentContext: input.contentContext } : {}) });
      if (!asked.ok) notice = aiNotice(asked.error);
    } else if (input.origin === "image" && kind === "template" && input.proposeTexts) {
      const asked = await proposeTemplateTexts({ templateId: id });
      if (!asked.ok) notice = aiNotice(asked.error);
    }
    revalidatePath("/dashboard/disenos");
    return { ok: true, data: { id, kind, href, notice } };
  } catch (error) {
    console.error("[designer] createDesign falló:", error instanceof Error ? error.message : "error");
    return { ok: false, error: "No pudimos crear el diseño. Probá de nuevo." };
  }
}

/**
 * Guardar con control de versión (F27): `UPDATE … WHERE rev = $rev`. Con una `rev` vieja responde `conflict` con lo
 * vigente (nunca pisa en silencio). Valida el documento con `parseDesignDoc`; en una plantilla acepta además las
 * variables propias (`customVars`), que se validan acá. No encola ningún render.
 */
export async function saveDesignDoc(input: DesignTarget & { doc: unknown; rev: number; customVars?: unknown }): Promise<SaveDocResult> {
  const scope = await editContext();
  if (!scope) return { ok: false, error: NO_PERMISSION };
  try {
    return await saveDocCore(scope.env, { kind: input.kind, id: input.id, doc: input.doc, rev: input.rev, customVars: input.customVars });
  } catch (error) {
    console.error("[designer] saveDesignDoc falló:", error instanceof Error ? error.message : "error");
    return { ok: false, error: "No pudimos guardar. Probá de nuevo." };
  }
}

export async function renameDesign(input: DesignTarget & { name: string }): Promise<ActionResult> {
  const scope = await editContext();
  if (!scope) return { ok: false, error: NO_PERMISSION };
  const result = await renameCore(scope.env, input, input.name);
  if (result.ok) revalidatePath("/dashboard/disenos");
  return result;
}

export async function duplicateDesign(input: DesignTarget): Promise<ActionResult<{ id: string; href: string }>> {
  const scope = await editContext();
  if (!scope) return { ok: false, error: NO_PERMISSION };
  const result = await duplicateCore(scope.env, input);
  if (result.ok) revalidatePath("/dashboard/disenos");
  return result;
}

/**
 * Archivar: un diseño publicado pide confirmación (`needsConfirm`) y se despublica antes. Con `restore: true` lo saca
 * de archivados. Nunca borra.
 */
export async function archiveDesign(input: DesignTarget & { confirmUnpublish?: boolean; restore?: boolean }): Promise<ActionResult<{ needsConfirm?: boolean }>> {
  const scope = await editContext();
  if (!scope) return { ok: false, error: NO_PERMISSION };
  const result = await archiveCore(scope.env, input, { confirmUnpublish: input.confirmUnpublish, restore: input.restore });
  if (result.ok) revalidatePath("/dashboard/disenos");
  return result;
}

/** Borrar definitivamente: solo borradores sin uso y con `designer.manage`. */
export async function deleteDesign(input: DesignTarget): Promise<ActionResult> {
  const ctx = await getPermissionAction("designer.manage");
  if (!ctx) return { ok: false, error: "Borrar definitivamente lo hace quien administra el Diseñador IA." };
  const service = await createServiceClient();
  const result = await deleteCore({ service, actor: { workspaceId: ctx.workspace.id, userId: ctx.user.id } }, input, true);
  if (result.ok) revalidatePath("/dashboard/disenos");
  return result;
}

/** Las versiones más nuevas primero, con su documento para dibujar la miniatura en vivo. Se lee con la sesión: la RLS decide. */
export async function listVersions(input: DesignTarget): Promise<ActionResult<VersionSummary[]>> {
  const ctx = await getPermissionAction("designer.view");
  if (!ctx) return { ok: false, error: "No tenés permiso para ver diseños." };
  try {
    const members = await getWorkspaceMembers(ctx.workspace.id);
    const names = new Map(members.map((m) => [m.userId, m.name]));
    return { ok: true, data: await listVersionsCore(ctx.supabase, ctx.workspace.id, input, names) };
  } catch (error) {
    console.error("[designer] listVersions falló:", error instanceof Error ? error.message : "error");
    return { ok: false, error: "No pudimos leer las versiones. Probá de nuevo." };
  }
}

/** Restaurar crea una versión nueva (nunca borra). */
export async function restoreVersion(input: DesignTarget & { versionId: string }): Promise<ActionResult<{ rev: number }>> {
  const scope = await editContext();
  if (!scope) return { ok: false, error: NO_PERMISSION };
  const result = await restoreVersionCore(scope.env, input, input.versionId);
  if (result.ok) revalidatePath("/dashboard/disenos");
  return result;
}

/** Sube una imagen validada por sus bytes a `design-assets`. Devuelve la ruta y un link firmado para verla. */
export async function uploadDesignImageAction(form: FormData): Promise<ActionResult<UploadedFile>> {
  const scope = await editContext();
  if (!scope) return { ok: false, error: NO_PERMISSION };
  const { ctx, env } = scope;
  try {
    const file = form.get("file");
    if (!(file instanceof File)) return { ok: false, error: "Elegí una imagen." };
    if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "La imagen pesa más de 20 MB." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    // La validez se mira por los BYTES, nunca por la extensión ni por el tipo que declara el navegador: un `.png` que no
    // es un PNG se rechaza, y un SVG también («Usá PNG o JPG»).
    const uploaded = await uploadDesignImage(env.service, ctx.workspace.id, bytes);
    if (!uploaded.ok) return { ok: false, error: uploaded.error };
    const urls = await signAssetUrls(env.service, ctx.workspace.id, [uploaded.path]);
    const name = file.name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f]/g, "").slice(0, 120) || "imagen";
    return { ok: true, data: { path: uploaded.path, url: urls.get(uploaded.path) ?? "", name, mime: uploaded.mime } };
  } catch (error) {
    console.error("[designer] uploadDesignImageAction falló:", error instanceof Error ? error.message : "error");
    return { ok: false, error: "No se pudo subir la imagen. Probá con una más liviana." };
  }
}

/** Links firmados (10 minutos) para dibujar archivos del negocio: solo rutas de SU negocio, nunca una ajena. */
export async function signDesignAssetUrls(paths: string[]): Promise<ActionResult<Record<string, string>>> {
  const ctx = await getPermissionAction("designer.view");
  if (!ctx) return { ok: false, error: "No tenés permiso para ver diseños." };
  const mine = [...new Set((Array.isArray(paths) ? paths : []).filter((p): p is string => typeof p === "string" && pathBelongsTo(p, ctx.workspace.id)))].slice(0, 200);
  const map = await signAssetUrls(ctx.supabase, ctx.workspace.id, mine);
  return { ok: true, data: Object.fromEntries(map) };
}

/** Las imágenes ya subidas en este negocio (para elegirlas en «Agregar» sin volver a subirlas). Las más nuevas primero. */
export async function listUploadedImages(): Promise<ActionResult<UploadedImage[]>> {
  const ctx = await getPermissionAction("designer.view");
  if (!ctx) return { ok: false, error: "No tenés permiso para ver diseños." };
  const { data, error } = await ctx.supabase.storage.from(DESIGN_ASSETS_BUCKET).list(`${ctx.workspace.id}/images`, { limit: 60, sortBy: { column: "created_at", order: "desc" } });
  if (error) return { ok: false, error: "No pudimos leer tus imágenes. Probá de nuevo." };
  const paths = (data ?? []).filter((f) => f.name && !f.name.endsWith("/")).map((f) => `${ctx.workspace.id}/images/${f.name}`);
  const map = await signAssetUrls(ctx.supabase, ctx.workspace.id, paths);
  return { ok: true, data: paths.flatMap((path) => (map.get(path) ? [{ path, url: map.get(path) as string }] : [])) };
}

/**
 * Configuración de una plantilla (F28): formato, verificación y tipo, formato de fecha, descarga y variables propias.
 *
 * «Permitir descargar» decide si el mundo puede bajar lo que se genera, así que pide `designer.publish` (§4.1) y no
 * `designer.edit`. Todo lo demás (formato, verificación, tipo, fechas, variables) sigue pidiendo `designer.edit`. Un
 * pedido que toca las dos cosas pide las dos claves.
 */
export async function updateTemplateSettings(input: TemplateSettingsInput): Promise<ActionResult<{ notice: string | null }>> {
  const touchesDownload = input.allow_download !== undefined;
  const touchesOther = Object.entries(input).some(([key, value]) => key !== "id" && key !== "allow_download" && value !== undefined);
  const keys = [...(touchesOther || !touchesDownload ? ["designer.edit"] : []), ...(touchesDownload ? ["designer.publish"] : [])];
  const scope = await editContext(keys);
  if (!scope) return { ok: false, error: NO_PERMISSION };
  try {
    const result = await updateTemplateSettingsCore(scope.env, input);
    if (result.ok) revalidatePath("/dashboard/disenos");
    return result;
  } catch (error) {
    console.error("[designer] updateTemplateSettings falló:", error instanceof Error ? error.message : "error");
    return { ok: false, error: "No pudimos guardar la configuración. Probá de nuevo." };
  }
}
