/**
 * ¿Mostrar "Mi reporte del día" en el menú? Se calcula en el servidor, con una caché corta
 * (60 s, por workspace y persona): el layout lo pide en cada pantalla. Publicar, pausar o
 * cambiar la audiencia de un EOD se nota en el menú en menos de un minuto.
 */
import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { hasEodToComplete } from "./load";

export async function eodNavFlag(workspaceId: string, userId: string): Promise<boolean> {
  try {
    return await unstable_cache(
      async () => hasEodToComplete(await createServiceClient(), workspaceId, userId),
      ["eod-nav", workspaceId, userId],
      { revalidate: 60, tags: [`eod-nav:${workspaceId}`] },
    )();
  } catch (error) {
    // El menú nunca se cae por esto: sin el dato, el ítem no aparece (la ruta sigue andando).
    console.error("[eod] no pude calcular el ítem del menú:", error instanceof Error ? error.message : "error");
    return false;
  }
}
