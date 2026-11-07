"use server";

/**
 * Ajustes del Diseñador IA (DS3, F11 y F37): estilos propios y fuentes. Piden `designer.manage`.
 *
 * Cada acción valida el permiso adentro (`getPermissionAction`), saca el negocio y la persona de la SESIÓN
 * y escribe con el cliente de servicio (`design_settings` se valida con `parseDesignSettings(json, workspaceId)`
 * antes de guardar). Nunca lanzan hacia la pantalla. La lógica está en `lib/designer/settings-requests.ts`.
 *
 * Firmas del contrato de la Ola 1 (`lib/designer/contracts.ts`).
 */

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/designer/contracts";
import type { DesignStyle } from "@/lib/designer/styles";
import { MAX_STYLE_IMAGE_BYTES } from "@/lib/designer/ai/style-extract";
import { addGoogleFontRequest, archiveStyleRequest, extractStyleRequest, removeFontRequest, saveStyleRequest, uploadFontRequest } from "@/lib/designer/settings-requests";

const NO_PERMISSION = "No tenés permiso para hacer esto.";
const GENERIC = "No pude hacerlo ahora. Probá de nuevo.";
const SETTINGS_PATH = "/dashboard/disenos/ajustes";

type Service = Awaited<ReturnType<typeof createServiceClient>>;
type Ctx = NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>;

/** Valida `designer.manage` y arma el cliente de servicio; un imprevisto no lanza hacia la pantalla. */
async function guarded<T>(run: (ctx: Ctx, service: Service) => Promise<ActionResult<T>>, refresh = true): Promise<ActionResult<T>> {
  try {
    const ctx = await getPermissionAction("designer.manage");
    if (!ctx) return { ok: false, error: NO_PERMISSION };
    const result = await run(ctx, await createServiceClient());
    if (result.ok && refresh) revalidatePath(SETTINGS_PATH);
    return result;
  } catch (error) {
    console.error("[designer-settings] la acción falló:", error instanceof Error ? error.message : "error");
    return { ok: false, error: GENERIC };
  }
}

const isFile = (value: FormDataEntryValue): value is File => typeof value !== "string" && typeof (value as File).arrayBuffer === "function";

/** "+ Crear desde mis piezas": la IA extrae un estilo de 3 a 5 imágenes (`images`) o diseños propios (`designIds`). */
export async function extractStyle(form: FormData): Promise<ActionResult<{ style: DesignStyle; corrections: string[] }>> {
  return guarded(
    async (ctx, service) => {
      const files = form.getAll("images").filter(isFile);
      const tooBig = files.find((f) => f.size > MAX_STYLE_IMAGE_BYTES);
      if (tooBig) return { ok: false, error: `«${tooBig.name}» pesa más de 8 MB.` };
      const loaded = await Promise.all(files.map(async (f) => ({ name: f.name || "imagen", bytes: new Uint8Array(await f.arrayBuffer()) })));
      const designIds = form.getAll("designIds").filter((v): v is string => typeof v === "string" && v.length > 0);
      const name = form.get("name");
      return extractStyleRequest(service, { workspaceId: ctx.workspace.id, userId: ctx.user.id, files: loaded, designIds, name: typeof name === "string" ? name : undefined });
    },
    false,
  );
}

export async function saveStyle(input: { style: DesignStyle }): Promise<ActionResult> {
  const result = await guarded((ctx, service) => saveStyleRequest(service, { workspaceId: ctx.workspace.id, userId: ctx.user.id }, input.style));
  return result.ok ? { ok: true, data: undefined } : result;
}

export async function archiveStyle(input: { key: string }): Promise<ActionResult> {
  return guarded((ctx, service) => archiveStyleRequest(service, { workspaceId: ctx.workspace.id, userId: ctx.user.id }, input.key));
}

/** "Otra fuente de Google": la valida pidiéndola a Google desde el servidor (200 = existe). */
export async function addGoogleFont(input: { family: string }): Promise<ActionResult<{ family: string }>> {
  return guarded((ctx, service) => addGoogleFontRequest(service, { workspaceId: ctx.workspace.id, userId: ctx.user.id }, input.family));
}

/** "Subir mi fuente": .woff2, .woff, .ttf u .otf de hasta 2 MB, validada por bytes. Campos: `file`, `family`, `weight`, `italic`. */
export async function uploadFont(form: FormData): Promise<ActionResult<{ family: string; weight: number }>> {
  return guarded(async (ctx, service) => {
    const file = form.get("file");
    if (!file || !isFile(file)) return { ok: false, error: "Elegí un archivo de fuente." };
    const family = form.get("family");
    const weight = Number(form.get("weight") ?? 400);
    const italic = form.get("italic");
    return uploadFontRequest(service, {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      bytes: new Uint8Array(await file.arrayBuffer()),
      fileName: file.name,
      family: typeof family === "string" ? family : undefined,
      weight,
      italic: italic === "true" || italic === "on",
    });
  });
}

export async function removeFont(input: { family: string; path?: string }): Promise<ActionResult> {
  return guarded((ctx, service) => removeFontRequest(service, { workspaceId: ctx.workspace.id, userId: ctx.user.id }, input));
}
