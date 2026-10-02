/**
 * Que cards se ven en el listado de Integraciones (G1).
 *
 * Dos filtros que se pueden combinar: el chip de tipo (solo afecta a
 * Conexiones; Inteligencia artificial no tiene chips y no se filtra por uno)
 * y "Requiere atencion" (afecta a las dos secciones). Es una funcion pura:
 * recibe los grupos ya armados por `providersBySection()` y el estado de cada
 * card, y no toca la base.
 */

import type { IntegrationChip, ProviderSectionGroup } from "./providers";
import { chipsOf } from "./providers";
import { needsAttention, type IntegrationStatus } from "./status";

export interface FilterableStatus {
  status: IntegrationStatus;
}

export interface FilterOptions {
  /** `null` = todos los tipos. Solo se aplica a la seccion `connections`. */
  chip: IntegrationChip | null;
  onlyAttention: boolean;
}

/**
 * Los grupos ya filtrados, sin las secciones que quedan vacias.
 *
 * El chip de tipo nunca toca la seccion de IA: elegir "Mensajeria" no puede
 * hacer desaparecer a Anthropic.
 */
export function filterSections(
  sections: ProviderSectionGroup[],
  statusOf: (providerId: string) => FilterableStatus | undefined,
  options: FilterOptions,
): ProviderSectionGroup[] {
  return sections
    .map((group) => ({
      ...group,
      providers: group.providers.filter((provider) => {
        if (options.onlyAttention) {
          const data = statusOf(provider.id);
          if (!data || !needsAttention(data.status)) return false;
        }
        if (options.chip && group.section === "connections") {
          if (!chipsOf(provider).includes(options.chip)) return false;
        }
        return true;
      }),
    }))
    .filter((group) => group.providers.length > 0);
}

/**
 * Cuantas cards de Conexiones tiene cada chip, antes de aplicar "Requiere
 * atencion". Sirve para deshabilitar en vez de esconder un chip sin cards:
 * que un tipo exista y este vacio es informacion (G1).
 */
export function countByChip(sections: ProviderSectionGroup[]): Record<IntegrationChip, number> {
  const counts: Record<string, number> = {};
  for (const group of sections) {
    if (group.section !== "connections") continue;
    for (const provider of group.providers) {
      for (const chip of chipsOf(provider)) {
        counts[chip] = (counts[chip] ?? 0) + 1;
      }
    }
  }
  return counts as Record<IntegrationChip, number>;
}
