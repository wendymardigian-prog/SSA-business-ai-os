/**
 * Lee un diseño para el link público (F43). Solo servidor, con el cliente de servicio.
 *
 * Lo que se muestra sale SOLO de `design_public_get`: si devuelve vacío (un código que no existe, un borrador,
 * algo que no se puede mostrar), no hay nada más que leer. Con la respuesta en la mano se suman, y solo para
 * servir los archivos y armar la marca:
 *
 * - `designs.renders`: las rutas de los archivos (se revisan contra la carpeta del propio diseño);
 * - del negocio del diseño: su marca (`resolveBrand`), su dominio de links y, para una página web, las fuentes
 *   que subió.
 *
 * Nunca devuelve el negocio, el contacto ni los valores de la pieza hacia el navegador: solo el servidor los ve.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkspaceBrandFields } from "@/lib/brand";
import type { WorkspaceDomainSource } from "@/lib/public-url";
import type { Database } from "@/lib/types/database";
import { normalizeDesignCode } from "../public-links";
import { parsePublicDesign, parseRenders, type PublicDesign, type PublicRenders } from "./model";

/** Las columnas del negocio que hacen falta: su marca, su dominio y sus ajustes del Diseñador (fuentes subidas). */
export const PUBLIC_WORKSPACE_COLUMNS = "brand_name, brand_logo_path, brand_color, scheduling_public_base_url, design_settings";

export type PublicWorkspace = WorkspaceBrandFields & NonNullable<WorkspaceDomainSource> & { design_settings?: unknown };

export interface PublicRecord {
  pub: PublicDesign;
  designId: string;
  workspaceId: string;
  renders: PublicRenders | null;
  workspace: PublicWorkspace;
}

export async function loadPublicDesign(service: SupabaseClient<Database>, rawCode: string | null | undefined): Promise<PublicRecord | null> {
  const code = normalizeDesignCode(rawCode);
  if (!code) return null;
  try {
    const { data, error } = await service.rpc("design_public_get", { p_code: code });
    if (error) {
      console.error("[disenos] no pude leer el link público:", error.message);
      return null;
    }
    const pub = parsePublicDesign(data);
    if (!pub) return null;

    const { data: row, error: rowError } = await service.from("designs").select("id, workspace_id, renders").eq("code", pub.code).maybeSingle();
    if (rowError || !row) {
      if (rowError) console.error("[disenos] no pude leer los archivos del link público:", rowError.message);
      return null;
    }
    const { data: workspace, error: workspaceError } = await service.from("workspaces").select(PUBLIC_WORKSPACE_COLUMNS).eq("id", row.workspace_id).maybeSingle();
    if (workspaceError || !workspace) {
      if (workspaceError) console.error("[disenos] no pude leer la marca del link público:", workspaceError.message);
      return null;
    }
    return {
      pub,
      designId: row.id,
      workspaceId: row.workspace_id,
      renders: parseRenders(row.renders, row.workspace_id, row.id),
      workspace: workspace as unknown as PublicWorkspace,
    };
  } catch (error) {
    // Ante cualquier fallo, el link no se muestra: mejor un 404 que algo a medias.
    console.error("[disenos] falló la lectura del link público:", error instanceof Error ? error.message : "error");
    return null;
  }
}
