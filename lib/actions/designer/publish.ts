"use server";

/**
 * Publicar, despublicar y exportar (DS5, F43–F47). Publicar pide `designer.publish`; exportar, `designer.edit`;
 * anular, `designer.generate`. Los links salen de `publicBaseUrl` (dominio del negocio).
 *
 * Cada acción valida su permiso adentro (`getPermissionAction`), revisa la forma de lo que manda el navegador y
 * escribe con el cliente de servicio filtrando por el negocio de la SESIÓN (nunca el que manda el navegador).
 * La lógica está en `lib/designer/publishing.ts`.
 */

import { z } from "zod";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { type ActionResult, type DesignTarget, type ExportKind, type ExportResult, type PublicOptions } from "@/lib/designer/contracts";
import { exportStatusCore, requestExportCore } from "@/lib/designer/exporting";
import { publishDesignCore, setPublicOptionsCore, unpublishDesignCore, voidDesignCore } from "@/lib/designer/publishing";

const NO_PERMISSION = "No tenés permiso para hacer esto.";
const BAD_REQUEST = "El pedido no es válido.";

const optionsShape = {
  designId: z.string().uuid(),
  allowDownload: z.boolean().optional(),
  allowIndexing: z.boolean().optional(),
};

export async function publishDesign(input: { designId: string } & PublicOptions): Promise<ActionResult<{ link: string }>> {
  const ctx = await getPermissionAction("designer.publish");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const parsed = z.object(optionsShape).safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_REQUEST };
  return publishDesignCore(await createServiceClient(), { workspaceId: ctx.workspace.id, userId: ctx.user.id }, parsed.data);
}

export async function unpublishDesign(input: { designId: string }): Promise<ActionResult> {
  const ctx = await getPermissionAction("designer.publish");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const parsed = z.object({ designId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_REQUEST };
  return unpublishDesignCore(await createServiceClient(), { workspaceId: ctx.workspace.id, userId: ctx.user.id }, parsed.data);
}

export async function setPublicOptions(input: { designId: string } & PublicOptions): Promise<ActionResult> {
  const ctx = await getPermissionAction("designer.publish");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const parsed = z.object(optionsShape).safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_REQUEST };
  return setPublicOptionsCore(await createServiceClient(), { workspaceId: ctx.workspace.id, userId: ctx.user.id }, parsed.data);
}

const targetShape = {
  kind: z.enum(["design", "template"]),
  id: z.string().uuid(),
  exportKind: z.enum(["pdf", "zip", "png"]),
  page: z.number().int().min(0).max(34).optional(),
};

/**
 * Exportar (F46): se prepara el archivo (un `design_render` de exportación) y se consulta con `exportStatus`.
 * Con `designer.edit`. Una plantilla exporta una prueba con datos de ejemplo: no crea generación ni link.
 */
export async function requestExport(input: DesignTarget & { exportKind: ExportKind; page?: number }): Promise<ExportResult> {
  const ctx = await getPermissionAction("designer.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const parsed = z.object(targetShape).safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_REQUEST };
  return requestExportCore(await createServiceClient(), { workspaceId: ctx.workspace.id }, parsed.data);
}

/** Si el archivo ya está: el link firmado de corta duración para bajarlo; si falló, el motivo. */
export async function exportStatus(input: DesignTarget & { exportKind: ExportKind; stamp: string; page?: number }): Promise<ExportResult> {
  const ctx = await getPermissionAction("designer.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const parsed = z.object({ ...targetShape, stamp: z.string().max(40) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_REQUEST };
  return exportStatusCore(await createServiceClient(), { workspaceId: ctx.workspace.id }, parsed.data);
}

/**
 * Anular una generación (F47), con `designer.generate`: el motivo es obligatorio y nunca se borra; el link pasa
 * a mostrar «anulado» con ese motivo y deja de poder descargarse.
 */
export async function voidDesign(input: { designId: string; reason: string }): Promise<ActionResult> {
  const ctx = await getPermissionAction("designer.generate");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const parsed = z.object({ designId: z.string().uuid(), reason: z.string().max(2000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_REQUEST };
  return voidDesignCore(await createServiceClient(), { workspaceId: ctx.workspace.id, userId: ctx.user.id }, parsed.data);
}
