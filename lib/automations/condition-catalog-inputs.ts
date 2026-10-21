/**
 * Lo que devuelve el servidor para armar el catalogo de campos comparables
 * (`getConditionCatalogInputs`). Va en su propio archivo porque un archivo
 * `"use server"` solo puede exportar funciones asincronicas.
 */

import type { ConditionFieldSpec } from "@/lib/flow-engine/condition-eval";
import type { ContactStatusSettings } from "@/lib/contacts/statuses";

export interface ConditionCatalogInputs {
  /** Lo que aporta el disparador (las preguntas del formulario, los datos de la reunion...). */
  triggerSchema: ConditionFieldSpec[];
  customFields: Array<{ slug: string; name: string; type: string }>;
  tags: Array<{ name: string }>;
  sequences: Array<{ id: string; name: string }>;
  /** Pipeline (00245) y producto de interés (00246). Opcionales: el catálogo funciona sin ellos. */
  statusSettings?: ContactStatusSettings;
  products?: Array<{ id: string; name: string }>;
}
