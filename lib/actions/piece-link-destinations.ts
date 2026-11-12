"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import { buildEventDestinations, type PieceLinkDestination, type PieceLinkDestinations } from "@/lib/attribution/piece-link-destinations";
import { loadFormLinkDestinations } from "@/lib/forms/link-destinations"; // @plantilla-quitar(formularios)
import { publicBaseUrl, type WorkspaceDomainSource } from "@/lib/public-url";
import { listEventTypes } from "@/lib/scheduling/data/event-types";

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

  const workspaceId = ctx.workspace.id;
  const base = publicBaseUrl(ctx.workspace as WorkspaceDomainSource);

  const loadEvents = async (): Promise<PieceLinkDestination[]> => {
    if (!ctx.can("scheduling.use") && !ctx.can("bookings.view")) return [];
    const [events, profiles] = await Promise.all([
      listEventTypes(ctx.supabase, workspaceId),
      ctx.supabase.from("scheduling_profiles").select("user_id, username, display_name, is_active").eq("workspace_id", workspaceId),
    ]);
    if (profiles.error) throw new Error(`no pude leer los perfiles de agenda: ${profiles.error.message}`);
    return buildEventDestinations({ events, profiles: profiles.data ?? [], base });
  };

  try {
    const formsPromise = ctx.can("forms.view") ? loadFormLinkDestinations(ctx.supabase, workspaceId, base) : Promise.resolve([]); // @plantilla-quitar(formularios)
    // @plantilla-sin(formularios): const formsPromise = Promise.resolve<PieceLinkDestination[]>([]);
    const [forms, events] = await Promise.all([formsPromise, loadEvents()]);
    return { ok: true, destinations: { forms, events } };
  } catch (error) {
    console.error("[contenido] no pude cargar los destinos del link:", error instanceof Error ? error.message : "error desconocido");
    // @plantilla-desde(formularios)
    return { ok: false, error: "No pude cargar tus formularios y agendas. Podés pegar el link a mano." };
    // @plantilla-hasta(formularios)
    // @plantilla-sin(formularios): return { ok: false, error: "No pude cargar tus agendas. Podés pegar el link a mano." };
  }
}
