"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import type { PieceLinkDestinations } from "@/lib/attribution/piece-link-destinations";
import { loadLinkDestinations } from "@/lib/attribution/load-link-destinations";

/**
 * Los formularios y las agendas que ofrece «Armar un link» de una pieza (ver `lib/attribution/piece-link-destinations.ts`).
 * Se piden al abrir el panel, no con el drawer: abrir una pieza no espera algo que casi nunca se usa.
 *
 * Lo abre quien ve la pieza (`content.view`). Cada grupo pide además su clave: formularios `forms.view`; agendas
 * `scheduling.use` o `bookings.view` (las de la pantalla de Agenda). Sin la clave, el grupo viene vacío, no un error.
 * Lee con la sesión de la persona (la RLS decide) y el negocio sale de la sesión.
 *
 * En un archivo `"use server"` todo lo exportado es una función asincrónica.
 */
export async function loadPieceLinkDestinations(): Promise<{ ok: true; destinations: PieceLinkDestinations } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("content.view");
  if (!ctx) return { ok: false, error: "No tenés permiso para ver esta pieza." };

  try {
    return { ok: true, destinations: await loadLinkDestinations(ctx) };
  } catch (error) {
    console.error("[contenido] no pude cargar los destinos del link:", error instanceof Error ? error.message : "error desconocido");
    // @plantilla-desde(formularios)
    return { ok: false, error: "No pude cargar tus formularios y agendas. Podés pegar el link a mano." };
    // @plantilla-hasta(formularios)
    // @plantilla-sin(formularios): return { ok: false, error: "No pude cargar tus agendas. Podés pegar el link a mano." };
  }
}
