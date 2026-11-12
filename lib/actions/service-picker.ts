"use server";
// @plantilla-quitar(servicios)

import { getWorkspace } from "@/lib/workspace";
import { loadServicePicker } from "@/lib/services/service-picker-load";
import type { ServicePickerOptions } from "@/lib/services/service-picker";

/**
 * Las listas de Servicios del editor de automatizaciones (F122): producto › variante › fases › pasos, con su nombre.
 * Con la sesion de quien edita (el catalogo lo lee cualquier miembro, como los filtros de Ventas). Ante un error, listas
 * vacias: el panel lo dice y no deja elegir.
 */
export async function loadServicePickerOptions(): Promise<{ ok: true; options: ServicePickerOptions } | { ok: false }> {
  const { workspace, supabase } = await getWorkspace();
  try {
    return { ok: true, options: await loadServicePicker(supabase, workspace.id) };
  } catch (error) {
    console.error("[servicios] no pude leer los caminos para el editor:", error instanceof Error ? error.message : "error");
    return { ok: false };
  }
}
