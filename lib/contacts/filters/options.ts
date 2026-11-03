/**
 * Las opciones de los filtros que salen de datos del workspace (personas,
 * etiquetas, estados, productos…). Puro: la página junta los datos y esto los
 * convierte en la lista que muestra cada filtro (`FilterOptions.from`).
 */
import type { MultiFilterOption } from "@/lib/ui/multi-filter";
import { STATUS_ROLE_LABELS, activeStatuses, statusName, type ContactStatus, type ContactStatusSettings } from "../statuses";
import { offeredProducts, type InterestCatalog } from "../interest";

/** Los estados de un rol: todos (los archivados lo dicen en el nombre), para encontrar a quien quedó en uno viejo. */
function statusOptions(list: readonly ContactStatus[]): MultiFilterOption[] {
  return list.map((st) => ({ value: st.key, label: statusName(list, st.key), color: st.color }));
}

export function coreFilterOptions(input: {
  members: readonly { userId: string; label: string }[];
  tags: readonly { id: string; name: string; color: string | null }[];
  platforms: readonly { value: string; label: string }[];
  statusSettings: ContactStatusSettings;
  interestCatalog: InterestCatalog;
}): Record<string, MultiFilterOption[]> {
  return {
    members: input.members.map((m) => ({ value: m.userId, label: m.label })),
    tags: input.tags.map((t) => ({ value: t.id, label: t.name, color: t.color })),
    platforms: input.platforms.map((p) => ({ value: p.value, label: p.label })),
    setterStatuses: statusOptions(input.statusSettings.setter),
    closerStatuses: statusOptions(input.statusSettings.closer),
    lastStatuses: (["setter", "closer"] as const).flatMap((role) =>
      activeStatuses(input.statusSettings[role]).map((st) => ({
        value: `${role}:${st.key}`,
        label: `${st.name} (${STATUS_ROLE_LABELS[role].toLowerCase()})`,
        color: st.color,
      })),
    ),
    products: offeredProducts(input.interestCatalog, null).map((p) => ({ value: p.id, label: p.name })),
  };
}
