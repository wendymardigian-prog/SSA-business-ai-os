"use server";

/**
 * Lecturas de la pestaña Generaciones y de los modales de generar (DS6, F50, F53). Son acciones (y no una página del
 * servidor) porque la pestaña vive dentro del editor de la plantilla y se vuelve a leer sola cada 5 s mientras haya piezas
 * «En proceso».
 *
 * Leen con el cliente de LA PERSONA: la RLS decide qué plantillas, piezas y contactos ve. La lista y el detalle piden
 * `designer.view`; lo que prepara una emisión (la plantilla para los modales y el buscador de contactos), `designer.generate`.
 * Todo con el negocio de la SESIÓN. Los links salen del dominio del negocio, nunca del navegador.
 *
 * En un archivo "use server" todo lo exportado es una función asincrónica: los tipos viven en `generations-query.ts`.
 */

import { z } from "zod";
import { getPermissionAction } from "@/lib/auth/guards";
import type { ActionResult } from "@/lib/designer/contracts";
import { generationDetailCore, listGenerationsCore, loadGenerateContextCore, searchContactsCore, type ContactChoice, type GenerateContext, type GenerationDetail, type GenerationListView } from "@/lib/designer/generations-query";
import { designLinksFor } from "@/lib/designer/public-links";
import { parseGenerationFilters } from "@/lib/designer/screens/generations";
import { resolveViewerTimezone } from "@/lib/user-timezone";

const NO_PERMISSION = "No tenés permiso para ver esto.";
const BAD_REQUEST = "El pedido no es válido.";
const uuid = z.string().uuid();

/** Las generaciones de una plantilla: contadores, la página pedida y lo que dibuja cada fila. */
export async function listGenerations(input: { templateId: string; estado?: string; q?: string; pagina?: number }): Promise<ActionResult<GenerationListView>> {
  const ctx = await getPermissionAction("designer.view");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const parsed = z.object({ templateId: uuid, estado: z.string().max(20).optional(), q: z.string().max(200).optional(), pagina: z.number().int().min(1).max(10_000).optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_REQUEST };
  try {
    const filters = parseGenerationFilters({ estado: parsed.data.estado, q: parsed.data.q, pagina: parsed.data.pagina ? String(parsed.data.pagina) : undefined });
    const view = await listGenerationsCore(ctx.supabase, {
      workspaceId: ctx.workspace.id,
      templateId: parsed.data.templateId,
      filters,
      can: { generate: ctx.can("designer.generate") },
      timeZone: await resolveViewerTimezone(ctx.workspace.timezone),
      linkFor: (code) => designLinksFor(ctx.workspace, code).link,
    });
    return view ? { ok: true, data: view } : { ok: false, error: "No encontramos esa plantilla." };
  } catch (error) {
    console.error("[designer] listGenerations falló:", error instanceof Error ? error.message : "error");
    return { ok: false, error: "No pudimos cargar las generaciones. Probá de nuevo." };
  }
}

/** El detalle de una pieza (F54): valores usados, intentos, error y estado del email. */
export async function generationDetail(input: { designId: string }): Promise<ActionResult<GenerationDetail>> {
  const ctx = await getPermissionAction("designer.view");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const parsed = z.object({ designId: uuid }).safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_REQUEST };
  try {
    const detail = await generationDetailCore(ctx.supabase, {
      workspaceId: ctx.workspace.id,
      designId: parsed.data.designId,
      can: { generate: ctx.can("designer.generate") },
      timeZone: await resolveViewerTimezone(ctx.workspace.timezone),
      linkFor: (code) => designLinksFor(ctx.workspace, code).link,
    });
    return detail ? { ok: true, data: detail } : { ok: false, error: "No encontramos esa pieza." };
  } catch (error) {
    console.error("[designer] generationDetail falló:", error instanceof Error ? error.message : "error");
    return { ok: false, error: "No pudimos cargar el detalle. Probá de nuevo." };
  }
}

/** La plantilla para los modales de generar: su documento, sus variables, el texto del botón y los archivos firmados. */
export async function loadGenerateContext(input: { templateId: string }): Promise<ActionResult<GenerateContext>> {
  const ctx = await getPermissionAction("designer.generate");
  if (!ctx) return { ok: false, error: "No tenés permiso para generar piezas." };
  const parsed = z.object({ templateId: uuid }).safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_REQUEST };
  try {
    const loaded = await loadGenerateContextCore(ctx.supabase, ctx.workspace, parsed.data.templateId);
    return loaded ? { ok: true, data: loaded } : { ok: false, error: "No encontramos esa plantilla." };
  } catch (error) {
    console.error("[designer] loadGenerateContext falló:", error instanceof Error ? error.message : "error");
    return { ok: false, error: "No pudimos abrir la plantilla. Probá de nuevo." };
  }
}

/** El buscador de «Para»: contactos con la misma búsqueda de Contactos, como los ve la persona. */
export async function searchGenerateContacts(input: { query: string }): Promise<ActionResult<ContactChoice[]>> {
  const ctx = await getPermissionAction("designer.generate");
  if (!ctx) return { ok: false, error: "No tenés permiso para generar piezas." };
  const parsed = z.object({ query: z.string().max(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_REQUEST };
  try {
    const found = await searchContactsCore(ctx.supabase, { workspaceId: ctx.workspace.id, query: parsed.data.query, timeZone: await resolveViewerTimezone(ctx.workspace.timezone) });
    return { ok: true, data: found };
  } catch (error) {
    console.error("[designer] searchGenerateContacts falló:", error instanceof Error ? error.message : "error");
    return { ok: false, error: "No pudimos buscar contactos. Probá de nuevo." };
  }
}
