// @plantilla-quitar(servicios)
/**
 * «El responsable del servicio» como destino de «Crear tarea» y «Avisar al equipo» (Servicios A4, F157). PURO.
 *
 * El servicio es el del evento (`event_service_id`) o el activo o pausado más reciente del contacto. Si no hay servicio,
 * no tiene responsable o esa persona ya no es del equipo, va al plan B elegido en el paso. Publicar exige el plan B:
 * sin él, el paso no tendría a quién llegar y nadie se enteraría.
 */
export const SERVICE_OWNER_FALLBACK_PROBLEM = "Elegí a quién va si el servicio no tiene responsable (el plan B de «el responsable del servicio»).";

export function pickServiceOwnerTarget(
  owner: string | null,
  fallback: string | null,
  isMember: (id: string) => boolean,
): { userId: string | null; usedFallback: boolean } {
  if (owner && isMember(owner)) return { userId: owner, usedFallback: false };
  if (fallback && isMember(fallback)) return { userId: fallback, usedFallback: true };
  return { userId: null, usedFallback: true };
}

/** Lo que se mira al publicar: con «el responsable del servicio», el plan B es obligatorio. */
export function serviceOwnerFallbackProblem(node: { type?: unknown; data?: unknown }): string | null {
  const d = (node.data ?? {}) as Record<string, unknown>;
  const wants =
    (node.type === "create_task" && d.owner === "service_owner") || (node.type === "notify_team" && d.to === "service_owner");
  if (!wants) return null;
  const fallback = node.type === "create_task" ? d.ownerFallbackId : d.fallbackUserId;
  return typeof fallback === "string" && fallback ? null : SERVICE_OWNER_FALLBACK_PROBLEM;
}
