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
import { NOT_BUILT_YET, type ActionResult, type DesignTarget, type ExportKind, type ExportResult, type PublicOptions } from "@/lib/designer/contracts";
import { publishDesignCore, setPublicOptionsCore, unpublishDesignCore } from "@/lib/designer/publishing";

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

/** Exportar (F46): si el archivo está, el link; si no, se prepara y se consulta con `exportStatus`. */
export async function requestExport(_input: DesignTarget & { exportKind: ExportKind; page?: number }): Promise<ExportResult> {
  return NOT_BUILT_YET(2);
}

export async function exportStatus(_input: DesignTarget & { exportKind: ExportKind; stamp: string; page?: number }): Promise<ExportResult> {
  return NOT_BUILT_YET(2);
}

/** Anular una generación con verificación (F47): motivo obligatorio, nunca se borra. */
export async function voidDesign(_input: { designId: string; reason: string }): Promise<ActionResult> {
  return NOT_BUILT_YET(2);
}
