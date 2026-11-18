/**
 * Los formularios y las agendas del negocio con su link público: los usan «Armar un link» de una pieza y el destino del
 * botón de la invitación para pasarse (00404). Cada grupo pide su clave: formularios `forms.view`; agendas
 * `scheduling.use` o `bookings.view`. Sin la clave, el grupo viene vacío. Lee con la sesión de la persona (la RLS decide).
 */
import type { PermissionContext } from "@/lib/auth/guards";
import { buildEventDestinations, type PieceLinkDestination, type PieceLinkDestinations } from "@/lib/attribution/piece-link-destinations";
import { loadFormLinkDestinations } from "@/lib/forms/link-destinations"; // @plantilla-quitar(formularios)
import { publicBaseUrl, type WorkspaceDomainSource } from "@/lib/public-url";
import { listEventTypes } from "@/lib/scheduling/data/event-types";

export async function loadLinkDestinations(ctx: PermissionContext): Promise<PieceLinkDestinations> {
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

  const formsPromise = ctx.can("forms.view") ? loadFormLinkDestinations(ctx.supabase, workspaceId, base) : Promise.resolve([]); // @plantilla-quitar(formularios)
  // @plantilla-sin(formularios): const formsPromise = Promise.resolve<PieceLinkDestination[]>([]);
  const [forms, events] = await Promise.all([formsPromise, loadEvents()]);
  return { forms, events };
}
